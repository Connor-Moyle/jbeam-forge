import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { materialDefaults, nicePrice, partPrice } from '../../src/shared/parts/materials';

const entries = TaxonomyFileSchema.parse(shipped).entries;
const kind = (id: string) => entries.find((e) => e.id === id)!;

describe('automatic prices and masses', () => {
  it('every shipped kind has a price', () => {
    for (const e of entries) expect(e.defaultPrice, e.id).toBeGreaterThan(0);
  });

  it('priced in BeamNG terms: a body shell costs far more than a hood, which costs more than a badge', () => {
    expect(kind('body').defaultPrice).toBeGreaterThan(5000);
    expect(kind('hood').defaultPrice).toBeGreaterThan(kind('badge').defaultPrice);
    expect(kind('rollcage').defaultPrice).toBeGreaterThan(kind('rollbar').defaultPrice);
  });

  it('material scales price up for exotic materials and mass down', () => {
    const hood = kind('hood');
    const steel = materialDefaults(hood, 'steel');
    const carbon = materialDefaults(hood, 'carbon');
    expect(steel.price).toBe(hood.defaultPrice);
    expect(carbon.price).toBeGreaterThan(steel.price);
    expect(carbon.mass).toBeLessThan(steel.mass);
  });

  it('rounds to shop-looking prices', () => {
    expect(nicePrice(47)).toBe(45);
    expect(nicePrice(473)).toBe(470);
    expect(nicePrice(1412)).toBe(1400);
  });

  it('a typed price wins; null follows kind and material', () => {
    const hood = kind('hood');
    expect(partPrice({ price: 1234, constructionMaterial: 'carbon' }, hood)).toBe(1234);
    expect(partPrice({ price: 0, constructionMaterial: 'steel' }, hood)).toBe(0);
    expect(partPrice({ price: null, constructionMaterial: 'aluminium' }, hood)).toBe(materialDefaults(hood, 'aluminium').price);
    expect(partPrice({ price: null, constructionMaterial: 'steel' }, undefined)).toBe(0);
  });
});
