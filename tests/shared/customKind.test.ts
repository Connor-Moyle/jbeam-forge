import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { mergeTaxonomy, TaxonomyFileSchema, TaxonomyEntrySchema, validateTaxonomy } from '../../src/shared/taxonomy/schema';
import { buildCustomEntry, uniqueNodePrefix } from '../../src/shared/parts/custom';

const entries = TaxonomyFileSchema.parse(shipped).entries;
const input = { label: 'Ducktail Spoiler', category: 'Bumpers & Aero', parent: 'trunk', positionAxis: 'none' as const, openable: false, defaultMass: 2, beamPreset: 'panel_plastic' as const };

describe('buildCustomEntry', () => {
  it('produces a schema-valid entry that merges without problems', () => {
    const e = buildCustomEntry(input, entries);
    expect(TaxonomyEntrySchema.parse(e)).toEqual(e);
    expect(e).toMatchObject({ id: 'ducktail_spoiler', slotType: 'ducktail_spoiler', subcategory: 'Custom' });
    expect(validateTaxonomy(mergeTaxonomy(entries, [e]))).toEqual([]);
  });

  it('makes ids and prefixes unique and ids start with a letter', () => {
    expect(buildCustomEntry({ ...input, label: 'Door' }, entries).id).toBe('door_2');
    expect(buildCustomEntry({ ...input, label: '2nd wing' }, entries).id).toBe('custom_2nd_wing');
    expect(uniqueNodePrefix('spoiler', new Set())).toBe('spl');
    expect(uniqueNodePrefix('spoiler', new Set(['spl']))).toBe('splr');
    expect(uniqueNodePrefix('door', new Set())).toBe('doo'); // skeleton "dr" too short → plain letters
    expect(uniqueNodePrefix('ab', new Set())).toBe('ab1');
  });
});
