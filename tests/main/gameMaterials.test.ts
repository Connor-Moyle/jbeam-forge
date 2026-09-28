import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { materialsIn, scanGameMaterials } from '../../src/main/beamng/gameMaterials';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-gamemat-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function zipAt(path: string, files: Record<string, string>): Promise<void> {
  const z = new yazl.ZipFile();
  for (const [name, data] of Object.entries(files)) z.addBuffer(Buffer.from(data), name);
  z.end();
  await pipeline(z.outputStream, createWriteStream(path));
}

describe('materialsIn', () => {
  it('reads names (mapTo first), skips other classes, spots paint materials', () => {
    const text = `{
      "glass_mat": { "class": "Material", "mapTo": "vehicle_glass", "Stages": [{}] },
      "covet_body": { "name": "covet_main", "Stages": [{ "colorPaletteMap": "a.png" }], },
      "sky": { "class": "CubemapData" }
    }`;
    expect(materialsIn(text, 'common')).toEqual([
      { name: 'vehicle_glass', vehicle: 'common', paint: false },
      { name: 'covet_main', vehicle: 'common', paint: true },
    ]);
  });
});

describe('scanGameMaterials', () => {
  it('lists every vehicle zip, common first, without duplicates', async () => {
    const root = join(dir, 'content', 'vehicles');
    await mkdir(root, { recursive: true });
    await zipAt(join(root, 'common.zip'), { 'vehicles/common/glass.materials.json': '{"g":{"mapTo":"vehicle_glass"}}' });
    await zipAt(join(root, 'covet.zip'), { 'vehicles/covet/main.materials.json': '{"a":{"mapTo":"covet_seat"},"b":{"mapTo":"vehicle_glass"}}', 'vehicles/covet/covet.jbeam': '{}' });
    const list = await scanGameMaterials(dir);
    expect(list.map((m) => `${m.vehicle}/${m.name}`)).toEqual(['common/vehicle_glass', 'covet/covet_seat']);
    expect(await scanGameMaterials(join(dir, 'nowhere'))).toEqual([]);
  });
});
