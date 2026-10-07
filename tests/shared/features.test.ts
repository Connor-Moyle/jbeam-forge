import { describe, expect, it } from 'vitest';
import { buildFeatureParts, nearestNodes, skinMaterialName, type FeatureContext } from '../../src/shared/export/features';
import type { Features } from '../../src/shared/project/schema';
import { suggestFeature } from '../../src/shared/features/place';

const nodes = [
  { id: 'a', pos: [0, 1, 0.5] as [number, number, number], partId: 'body' },
  { id: 'b', pos: [0.3, 1.2, 0.5] as [number, number, number], partId: 'body' },
  { id: 'c', pos: [-0.3, 1.2, 0.5] as [number, number, number], partId: 'body' },
  { id: 'd', pos: [0, 2, 0.5] as [number, number, number], partId: 'body' },
  { id: 'n2o', pos: [0, -2, 0.5] as [number, number, number], partId: 'hood' },
];
const ctx: FeatureContext = { slug: 'car', author: 'me', groupOf: () => 'car_body', nodes, hasPart: (id) => id === 'body', bodyPartId: 'body', hasEngine: true };
const none: Features = { plates: { front: null, rear: null }, hitch: null, nitrous: null, skins: [] };

describe('buildFeatureParts', () => {
  it('writes the nitrous system with its bottle and shot sizes on the main engine', () => {
    const fx = buildFeatureParts({ ...none, nitrous: { partId: 'body', pos: [0, 1.1, 0.5], bottle: '20lb', shotKw: 75 } }, ctx);
    expect(Object.keys(fx.parts).sort()).toEqual(['car_n2o', 'car_n2o_bottle_20lb', 'car_n2o_shot_100', 'car_n2o_shot_150', 'car_n2o_shot_50', 'car_n2o_shot_75']);
    expect(fx.mainSlots.at(-1)).toEqual(['car_n2o', ['car_n2o'], [], 'car_n2o', 'Nitrous Oxide Injection']);
    expect(fx.parts.car_n2o).toMatchObject({ mainEngine: { nitrousOxideInjection: 'n2o' }, n2o: { cutInRPM: '$n2o_rpm' } });
    const bottle = fx.parts.car_n2o_bottle_20lb as { mainBottle: unknown; nodes: unknown[][]; beams: unknown[] };
    expect(bottle.mainBottle).toEqual({ capacity: 9.07, startingCapacity: 9.07 });
    // The id "n2o" is taken by another node, so the bottle's gets a number.
    expect(bottle.nodes[2]![0]).toBe('n2o2');
    expect(bottle.beams.filter((b) => Array.isArray(b) && b[0] === 'n2o2').map((b) => (b as string[])[1])).toEqual(['a', 'b', 'c', 'd']);
    expect((fx.parts.car_n2o as { slots2: unknown[][] }).slots2[2]![3]).toBe('car_n2o_shot_75');
  });

  it('adds the bottle to the tanks the engine draws from, whatever they are called', () => {
    const nitrous = { partId: 'body', pos: [0, 1.1, 0.5] as [number, number, number], bottle: '10lb' as const, shotKw: 50 };
    const stores = (c: typeof ctx) => (buildFeatureParts({ ...none, nitrous }, c).parts.car_n2o_bottle_10lb as { mainEngine: { energyStorage: string[] } }).mainEngine.energyStorage;
    expect(stores(ctx)).toEqual(['mainTank', 'mainBottle']);
    // The Bolide's engine: with mainTank written over its two tanks it had no fuel.
    expect(stores({ ...ctx, fuelStorages: ['fueltank_R', 'fueltank_L'] })).toEqual(['fueltank_R', 'fueltank_L', 'mainBottle']);
  });

  it('leaves nitrous out without an engine', () => {
    const fx = buildFeatureParts({ ...none, nitrous: { partId: 'body', pos: [0, 1, 0.5], bottle: '10lb', shotKw: 50 } }, { ...ctx, hasEngine: false });
    expect(fx.parts).toEqual({});
  });

  it('prefers the mount part’s own nodes', () => {
    expect(nearestNodes(ctx, [0, -2, 0.5], 'body', 2)).toEqual(['a', 'b']);
    expect(nearestNodes(ctx, [0, -2, 0.5], 'hood', 1)).toEqual(['n2o']);
  });

  it('names skin materials the way the game looks them up', () => {
    expect(skinMaterialName('car_paint', { name: 'Race Stripes!' })).toBe('car_paint.skin.race_stripes');
  });
});

describe('suggestFeature', () => {
  const node = (id: string, partId: string, pos: [number, number, number]) => ({ id, partId, pos });
  const doc = {
    parts: [{ id: 'bf', taxonomyId: 'bumper', position: 'F', variantOf: null }, { id: 'body', taxonomyId: 'body', position: null, variantOf: null }] as never,
    nodes: [node('f1', 'bf', [-0.8, -2.3, 0.2]), node('f2', 'bf', [0.8, -2.1, 0.6]), node('b1', 'body', [-0.9, -2, 0.1]), node('b2', 'body', [0.9, 2, 1.5])] as never,
  };

  it('puts the front plate on the front bumper’s face and the rest on the body', () => {
    expect(suggestFeature(doc, 'body', 'plateFront')).toEqual({ partId: 'bf', pos: [0, -2.305, 0.38] });
    expect(suggestFeature(doc, 'body', 'plateRear')).toEqual({ partId: 'body', pos: [0, 2.005, 0.87] });
    expect(suggestFeature(doc, 'body', 'hitch')).toEqual({ partId: 'body', pos: [0, 2.08, 0.24] });
    expect(suggestFeature(doc, 'body', 'nitrous')!.pos[1]).toBeCloseTo(1.4);
  });

  it('gives up without structure', () => {
    expect(suggestFeature({ parts: [], nodes: [] }, 'body', 'hitch')).toBeNull();
  });
});
