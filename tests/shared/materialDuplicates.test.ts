import { describe, expect, it } from 'vitest';
import { baseMaterialName, findDuplicates, mergeMaterials } from '../../src/shared/materials/duplicates';
import { defaultLayer, defaultMaterial } from '../../src/shared/materials/schema';

const alu = (id: string, name: string) => defaultMaterial(id, name, { layers: [defaultLayer({ metallic: 1, roughness: 0.3 })] });

describe('duplicate materials', () => {
  it('strips copy suffixes to compare names', () => {
    expect(baseMaterialName('Aluminum-2.003')).toBe('aluminum');
    expect(baseMaterialName('Chrome.001')).toBe('chrome');
    expect(baseMaterialName('Chrome_02')).toBe('chrome');
    expect(baseMaterialName('Glass copy 2')).toBe('glass');
    expect(baseMaterialName('Body_Paint')).toBe('body_paint');
  });

  it('groups identical materials; name-variant groups come first and keep the cleanest name', () => {
    const mats = [alu('a1', 'Aluminum-1.001'), alu('a2', 'Aluminum-1'), alu('a3', 'Aluminum-2.002'), defaultMaterial('p', 'Plastic'), defaultMaterial('g', 'Grille')];
    const groups = findDuplicates(mats);
    expect(groups).toEqual([
      { keep: 'a2', merge: ['a1', 'a3'], sameName: true },
      { keep: 'g', merge: ['p'], sameName: false }, // identical, unrelated names: offered, not assumed
    ]);
  });

  it('splits an identical group into confident copy-merges and one optional cross-name merge', () => {
    const mats = [alu('a', 'Aluminum-1'), alu('b', 'Aluminum-1.001'), alu('w', 'Pure-White'), alu('w2', 'Pure-White.002')];
    expect(findDuplicates(mats)).toEqual([
      { keep: 'a', merge: ['b'], sameName: true },
      { keep: 'w', merge: ['w2'], sameName: true },
      { keep: 'a', merge: ['w'], sameName: false },
    ]);
  });

  it('does not group materials that differ in any setting or texture', () => {
    expect(findDuplicates([alu('a', 'Chrome'), defaultMaterial('b', 'Chrome.001', { doubleSided: true })])).toEqual([]);
  });

  it('merging repoints meshes and removes the copies', () => {
    const doc = { materials: [alu('a1', 'Aluminum-1.001'), alu('a2', 'Aluminum-1')], materialSlots: { m1: ['a1'], m2: ['a2', 'a1'] } };
    expect(mergeMaterials(doc, [{ keep: 'a2', merge: ['a1'] }])).toBe(1);
    expect(doc.materials.map((m) => m.id)).toEqual(['a2']);
    expect(doc.materialSlots).toEqual({ m1: ['a2'], m2: ['a2', 'a2'] });
  });

  it('follows chained merges to the material that is kept', () => {
    const doc = { materials: [alu('a', 'A'), alu('w', 'W'), alu('w2', 'W.001')], materialSlots: { m: ['w2'] } };
    mergeMaterials(doc, [{ keep: 'w', merge: ['w2'] }, { keep: 'a', merge: ['w'] }]);
    expect(doc.materialSlots).toEqual({ m: ['a'] });
    expect(doc.materials.map((m) => m.id)).toEqual(['a']);
  });
});
