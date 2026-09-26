import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BeamngService, rootsFromEnv } from '../../src/main/beamng/service';
import { SettingsService } from '../../src/main/services/settings';
import { NULL_LOGGER } from '../../src/shared/logger';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'jbf-bsvc-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function put(path: string, content = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function fakeInstall(name: string): Promise<string> {
  const dir = join(tmp, name);
  await put(join(dir, 'BeamNG.drive.exe'));
  await put(join(dir, 'content', 'vehicles', 'car.zip'));
  return dir;
}

async function setup() {
  const la = join(tmp, 'la');
  const detected = await fakeInstall('detected');
  await put(join(la, 'BeamNG', 'BeamNG.drive.ini'), `version = 0.39.1.0\ninstallPath = ${detected}\\\n`);
  await mkdir(join(la, 'BeamNG', 'BeamNG.drive', 'current'), { recursive: true });
  const settings = new SettingsService(join(tmp, 'settings.json'), NULL_LOGGER);
  await settings.load();
  const beamng = new BeamngService({ localAppData: la, steamRoots: [] }, NULL_LOGGER);
  return { la, detected, settings, beamng };
}

describe('BeamngService.autoConfigure', () => {
  it('saves the single detected install and user folder, with a message', async () => {
    const { la, detected, settings, beamng } = await setup();
    const message = await beamng.autoConfigure(settings);
    expect(message).toContain('BeamNG.drive 0.39.1 · 1 vehicle');
    expect(settings.get().beamngInstallDir).toBe(resolve(detected));
    expect(settings.get().beamngUserDir).toBe(join(la, 'BeamNG', 'BeamNG.drive', 'current'));
  });

  it('never overwrites a folder the user saved while detection was running', async () => {
    const { settings, beamng } = await setup();
    const chosen = await fakeInstall('chosen');
    const auto = beamng.autoConfigure(settings); // detection is async fs work…
    await settings.update({ beamngInstallDir: chosen }); // …the user saves meanwhile
    expect(await auto).toBeNull();
    expect(settings.get().beamngInstallDir).toBe(chosen);
    const onDisk = JSON.parse(await readFile(join(tmp, 'settings.json'), 'utf8')) as { beamngInstallDir: string; beamngUserDir: string };
    expect(onDisk.beamngInstallDir).toBe(chosen);
    expect(onDisk.beamngUserDir).toBeTruthy(); // the user folder is still filled in
  });

  it('does nothing when already configured', async () => {
    const { settings, beamng } = await setup();
    await settings.update({ beamngInstallDir: 'x', beamngUserDir: 'y' });
    expect(await beamng.autoConfigure(settings)).toBeNull();
    expect(settings.get().beamngInstallDir).toBe('x');
  });
});

describe('SettingsService — concurrent updates', () => {
  it('applies overlapping updates in order without losing fields', async () => {
    const settings = new SettingsService(join(tmp, 'settings.json'), NULL_LOGGER);
    await settings.load();
    await Promise.all([settings.update({ debugLogging: true }), settings.update({ beamngUserDir: 'u' }), settings.update({ beamngInstallDir: 'i' })]);
    expect(settings.get()).toMatchObject({ debugLogging: true, beamngUserDir: 'u', beamngInstallDir: 'i' });
    const reloaded = new SettingsService(join(tmp, 'settings.json'), NULL_LOGGER);
    expect(await reloaded.load()).toMatchObject({ debugLogging: true, beamngUserDir: 'u', beamngInstallDir: 'i' });
  });
});

describe('rootsFromEnv', () => {
  it('isolates detection when the harness variables are set', () => {
    expect(rootsFromEnv({ JBFORGE_LOCALAPPDATA: 'L', JBFORGE_STEAM_ROOTS: '' })).toEqual({ localAppData: 'L', steamRoots: [] });
    expect(rootsFromEnv({ JBFORGE_STEAM_ROOTS: 'a;b' })).toEqual({ localAppData: undefined, steamRoots: ['a', 'b'] });
  });
});
