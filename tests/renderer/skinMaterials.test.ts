import { describe, expect, it } from 'vitest';
import { splitSharedMaterials } from '../../src/renderer/skins/commands';
import { defaultMaterial } from '../../src/shared/materials/schema';

describe('skin layout materials', () => {
  it('gives the laid-out panels their own copy of a material other meshes share', () => {
    const paint = defaultMaterial('m_paint', 'paint');
    const trim = defaultMaterial('m_trim', 'trim');
    const d = { materials: [paint, trim], materialSlots: { 'src:bumper': ['m_paint', 'm_trim'], 'src:grille': ['m_trim'], 'src:door': ['m_paint'] }, meshCopies: [] };
    const copied = splitSharedMaterials(d, new Set(['src:bumper', 'src:door']), ['src:bumper', 'src:grille', 'src:door']);
    expect(copied).toEqual(['trim']);
    const copy = d.materials.find((m) => m.name === 'trim_skin')!;
    expect(copy).toBeDefined();
    expect(copy.id).not.toBe('m_trim');
    expect(d.materialSlots['src:bumper']).toEqual(['m_paint', copy.id]);
    // The grille keeps the original; the paint was only on laid-out panels, so it isn't copied.
    expect(d.materialSlots['src:grille']).toEqual(['m_trim']);
    expect(d.materials.filter((m) => m.name.startsWith('paint'))).toHaveLength(1);
    // Doing it again copies nothing more.
    expect(splitSharedMaterials(d, new Set(['src:bumper', 'src:door']), ['src:bumper', 'src:grille', 'src:door'])).toEqual([]);
  });
});
