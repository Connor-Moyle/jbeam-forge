import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { mergeTaxonomy, TaxonomyFileSchema, validateTaxonomy, type TaxonomyEntry } from '../../src/shared/taxonomy/schema';

const entries = TaxonomyFileSchema.parse(shipped).entries;

describe('shipped taxonomy', () => {
  it('parses against the schema', () => {
    expect(entries.length).toBeGreaterThan(120);
  });

  it('has no structural problems (unique ids/prefixes/slotTypes, parents exist, no cycles, one root)', () => {
    expect(validateTaxonomy(entries)).toEqual([]);
  });

  it('covers the SPEC §4.3 part families', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of [
      'body', 'rollcage', 'subframe', 'firewall', 'hood', 'door', 'fender', 'bumper', 'splitter', 'lip', 'diffuser', 'wing', 'canard', 'fender_flare',
      'headlight', 'foglight', 'plate_light', 'light_bar', 'windshield', 'door_glass', 'quarter_glass', 'sunroof', 'grille', 'mirror', 'door_handle',
      'wiper', 'roof_rack', 'dashboard', 'door_card', 'window_switch', 'seat', 'steering_wheel', 'shifter', 'handbrake', 'pedals', 'gauges',
      'headliner', 'carpet', 'parcel_shelf', 'center_console', 'engine', 'exhaust', 'intake', 'radiator', 'intercooler', 'fuel_tank', 'fuel_door',
      'battery', 'wheel', 'brake_disc', 'steering_rack', 'driveshaft', 'differential', 'halfshaft', 'license_plate', 'tow_hitch', 'custom',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('marks openable parts (doors, hood, trunk, tailgate) as openable', () => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const id of ['door', 'hood', 'trunk', 'tailgate', 'fuel_door']) expect(byId.get(id)?.openable, id).toBe(true);
  });
});

const entry = (over: Partial<TaxonomyEntry>): TaxonomyEntry => ({
  id: 'x',
  label: 'X',
  category: 'C',
  subcategory: 'S',
  positionAxis: 'none',
  slotType: over.id ?? 'x',
  parent: 'body',
  defaultMass: 1,
  defaultPrice: 100,
  nodePrefix: over.id?.slice(0, 5) ?? 'x',
  beamPreset: 'mechanical',
  openable: false,
  nameHints: [],
  ...over,
});

describe('validateTaxonomy', () => {
  const root = entry({ id: 'body', parent: null, nodePrefix: 'b' });

  it('detects cycles', () => {
    const problems = validateTaxonomy([root, entry({ id: 'aa', parent: 'bb', nodePrefix: 'aa' }), entry({ id: 'bb', parent: 'aa', nodePrefix: 'bb' })]);
    expect(problems.map((p) => p.problem)).toContain('parent chain loops');
  });

  it('detects missing parents, duplicate prefixes and extra roots', () => {
    const problems = validateTaxonomy([root, entry({ id: 'aa', parent: 'ghost', nodePrefix: 'b' }), entry({ id: 'cc', parent: null, nodePrefix: 'cc' })]);
    const text = problems.map((p) => p.problem).join(' | ');
    expect(text).toMatch(/parent "ghost" does not exist/);
    expect(text).toMatch(/nodePrefix "b" already used/);
    expect(text).toMatch(/exactly one root/);
  });

  it('later layers override earlier ones by id', () => {
    const merged = mergeTaxonomy([root, entry({ id: 'aa', label: 'Old', nodePrefix: 'aa' })], [entry({ id: 'aa', label: 'New', nodePrefix: 'aa' })]);
    expect(merged.find((e) => e.id === 'aa')?.label).toBe('New');
    expect(merged).toHaveLength(2);
  });
});
