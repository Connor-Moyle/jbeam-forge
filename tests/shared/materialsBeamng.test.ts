import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE_MASK, materialJson, texturePaths } from '../../src/shared/materials/beamng';
import { defaultLayer, defaultMaterial, MaterialDefSchema } from '../../src/shared/materials/schema';

const fileFor = (p: string) => `/vehicles/car/${p.slice(p.lastIndexOf('/') + 1)}`;

describe('BeamNG material output', () => {
  it('writes the v1.5 shape stock vehicles use: four stages, tags, version', () => {
    const out = materialJson(defaultMaterial('m1', 'plastic'), 'car_plastic', fileFor);
    expect(out).toMatchObject({ name: 'car_plastic', mapTo: 'car_plastic', class: 'Material', version: 1.5, materialTag0: 'beamng', materialTag1: 'vehicle', dynamicCubemap: true });
    expect(out.Stages).toHaveLength(4);
    expect((out.Stages as object[])[0]).toEqual({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.5 });
  });

  it('only writes what differs from BeamNG defaults, maps copied into the mod', () => {
    const def = defaultMaterial('m', 'body', {
      layers: [defaultLayer({ maps: { baseColorMap: 'C:/tex/body_b.png', normalMap: 'C:/tex/body_n.png' }, metallic: 1, normalStrength: 2, clearCoat: 1, clearCoatRoughness: 0.05, uv2: ['normalMap'] })],
    });
    const stage = (materialJson(def, 'car_body', fileFor).Stages as Record<string, unknown>[])[0]!;
    expect(stage).toEqual({
      metallicFactor: 1,
      roughnessFactor: 0.5,
      normalMapStrength: 2,
      clearCoatFactor: 1,
      clearCoatRoughnessFactor: 0.05,
      baseColorMap: '/vehicles/car/body_b.png',
      normalMap: '/vehicles/car/body_n.png',
      normalMapUseUV: 1,
    });
  });

  it('glass: translucent with its blend op, shadows off', () => {
    const out = materialJson(defaultMaterial('g', 'glass', { translucent: true, blend: 'PreMulAlpha', castShadows: false, layers: [defaultLayer({ opacity: 0.3 })] }), 'car_glass', fileFor);
    expect(out).toMatchObject({ translucent: true, translucentBlendOp: 'PreMulAlpha', translucentRecvShadows: true, castShadows: false, alphaRef: 0 });
    expect((out.Stages as Record<string, unknown>[])[0]!.opacityFactor).toBe(0.3);
  });

  it('paint without a mask uses the game’s own all-slot-1 mask, and game paths are never copied', () => {
    const def = defaultMaterial('p', 'paint', { paint: true, layers: [defaultLayer({ clearCoat: 1 }), defaultLayer({ maps: { baseColorMap: 'C:/t/b.png' } })] });
    const out = materialJson(def, 'car_paint', fileFor);
    expect((out.Stages as Record<string, unknown>[])[0]!.colorPaletteMap).toBe(DEFAULT_PALETTE_MASK);
    expect(out.activeLayers).toBe(2);
    expect(texturePaths(def)).toEqual(['C:/t/b.png']);
  });

  it('raw extra fields win over generated ones', () => {
    const def = defaultMaterial('x', 'x', { extra: { castShadows: true, annotation: 'CAR_PAINT' }, layers: [defaultLayer({ extra: { glow: true, metallicFactor: 0.2 } })] });
    const out = materialJson(def, 'car_x', fileFor);
    expect(out.annotation).toBe('CAR_PAINT');
    expect((out.Stages as Record<string, unknown>[])[0]).toMatchObject({ glow: true, metallicFactor: 0.2 });
  });

  it('game materials export nothing to copy', () => {
    expect(texturePaths(defaultMaterial('g', 'g', { gameMaterial: 'vehicle_glass', layers: [defaultLayer({ maps: { baseColorMap: 'C:/a.png' } })] }))).toEqual([]);
  });

  it('defaults validate against the schema', () => {
    expect(MaterialDefSchema.safeParse(defaultMaterial('a', 'b')).success).toBe(true);
  });
});
