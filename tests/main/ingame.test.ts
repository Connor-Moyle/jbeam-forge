import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipFile } from 'yazl';
import { ingameStatus, installIngame, newer } from '../../src/main/beamng/ingame';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-ingame-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function modZip(path: string, version: string) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({ version })), 'jbeamforge-version.json');
  zip.addBuffer(Buffer.from('-- lua'), 'lua/ge/extensions/jbeamForge.lua');
  zip.end();
  await new Promise<void>((res, rej) => zip.outputStream.pipe(createWriteStream(path)).on('close', () => res()).on('error', rej));
}

describe('JBeam Forge in the game', () => {
  it('compares versions', () => {
    expect(newer('0.16.0', '0.15.9')).toBe(true);
    expect(newer('0.16.0', '0.16.0')).toBe(false);
    expect(newer('0.16.10', '0.16.9')).toBe(true);
    expect(newer('0.16.0', null)).toBe(true);
    expect(newer(null, '0.1.0')).toBe(false);
  });

  it('installs into the mods folder, says when an update is ready, and replaces an unpacked copy of ours', async () => {
    const bundled = join(dir, 'bundled.zip');
    const mods = join(dir, 'mods');
    await mkdir(join(mods, 'unpacked', 'jbeam_forge'), { recursive: true });
    await writeFile(join(mods, 'unpacked', 'jbeam_forge', 'jbeamforge-version.json'), JSON.stringify({ version: '0.15.1' }));
    await modZip(bundled, '0.16.0');

    const before = await ingameStatus(bundled, mods);
    expect(before).toMatchObject({ bundled: '0.16.0', installed: '0.15.1', unpacked: true, updateAvailable: true });

    const after = await installIngame(bundled, mods);
    expect(after).toMatchObject({ installed: '0.16.0', updateAvailable: false, unpacked: false });
    expect(existsSync(join(mods, 'jbeam_forge.zip'))).toBe(true);
    expect(existsSync(join(mods, 'unpacked', 'jbeam_forge'))).toBe(false);
  });

  it('without a mods folder there is nothing to update', async () => {
    const bundled = join(dir, 'bundled.zip');
    await modZip(bundled, '0.16.0');
    expect(await ingameStatus(bundled, null)).toMatchObject({ installed: null, updateAvailable: false });
  });
});
