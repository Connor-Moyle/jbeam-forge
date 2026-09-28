import { beforeAll, describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier } from '../../src/shared/taxonomy/classify';
import { createEmptyProject } from '../../src/shared/project/io';
import { createPart, assignMeshes } from '../../src/shared/parts/ops';
import { emptyEdits } from '../../src/shared/project/schema';
import { buildJbeamFiles } from '../../src/shared/export/jbeam';
import { parseJbeam, isJbeamObject, type JbeamObject } from '../../src/shared/jbeam/parse';
import { meshoptReady } from '../../src/shared/proxy/shapes';
import { applyPowertrainEdits, curveOps, curvePeaks, editableFields, effectiveRatios, effectiveTorque, fieldKey, MASS_SCALE, setMass, spacedRatios, speedAt } from '../../src/shared/powertrain/edits';

const tax = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

const ENGINE: Record<string, JbeamObject> = {
  v6_engine: {
    information: { name: '3.5L V6' },
    slotType: 'car_engine',
    slots2: [['name', 'allowTypes', 'denyTypes', 'default', 'description'], ['v6_intake', ['v6_intake'], [], 'v6_intake_turbo', 'Intake']],
    mainEngine: { torque: [['rpm', 'torque'], [0, 0], [2000, 300], [4000, 400], [6000, 380]], idleRPM: 750, maxRPM: 6500, inertia: 0.1, requiredEnergyType: 'gasoline', friction: '$fric' },
    nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 20 }, ['e1', 0, -1, 0.5], ['e2', 0, -1.2, 0.5, { nodeWeight: 30 }]],
  },
  v6_intake_turbo: {
    information: { name: 'Turbo' },
    slotType: 'v6_intake',
    turbocharger: { wastegateStart: 12, maxExhaustPower: 4000, bovSoundFileName: 'event:>turbo' },
  },
};

describe('engine and gearbox builder', () => {
  it('offers every number of the device sections, never tables or strings', () => {
    const f = editableFields(ENGINE);
    const keys = f.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining([fieldKey('v6_engine', 'mainEngine', 'idleRPM'), fieldKey('v6_engine', 'mainEngine', 'maxRPM'), fieldKey('v6_intake_turbo', 'turbocharger', 'wastegateStart')]));
    // variables ($fric), strings, the torque table and the nodes table aren't fields
    expect(keys.some((k) => /friction|torque|requiredEnergyType|bovSound|nodes/.test(k))).toBe(false);
    const limit = f.find((x) => x.name === 'maxRPM')!;
    expect(limit).toMatchObject({ label: 'Rev limit', unit: 'rpm', value: 6500 });
    expect(limit.min).toBeLessThanOrEqual(6500);
    expect(limit.max).toBeGreaterThanOrEqual(6500);
  });

  it('applies fields, the torque curve and the weight to a copy', () => {
    const edits = { ...emptyEdits(), fields: { [fieldKey('v6_engine', 'mainEngine', 'maxRPM')]: 8000, [fieldKey('v6_intake_turbo', 'turbocharger', 'wastegateStart')]: 20, 'v6_engine/mainEngine/unknownKey': 3, [MASS_SCALE]: 0.5 }, torque: [[6000, 500], [0, 0], [3000, 450]] as [number, number][] };
    const out = applyPowertrainEdits(ENGINE, 'v6_engine', edits);
    const main = out.v6_engine!.mainEngine as JbeamObject;
    expect(main.maxRPM).toBe(8000);
    expect(main.unknownKey).toBeUndefined(); // only numbers the game has
    expect(main.torque).toEqual([['rpm', 'torque'], [0, 0], [3000, 450], [6000, 500]]); // sorted, header kept
    expect((out.v6_intake_turbo!.turbocharger as JbeamObject).wastegateStart).toBe(20);
    expect(setMass(out)).toBeCloseTo((20 + 30) / 2);
    // the game's data is untouched
    expect((ENGINE.v6_engine!.mainEngine as JbeamObject).maxRPM).toBe(6500);
    expect(setMass(ENGINE)).toBe(50);
  });

  it('reads the curve and its peaks, and reshapes it', () => {
    const curve = effectiveTorque(ENGINE, 'v6_engine', emptyEdits());
    expect(curve).toEqual([[0, 0], [2000, 300], [4000, 400], [6000, 380]]);
    const peaks = curvePeaks(curve, 6500);
    expect(peaks.torque).toEqual({ nm: 400, rpm: 4000 });
    expect(peaks.power!.rpm).toBe(6000);
    expect(curveOps.scale(curve, 1.5)[2]).toEqual([4000, 600]);
    expect(curveOps.stretch(curve, 9000).at(-1)).toEqual([9000, 380]);
    expect(curveOps.insertAfter(curve, 1)[2]).toEqual([3000, 350]);
    expect(curveOps.remove(curve, 0)).toHaveLength(3);
    expect(curveOps.set(curve, 1, -5)[1]).toEqual([2000, 0]);
  });

  it('handles gear ratios: the game ratios (with variables), edited, spaced, and road speeds', () => {
    const box = { gb: { gearbox: { gearRatios: [-3.2, 0, '$gear_1', 2.0, 1.4, 1.0] } } } as unknown as Record<string, JbeamObject>;
    expect(effectiveRatios(box, 'gb', emptyEdits(), {}, { $gear_1: 3.5 })).toEqual({ ratios: [-3.2, 0, 3.5, 2.0, 1.4, 1.0], usesVariables: true });
    expect(effectiveRatios(box, 'gb', emptyEdits(), { $gear_1: 3.9 }, { $gear_1: 3.5 }).ratios[2]).toBe(3.9);
    const spaced = spacedRatios(3.3, 3.6, 0.7, 6);
    expect(spaced.slice(0, 3)).toEqual([-3.3, 0, 3.6]);
    expect(spaced.at(-1)).toBeCloseTo(0.7);
    expect(spaced).toHaveLength(8);
    const out = applyPowertrainEdits(box, 'gb', { ...emptyEdits(), gearRatios: spaced });
    expect((out.gb!.gearbox as JbeamObject).gearRatios).toEqual(spaced.map((r) => Math.round(r * 10000) / 10000));
    // 1:1 gear, 4.1 final drive, 0.31 m tyre, 6000 rpm ≈ 171 km/h
    expect(speedAt(6000, 1, 4.1, 0.31)).toBeCloseTo(171.0, 0);
    expect(speedAt(6000, 0, 4.1, 0.31)).toBe(0);
  });
});

describe('builder edits on export', () => {
  beforeAll(async () => {
    await meshoptReady;
  });

  it('writes the edited engine into the mod under its new names', () => {
    const doc = createEmptyProject({ name: 'Test Car', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
    createPart(doc, tax, { taxonomyId: 'body', id: 'p_body' });
    const stand = createPart(doc, tax, { taxonomyId: 'engine_set', id: 'p_engine' });
    assignMeshes(doc, ['eng:block'], stand.id);
    doc.sources.push({ id: 'eng', placement: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } } as never);
    doc.powertrain.engine = { setId: 'car/v6', name: 'V6', vehicle: 'Car', type: 'V6', sourceId: 'eng', tuning: {}, edits: { ...emptyEdits(), fields: { [fieldKey('v6_engine', 'mainEngine', 'idleRPM')]: 900 }, torque: [[0, 0], [5000, 600]] } };
    const files = buildJbeamFiles(doc, tax, { meshNames: new Map(), author: 'x', suspensions: { 'car/v6': { parts: ENGINE, root: 'v6_engine', anchors: {} } } });
    const file = files.find((f) => f.part === 'test_E_v6_engine')!;
    const v = parseJbeam(file.text).value;
    expect(isJbeamObject(v)).toBe(true);
    const main = ((v as JbeamObject).test_E_v6_engine as JbeamObject).mainEngine as JbeamObject;
    expect(main.idleRPM).toBe(900);
    expect(main.torque).toEqual([['rpm', 'torque'], [0, 0], [5000, 600]]);
    // the turbo sub-part came along too, renamed
    expect(files.some((f) => f.part === 'test_E_v6_intake_turbo')).toBe(true);
  });
});

describe('more than one engine', () => {
  beforeAll(async () => {
    await meshoptReady;
  });

  const I4: Record<string, JbeamObject> = {
    i4_engine: { information: { name: '2.0L I4' }, slotType: 'other_engine', mainEngine: { torque: [['rpm', 'torque'], [0, 0], [6000, 200]], idleRPM: 800 } },
  };

  function twoEngines() {
    const doc = createEmptyProject({ name: 'Test Car', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
    createPart(doc, tax, { taxonomyId: 'body', id: 'p_body' });
    assignMeshes(doc, ['eng:block'], createPart(doc, tax, { taxonomyId: 'engine_set', id: 'p_v6' }).id);
    assignMeshes(doc, ['eng2:block'], createPart(doc, tax, { taxonomyId: 'engine_set', id: 'p_i4' }).id);
    for (const id of ['eng', 'eng2']) doc.sources.push({ id, placement: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } } as never);
    doc.powertrain.engine = { setId: 'car/v6', name: 'V6', vehicle: 'Car', type: 'V6', sourceId: 'eng', tuning: {}, edits: emptyEdits() };
    doc.powertrain.alternates = [{ setId: 'other/i4', name: 'I4', vehicle: 'Other', type: 'I4', sourceId: 'eng2', tuning: {}, edits: emptyEdits() }];
    const sets = { 'car/v6': { parts: ENGINE, root: 'v6_engine', anchors: {} }, 'other/i4': { parts: I4, root: 'i4_engine', anchors: {} } };
    return { doc, sets };
  }

  it('ships every engine in the default engine’s slot', () => {
    const { doc, sets } = twoEngines();
    const files = buildJbeamFiles(doc, tax, { meshNames: new Map(), author: 'x', suspensions: sets });
    const alt = parseJbeam(files.find((f) => f.part === 'test_E2_i4_engine')!.text).value as JbeamObject;
    expect((alt.test_E2_i4_engine as JbeamObject).slotType).toBe('test_E_car_engine');
    expect(files.some((f) => f.part === 'test_E_v6_engine')).toBe(true);
  });

  it('lets each configuration pick its engine, with only that engine on the car', async () => {
    const { resolveConfig, includedParts, slotChoices } = await import('../../src/shared/export/configs');
    const { doc, sets } = twoEngines();
    const slot = slotChoices(doc, tax, sets).find((s) => s.label === 'Engine')!;
    expect(slot.options.map((o) => o.name)).toEqual(['test_E_v6_engine', 'test_E2_i4_engine']);
    const cfg = { id: 'c', name: 'Economy', description: '', type: 'Factory', parts: { [slot.slotType]: 'test_E2_i4_engine' }, vars: {}, paints: [null, null, null] as [null, null, null] };
    const pc = resolveConfig(doc, tax, cfg, sets);
    expect(pc.parts[slot.slotType]).toBe('test_E2_i4_engine');
    const on = includedParts(doc, tax, pc, sets);
    expect(on.has('p_i4')).toBe(true);
    expect(on.has('p_v6')).toBe(false);
    expect(includedParts(doc, tax, resolveConfig(doc, tax, null, sets), sets).has('p_v6')).toBe(true);
  });
});
