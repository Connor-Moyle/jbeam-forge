import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { createPart } from '../../src/shared/parts/ops';
import { applyArchetype, ARCHETYPES, STRUCTURE_SHARE } from '../../src/shared/proxy/archetypes';
import { partMass, partSettings } from '../../src/shared/proxy/generate';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

function car() {
  const doc = createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z'));
  const body = createPart(doc, tax, { taxonomyId: 'body' });
  createPart(doc, tax, { taxonomyId: 'hood' });
  createPart(doc, tax, { taxonomyId: 'door', position: 'FL', parentPartId: body.id });
  createPart(doc, tax, { taxonomyId: 'door', position: 'FR', parentPartId: body.id });
  return doc;
}
const weight = (doc: ReturnType<typeof car>) => doc.parts.reduce((s, p) => s + partMass(p, tax.entry(p.taxonomyId)!, partSettings(doc, p, tax.entry(p.taxonomyId)!)), 0);

describe('starting a car’s structure as a kind of vehicle', () => {
  it('weighs the car’s own structure at its share of that kind’s kerb weight, and sets its detail', () => {
    for (const a of ARCHETYPES.filter((x) => x.id === 'hatch' || x.id === 'ute')) {
      const doc = car();
      expect(applyArchetype(doc, tax, a.id)).toBeGreaterThan(0);
      expect(weight(doc)).toBeCloseTo(a.kerbKg * STRUCTURE_SHARE, -1);
      expect(Object.values(doc.proxy.parts).every((p) => p.detail === a.detail)).toBe(true);
    }
  });

  it('makes a pickup heavier than a hatchback, part for part, and can be applied again', () => {
    const hatch = car();
    const ute = car();
    applyArchetype(hatch, tax, 'hatch');
    applyArchetype(ute, tax, 'ute');
    expect(weight(ute)).toBeGreaterThan(weight(hatch) * 1.8);
    applyArchetype(ute, tax, 'hatch');
    expect(weight(ute)).toBeCloseTo(weight(hatch), 0);
  });

  it('does nothing for a kind it doesn’t know or a car with no parts', () => {
    expect(applyArchetype(car(), tax, 'hovercraft')).toBeNull();
    expect(applyArchetype(createEmptyProject({ name: 'T', slug: 't' }, '0', new Date('2026-01-01T00:00:00Z')), tax, 'hatch')).toBeNull();
  });
});
