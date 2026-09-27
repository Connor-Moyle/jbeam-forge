import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsService, serializeSettings } from '../../src/main/services/settings';
import { LayoutService, serializeLayout } from '../../src/main/services/layout';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/shared/settings-schema';
import type { StoredLayout } from '../../src/shared/layout-schema';
import type { Logger } from '../../src/shared/logger';

function recordingLogger() {
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (...a) => warnings.push(a.map(String).join(' ')),
    error: (...a) => warnings.push(a.map(String).join(' ')),
  };
  return { logger, warnings };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-svc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const LAYOUT: StoredLayout = {
  version: 1,
  preset: 'modelling',
  dockview: {
    grid: { root: { type: 'branch', data: [] }, width: 800, height: 600, orientation: 'HORIZONTAL' },
    panels: { scene: { id: 'scene', contentComponent: 'scene', title: 'Scene' } },
  },
};

describe('settings', () => {
  it('serializes deterministically (snapshot)', () => {
    expect(serializeSettings({ ...DEFAULT_SETTINGS, debugLogging: true })).toMatchSnapshot();
  });

  it('merges per-field: invalid fields fall back, unknown keys dropped', () => {
    expect(mergeSettings({ debugLogging: 'yes', junk: 1 })).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ debugLogging: true })).toEqual({ ...DEFAULT_SETTINGS, debugLogging: true });
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('loads a Phase 1 settings file (no BeamNG fields) with the new fields defaulted', async () => {
    const file = join(dir, 'settings.json');
    await writeFile(file, '{\n  "version": 1,\n  "debugLogging": true\n}\n');
    const svc = new SettingsService(file, recordingLogger().logger);
    expect(await svc.load()).toEqual({ version: 1, debugLogging: true, beamngInstallDir: null, beamngUserDir: null, author: null, focusGhostOpacity: 0.12 });
  });

  it('uses defaults when the file is missing, without warning', async () => {
    const { logger, warnings } = recordingLogger();
    const svc = new SettingsService(join(dir, 'settings.json'), logger);
    expect(await svc.load()).toEqual(DEFAULT_SETTINGS);
    expect(warnings).toEqual([]);
  });

  it('persists updates and notifies listeners', async () => {
    const file = join(dir, 'settings.json');
    const svc = new SettingsService(file, recordingLogger().logger);
    await svc.load();
    const seen: boolean[] = [];
    svc.onChange((s) => seen.push(s.debugLogging));
    await svc.update({ debugLogging: true });
    expect(seen).toEqual([true]);
    const reloaded = new SettingsService(file, recordingLogger().logger);
    expect((await reloaded.load()).debugLogging).toBe(true);
  });

  it('rejects patches touching unknown or owned fields', async () => {
    const svc = new SettingsService(join(dir, 'settings.json'), recordingLogger().logger);
    await svc.load();
    await expect(svc.update({ version: 2 } as never)).rejects.toThrow();
    await expect(svc.update({ debugLogging: 'x' } as never)).rejects.toThrow();
  });

  it('backs up a corrupt file and falls back to defaults', async () => {
    const file = join(dir, 'settings.json');
    await writeFile(file, '{ corrupt');
    const { logger, warnings } = recordingLogger();
    const svc = new SettingsService(file, logger);
    expect(await svc.load()).toEqual(DEFAULT_SETTINGS);
    expect(warnings).toHaveLength(1);
    expect((await readdir(dir)).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true);
  });
});

describe('layout', () => {
  it('serializes deterministically (snapshot)', () => {
    expect(serializeLayout(LAYOUT)).toMatchSnapshot();
  });

  it('round-trips save → load', async () => {
    const svc = new LayoutService(join(dir, 'layouts', 'current.json'), recordingLogger().logger);
    await svc.save(LAYOUT);
    expect(await svc.load()).toEqual(LAYOUT);
  });

  it('returns null for missing, corrupt or invalid layouts', async () => {
    const file = join(dir, 'layouts', 'current.json');
    const { logger, warnings } = recordingLogger();
    const svc = new LayoutService(file, logger);
    expect(await svc.load()).toBeNull();
    await mkdir(join(dir, 'layouts'), { recursive: true });
    await writeFile(file, 'nope');
    expect(await svc.load()).toBeNull();
    await writeFile(file, JSON.stringify({ ...LAYOUT, preset: 'nonsense' }));
    expect(await svc.load()).toBeNull();
    expect(warnings).toHaveLength(2);
  });

  it('refuses to save an invalid layout', async () => {
    const file = join(dir, 'layouts', 'current.json');
    const svc = new LayoutService(file, recordingLogger().logger);
    await expect(svc.save({ ...LAYOUT, version: 9 } as never)).rejects.toThrow();
    await expect(readFile(file)).rejects.toThrow();
  });
});
