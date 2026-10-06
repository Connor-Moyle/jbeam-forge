import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../../src/shared/materials/presets';
import { MaterialDefSchema } from '../../src/shared/materials/schema';
import { PAINT_PRESETS, PAINT_SCHEMES } from '../../src/shared/paints/paints';
import { DESIGN_PRESETS } from '../../src/shared/powertrain/design';

const unique = (xs: string[]) => new Set(xs).size === xs.length;

describe('presets', () => {
  it('materials: unique ids, and every one a valid material', () => {
    expect(unique(MATERIAL_PRESETS.map((p) => p.id))).toBe(true);
    for (const p of MATERIAL_PRESETS) expect(MaterialDefSchema.safeParse({ ...p.def, id: p.id, name: p.id, origin: null }).success, p.id).toBe(true);
  });

  it('paints: unique names, colours 0–1, and every scheme uses paints that exist', () => {
    const paints = PAINT_PRESETS.flatMap((g) => g.paints);
    expect(unique(paints.map((p) => p.name))).toBe(true);
    for (const p of paints) expect(p.color.every((c) => c >= 0 && c <= 1), p.name).toBe(true);
    const names = new Set(paints.map((p) => p.name));
    for (const s of PAINT_SCHEMES) expect(s.slots.every((n) => names.has(n)), s.name).toBe(true);
  });

  it('engine designs: unique ids', () => {
    expect(unique(DESIGN_PRESETS.map((p) => p.id))).toBe(true);
  });
});
