import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanMaterials, writeMaterialPack } from '../../src/main/library/materialScan';
import { objectName, scanObjects, writeObjectPack } from '../../src/main/library/objectScan';

const FIXTURES = join(__dirname, '../fixtures/library');
const temp: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'jbf-library-'));
  temp.push(d);
  return d;
};
afterEach(() => temp.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('library folder scan', () => {
  it('turns a texture set into one named material with its roles', () => {
    const [m, ...rest] = scanMaterials(join(FIXTURES, 'materials'));
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ category: 'Metals', name: 'Test Steel' });
    expect(m!.textures.map((t) => t.role).sort()).toEqual(['basecolor', 'normal', 'roughness']);
    // Metals default to metallic, textures drive the look.
    expect(m!.def.layers[0]).toMatchObject({ metallic: 1, maps: { baseColorMap: 'textures/test_steel_basecolor.png', normalMap: 'textures/test_steel_normal.png' } });
  });

  it('writes materials in the library layout', () => {
    const out = join(tempDir(), 'pack');
    writeMaterialPack(scanMaterials(join(FIXTURES, 'materials')), out, 'Test pack');
    const json = JSON.parse(readFileSync(join(out, 'Metals', 'Test Steel', 'material.json'), 'utf8')) as { name: string };
    expect(json.name).toBe('Test Steel');
    expect(readFileSync(join(out, 'Metals', 'Test Steel', 'textures', 'test_steel_normal.png')).byteLength).toBeGreaterThan(0);
  });

  it('turns a mesh folder into a named object with a default material', () => {
    const [o, ...rest] = scanObjects(join(FIXTURES, 'objects'));
    expect(rest).toEqual([]);
    expect(o).toMatchObject({ group: 'Suspension', category: 'Brake Calipers', name: 'Test 01' });
    const out = join(tempDir(), 'objects');
    writeObjectPack([o!], out, 'Test objects');
    const json = JSON.parse(readFileSync(join(out, 'Suspension', 'Brake Calipers', 'Test 01', 'object.json'), 'utf8')) as { mesh: string; material: { layers: { baseColor: number[] }[] } };
    expect(json.mesh).toBe('brake_calipers_test_01.obj');
    // Untextured calipers come out gloss red.
    expect(json.material.layers[0]!.baseColor[0]).toBeGreaterThan(0.5);
  });

  it('names objects consistently', () => {
    expect(objectName('APLockheedCaliper00')).toBe('AP Lockheed 01');
    expect(objectName('AlfaRomeoDisc03')).toBe('Alfa Romeo 04');
    expect(objectName('PlaceholderCaliper')).toBe('Generic 01');
  });
});
