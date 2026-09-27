import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MaterialLibraryService } from '../../src/main/services/materialLibrary';
import { defaultLayer, defaultMaterial, MaterialDefSchema } from '../../src/shared/materials/schema';
import { MATERIAL_PRESETS } from '../../src/shared/materials/presets';
import type { Logger } from '../../src/shared/logger';

const silent: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-matlib-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('material library', () => {
  it('every preset is a valid material', () => {
    for (const p of MATERIAL_PRESETS) expect(MaterialDefSchema.safeParse({ ...p.def, id: p.id, name: p.id, origin: null }).success, p.id).toBe(true);
    expect(new Set(MATERIAL_PRESETS.map((p) => p.id)).size).toBe(MATERIAL_PRESETS.length);
  });

  it('saving copies the textures in, so the item outlives its project', async () => {
    const tex = join(dir, 'body_b.png');
    await writeFile(tex, 'png-bytes');
    const lib = new MaterialLibraryService(join(dir, 'lib'), silent);
    await lib.load();
    const items = await lib.add('Red paint', 'Paint', defaultMaterial('m', 'red', { layers: [defaultLayer({ maps: { baseColorMap: tex, colorPaletteMap: '/vehicles/common/nullcolormaskR.color.png' } })] }));
    const stored = items[0]!.def.layers[0]!.maps;
    expect(stored.baseColorMap).not.toBe(tex);
    expect(await readFile(stored.baseColorMap!, 'utf8')).toBe('png-bytes');
    expect(stored.colorPaletteMap).toBe('/vehicles/common/nullcolormaskR.color.png'); // game paths stay
    const reloaded = new MaterialLibraryService(join(dir, 'lib'), silent);
    expect((await reloaded.load()).map((i) => i.name)).toEqual(['Red paint']);
  });

  it('round-trips a material with its textures through a .jbmat', async () => {
    const tex = join(dir, 'weave_n.png');
    await writeFile(tex, 'normal-bytes');
    const lib = new MaterialLibraryService(join(dir, 'lib'), silent);
    await lib.load();
    const file = join(dir, 'carbon.jbmat');
    await lib.exportJbmat(file, 'Carbon', 'Shared', defaultMaterial('c', 'carbon', { layers: [defaultLayer({ roughness: 0.2, maps: { normalMap: tex } })] }));
    const items = await lib.importJbmat(file);
    const item = items.at(-1)!;
    expect(item).toMatchObject({ name: 'Carbon', category: 'Shared' });
    expect(item.def.layers[0]!.roughness).toBe(0.2);
    expect(await readFile(item.def.layers[0]!.maps.normalMap!, 'utf8')).toBe('normal-bytes');
  });

  it('removing an item deletes its texture copies', async () => {
    const tex = join(dir, 'a.png');
    await writeFile(tex, 'x');
    const lib = new MaterialLibraryService(join(dir, 'lib'), silent);
    await lib.load();
    const [item] = await lib.add('A', 'Mine', defaultMaterial('a', 'a', { layers: [defaultLayer({ maps: { baseColorMap: tex } })] }));
    const copy = item!.def.layers[0]!.maps.baseColorMap!;
    expect(await lib.remove(item!.id)).toEqual([]);
    expect(existsSync(copy)).toBe(false);
  });
});
