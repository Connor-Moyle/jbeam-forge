import { describe, expect, it } from 'vitest';
import { engineModFiles, rimModFiles, toCommon, tyreModFiles } from '../../src/shared/export/modKinds';
import { parseJbeam, isJbeamObject, type JbeamObject } from '../../src/shared/jbeam/parse';
import { readTable } from '../../src/shared/jbeam/tables';
import { defaultRim, defaultTyre, sizeLabel, tyreRadius, tyreSlot } from '../../src/shared/wheels/schema';
import { emptyEdits, type FittedSet } from '../../src/shared/project/schema';

/** Every option object in a table (a section of options with no rows). */
const optionsOf = (section: unknown) => Object.assign({}, ...(section as unknown[]).filter((x) => isJbeamObject(x as never))) as JbeamObject;

const parts = (text: string) => {
  const v = parseJbeam(text).value;
  if (!isJbeamObject(v)) throw new Error('not an object');
  return v as Record<string, JbeamObject>;
};

describe('tyre mods', () => {
  it('make a part per size and axle in the rims’ tyre slot, with its pressure wheel values', () => {
    const spec = { ...defaultTyre('Grip'), sizes: [{ width: 225, aspect: 45, rim: 17, rimWidth: 8 }, { width: 245, aspect: 40, rim: 18, rimWidth: 8.5 }] };
    const [file] = tyreModFiles('grip', 'Me', spec, ['grip_tyre']);
    expect(file!.path).toBe('vehicles/common/grip/grip_tyres.jbeam');
    const p = parts(file!.text);
    expect(Object.keys(p).sort()).toEqual(['grip_225_45_17_F', 'grip_225_45_17_R', 'grip_245_40_18_F', 'grip_245_40_18_R']);
    const front = p.grip_225_45_17_F!;
    expect(front.slotType).toBe('tire_F_17x8');
    expect(p.grip_245_40_18_R!.slotType).toBe('tire_R_18x8.5');
    expect(readTable(front.pressureWheels!).records).toHaveLength(0);
    const o = optionsOf(front.pressureWheels);
    expect(o).toMatchObject({ hasTire: true, pressurePSI: 32, frictionCoef: spec.frictionCoef });
    expect(o.radius).toBeCloseTo(tyreRadius(spec.sizes[0]!), 4);
    const flex = readTable(front.flexbodies!).records.map((r) => r.values['[group]:']);
    expect(flex).toEqual([['tire_FR'], ['tire_FL']]);
  });

  it('knows sizes', () => {
    const s = { width: 205, aspect: 55, rim: 16, rimWidth: 7 };
    expect(sizeLabel(s)).toBe('205/55R16');
    expect(tyreRadius(s)).toBeCloseTo(0.2032 + 0.11275, 4);
    expect(tyreSlot('R', 16, 7)).toBe('tire_R_16x7');
  });
});

describe('wheel mods', () => {
  it('fill the hub’s wheel slot and offer the tyre slot for their size', () => {
    const [file] = rimModFiles('alloy', 'Me', { ...defaultRim('Alloy'), axles: 'F' }, []);
    const p = parts(file!.text);
    const rim = p.alloy_17x8_F!;
    expect(rim.slotType).toBe('wheel_F_5');
    expect(readTable(rim.slots!).records[0]!.values.type).toBe('tire_F_17x8');
    expect(optionsOf(rim.pressureWheels).hubRadius).toBeCloseTo(0.2159, 4);
    expect(rim.flexbodies).toBeUndefined();
  });

  it('move shared files to vehicles/common', () => {
    expect(toCommon('vehicles/alloy/main.materials.json', 'alloy')).toBe('vehicles/common/alloy/main.materials.json');
    expect(toCommon('vehicles/other/x', 'alloy')).toBe('vehicles/other/x');
  });
});

describe('engine mods', () => {
  const set = {
    root: 'car_engine_v8',
    anchors: {},
    parts: {
      car_engine_v8: { information: { name: 'V8' }, slotType: 'car_engine', slots: [['type', 'default', 'description'], ['car_turbo', 'car_turbo_stock', 'Turbo']], mainEngine: { maxRPM: 7000, torque: [['rpm', 'torque'], [0, 100], [7000, 400]] } },
      car_turbo_stock: { information: { name: 'Stock turbo' }, slotType: 'car_turbo', turbocharger: { maxPressure: 10 } },
    } as Record<string, JbeamObject>,
  };
  const engine: FittedSet = { setId: 'car/car_engine_v8', name: 'V8', vehicle: 'car', type: 'engine', sourceId: 's', tuning: {}, edits: { ...emptyEdits(), fields: { 'car_engine_v8/mainEngine/maxRPM': 8000, 'car_turbo_stock/turbocharger/maxPressure': 14 } } };

  it('a new part in the car’s engine slot, with changed sub-parts renamed and pointed at', () => {
    const r = engineModFiles({ meta: { slug: 'boost', name: 'Boosted V8' } as never, powertrain: { engine, gearbox: null } }, 'Me', { 'car/car_engine_v8': set });
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(['vehicles/car/boost_engine.jbeam']);
    const p = parts(r.files[0]!.text);
    const root = p.boost_car_engine_v8!;
    expect(root.slotType).toBe('car_engine');
    expect((root.mainEngine as JbeamObject).maxRPM).toBe(8000);
    expect((root.information as JbeamObject).name).toBe('Boosted V8');
    expect(readTable(root.slots!).records[0]!.values.default).toBe('boost_car_turbo_stock');
    expect(((p.boost_car_turbo_stock!.turbocharger as JbeamObject).maxPressure)).toBe(14);
    // The game's own parts are never written.
    expect(p.car_engine_v8).toBeUndefined();
  });

  it('says what is missing', () => {
    expect(engineModFiles({ meta: { slug: 'x', name: 'X' } as never, powertrain: { engine: null, gearbox: null } }, '', {}).errors[0]).toMatch(/Pick an engine/);
    expect(engineModFiles({ meta: { slug: 'x', name: 'X' } as never, powertrain: { engine, gearbox: null } }, '', {}).errors[0]).toMatch(/isn't loaded/);
  });
});
