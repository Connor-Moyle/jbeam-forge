import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DESIGN_PRESETS, type EngineDesign } from '../../src/shared/powertrain/design';
import { engineModel, engineModelObj } from '../../src/shared/powertrain/engineModel';

const design = (over: Partial<EngineDesign>): EngineDesign => ({ ...DEFAULT_DESIGN, ...over });
const faces = (m: ReturnType<typeof engineModel>, name: string) => [...(m.pieces.find((p) => p.name === `forge_engine_${name}`)?.groups.values() ?? [])].flat().length;
const names = (m: ReturnType<typeof engineModel>) => m.pieces.map((p) => p.name.replace('forge_engine_', '')).sort();

describe('engine models', () => {
  it('builds the block from one cylinder slice, repeated for every cylinder', () => {
    const per = (n: number) => faces(engineModel(design({ cylinders: n })), 'heads');
    // The heads are only slices: exactly one per cylinder.
    expect(per(6) / per(3)).toBe(2);
    expect(per(4) - per(3)).toBe(per(3) / 3);
    // The block is the slices plus one crankcase.
    const block = (n: number) => faces(engineModel(design({ cylinders: n })), 'block');
    expect(block(6) - block(5)).toBe(block(5) - block(4));
  });

  it('turns the slices into banks: a V8 is twice four, a flat six is two banks of three', () => {
    const v8 = engineModel(design({ layout: 'v', cylinders: 8 }));
    const i4 = engineModel(design({ layout: 'inline', cylinders: 4 }));
    expect(faces(v8, 'heads')).toBe(2 * faces(i4, 'heads'));
    // A V is wider than it is tall-and-narrow like an inline; a flat is wider still and lower.
    const flat = engineModel(design({ layout: 'flat', cylinders: 6 }));
    expect(v8.size[0]).toBeGreaterThan(i4.size[0]);
    expect(flat.size[0]).toBeGreaterThan(flat.size[1]);
  });

  it('gives every option its own mesh, only when it is chosen', () => {
    expect(names(engineModel(design({ aspiration: 'na' })))).not.toContain('turbo');
    expect(names(engineModel(design({ aspiration: 'turbo', boost: 15 })))).toEqual(expect.arrayContaining(['turbo', 'chargepipes']));
    expect(names(engineModel(design({ aspiration: 'supercharger', boost: 8 })))).toContain('supercharger');
    expect(names(engineModel(design({ fuelSystem: 'carburettor' })))).toEqual(expect.arrayContaining(['carb', 'aircleaner']));
    expect(names(engineModel(design({ intake: 'itb' })))).not.toContain('throttle');
    // Twin turbos on a V: one per bank.
    const twin = engineModel(design({ layout: 'v', cylinders: 8, aspiration: 'twin-turbo', boost: 12 }));
    const single = engineModel(design({ layout: 'v', cylinders: 8, aspiration: 'turbo', boost: 12 }));
    expect(faces(twin, 'turbo')).toBe(2 * faces(single, 'turbo'));
  });

  it('builds a rotor housing per rotor, and an electric motor with no exhaust', () => {
    const r2 = engineModel(design({ layout: 'rotary', cylinders: 2 }));
    const r3 = engineModel(design({ layout: 'rotary', cylinders: 3 }));
    expect(faces(r3, 'block') / faces(r2, 'block')).toBe(1.5);
    const ev = engineModel(design({ layout: 'electric' }));
    expect(names(ev)).not.toContain('exhaust');
    expect(names(ev)).toContain('block');
  });

  it('comes out the size of a real engine for every preset, with no broken geometry', () => {
    for (const p of DESIGN_PRESETS) {
      const m = engineModel(design(p.design));
      const all = m.pieces.flatMap((piece) => [...piece.groups.values()].flat());
      expect(all.length, p.id).toBeGreaterThan(50);
      for (const f of all) for (const v of [...f.v, ...f.n]) expect(v.every(Number.isFinite), p.id).toBe(true);
      // Between a small motor and a big V12: 0.2–1.2 m in every direction.
      for (const s of m.size) {
        expect(s, p.id).toBeGreaterThan(0.15);
        expect(s, p.id).toBeLessThan(1.3);
      }
    }
  });

  it('writes an OBJ with a named object per mesh and every material in the MTL', () => {
    const m = engineModel(design({ aspiration: 'turbo', boost: 10 }));
    const { obj, mtl } = engineModelObj(m, 'engine.mtl');
    expect(obj).toContain('mtllib engine.mtl');
    for (const p of m.pieces) expect(obj).toContain(`o ${p.name}`);
    for (const name of new Set(m.pieces.flatMap((p) => [...p.groups.keys()]))) expect(mtl).toContain(`newmtl ${name}`);
  });
});
