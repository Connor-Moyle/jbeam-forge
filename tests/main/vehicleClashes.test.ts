import { afterAll, describe, expect, it } from 'vitest';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yazl from 'yazl';
import { vehicleClashes } from '../../src/main/export/clashes';

const root = mkdtempSync(join(tmpdir(), 'jbf-clash-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function zip(path: string, entries: string[]): Promise<void> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile();
    for (const e of entries) z.addBuffer(Buffer.from('{}'), e);
    z.outputStream.pipe(createWriteStream(path)).on('close', () => resolve());
    z.end();
  });
}

describe('other mods that carry the same car', () => {
  it('finds an old unpacked copy and a zip with the car, not the mod just installed or unrelated mods', async () => {
    const mods = join(root, 'mods');
    const own = join(mods, 'unpacked', 'practice_car');
    for (const d of [join(own, 'vehicles', 'practice_car'), join(mods, 'unpacked', 'Testing', 'vehicles', 'practice_car'), join(mods, 'unpacked', 'other', 'vehicles', 'pickup'), join(mods, 'repo')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(own, 'vehicles', 'practice_car', 'a.jbeam'), '{}');
    await zip(join(mods, 'practice_car_old.zip'), ['vehicles/practice_car/practice_car.jbeam']);
    await zip(join(mods, 'repo', 'someone_elses.zip'), ['vehicles/etk800/x.jbeam']);
    await zip(join(mods, 'repo', 'copy.zip'), ['vehicles/Practice_Car/info.json']);
    const found = (await vehicleClashes(mods, 'practice_car', own)).map((p) => p.replace(/\\/g, '/')).sort();
    expect(found).toEqual(['practice_car_old.zip', 'repo/copy.zip', 'unpacked/Testing']);
  });
});
