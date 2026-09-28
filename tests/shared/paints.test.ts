import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/shared/project/io';
import type { Paint } from '../../src/shared/project/schema';
import { infoPaints, paintJson, pcPaints, PAINT_PRESETS, PAINT_SCHEMES, presetByName, resolvePaints } from '../../src/shared/paints/paints';
import { infoJson } from '../../src/shared/export/files';
import { resolveConfig } from '../../src/shared/export/configs';
import { materialJson } from '../../src/shared/materials/beamng';
import { defaultMaterial, liveryLayerIndex, defaultLayer } from '../../src/shared/materials/schema';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);
const paint = (id: string, name: string, color: [number, number, number]): Paint => ({ id, name, color, metallic: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });

function project() {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.paints.list = [paint('a', 'Red', [1, 0, 0]), paint('b', 'Blue', [0, 0, 1]), paint('c', 'Gold', [0.9, 0.7, 0.2])];
  doc.paints.defaults = ['a', 'b', null];
  return doc;
}

describe('factory paints', () => {
  it('writes paints the way the game reads them', () => {
    expect(paintJson(paint('x', 'X', [0.12345, 0.5, 1]))).toEqual({ baseColor: [0.123, 0.5, 1, 1], metallic: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
  });

  it('resolves the three slots: the configuration, else the default, else slot 1', () => {
    const doc = project();
    expect(resolvePaints(doc, null)!.map((p) => p.name)).toEqual(['Red', 'Blue', 'Red']);
    expect(resolvePaints(doc, { paints: [null, 'c', 'c'] })!.map((p) => p.name)).toEqual(['Red', 'Gold', 'Gold']);
    // a deleted paint falls back
    expect(resolvePaints(doc, { paints: ['gone', null, null] })![0].name).toBe('Red');
    expect(resolvePaints({ paints: { list: [], defaults: [null, null, null] } }, null)).toBeNull();
  });

  it('puts them in info.json and every .pc', () => {
    const doc = project();
    const info = infoJson(doc, 'me');
    expect(info).toMatchObject({ defaultPaintName1: 'Red', defaultPaintName2: 'Blue', defaultPaintName3: 'Red' });
    expect(Object.keys(info.paints as object)).toEqual(['Red', 'Blue', 'Gold']);
    const pc = resolveConfig(doc, tax, { id: 'c1', name: 'Race', description: '', type: 'Custom', parts: {}, vars: {}, paints: ['c', null, null] });
    expect(pc.paints!.map((p) => p.baseColor)).toEqual([
      [0.9, 0.7, 0.2, 1],
      [0, 0, 1, 1],
      [0.9, 0.7, 0.2, 1],
    ]);
    // no paints: nothing written, so the game's own default applies
    const bare = createEmptyProject({ name: 'Bare', slug: 'bare' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
    expect(infoPaints(bare)).toEqual({});
    expect(pcPaints(bare, null)).toEqual({});
    expect(resolveConfig(bare, tax, null).paints).toBeUndefined();
  });

  it('has presets for every scheme', () => {
    expect(PAINT_PRESETS.flatMap((g) => g.paints).length).toBeGreaterThan(20);
    for (const s of PAINT_SCHEMES) for (const n of s.slots) expect(presetByName(n), `${s.name}: ${n}`).toBeDefined();
  });
});

describe('two-sided materials and liveries', () => {
  it('drops doubleSided when the back faces have their own material', () => {
    const both = defaultMaterial('m', 'panel', { doubleSided: true });
    expect(materialJson(both, 'test_panel', (p) => p).doubleSided).toBe(true);
    expect(materialJson({ ...both, backMaterialId: 'inside' }, 'test_panel', (p) => p).doubleSided).toBeUndefined();
  });

  it('finds the painted livery layer by its file', () => {
    const def = defaultMaterial('m', 'paint', { paint: true, layers: [defaultLayer(), defaultLayer({ maps: { baseColorMap: 'C:/tex/body_d.png' } }), defaultLayer({ maps: { baseColorMap: 'C:/painted/test_m_livery.png' } })] });
    expect(liveryLayerIndex(def)).toBe(2);
    expect(liveryLayerIndex(defaultMaterial('n', 'plain'))).toBe(-1);
  });
});
