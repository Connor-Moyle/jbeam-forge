import type { Project, VehicleConfig } from '../project/schema';
import { curvePeaks, effectiveRatios, effectiveTorque, setMass } from '../powertrain/edits';
import { engineSpecs, gearboxSpecs } from '../powertrain/specs';
import { DEFAULT_DRIVETRAIN, planDrivetrain } from '../powertrain/drivetrain';
import { includedParts, partsValue, slotChoices, type PcFile } from './configs';
import { engineSlotType, engineTags, type SuspensionSetData, type TaxonomyLookup } from './jbeam';

/**
 * What a configuration adds up to (fork), for the configurations manager and
 * the vehicle selector's info file: weight, power and torque, drivetrain,
 * gearbox, fuel and induction, and value.
 */

type Doc = Pick<Project, 'meta' | 'parts' | 'variables' | 'nodes'> & Partial<Pick<Project, 'axles' | 'assignments' | 'paints' | 'powertrain'>>;
type Sets = Readonly<Record<string, Pick<SuspensionSetData, 'parts' | 'root'>>>;

export interface ConfigStats {
  /** Node weights of everything on the car, kg (null when there's no structure yet). */
  weightKg: number | null;
  powerKw: number | null;
  torqueNm: number | null;
  /** Power to weight, kW per tonne. */
  kwPerTonne: number | null;
  engine: string | null;
  drivetrain: string | null;
  transmission: string | null;
  fuelType: string | null;
  induction: string | null;
  value: number;
}

const FUEL: Record<string, string> = { petrol: 'Gasoline', diesel: 'Diesel', electric: 'Electric' };

export function configStats(doc: Doc, tax: TaxonomyLookup, pc: PcFile, sets: Sets = {}): ConfigStats {
  const on = includedParts(doc, tax, pc, sets);
  let weight = doc.nodes.filter((n) => on.has(n.partId)).reduce((s, n) => s + n.weight, 0);
  const value = partsValue(doc, tax, pc);

  // The engine this configuration picks (the default one unless its slot says otherwise).
  const pt = doc.powertrain;
  let engine = pt?.engine ?? null;
  if (pt?.engine && pt.alternates?.length) {
    const chosen = pc.parts[engineSlotType(doc.meta.slug)];
    const tags = engineTags(pt);
    engine = [pt.engine, ...pt.alternates].find((e) => sets[e.setId] && chosen === `${doc.meta.slug}_${tags.get(e.sourceId)}_${sets[e.setId]!.root}`) ?? pt.engine;
  }
  let powerKw: number | null = null;
  let torqueNm: number | null = null;
  let fuelType: string | null = null;
  let induction: string | null = null;
  let engineName: string | null = null;
  const engineSet = engine ? sets[engine.setId] : undefined;
  if (engine && engineSet) {
    const root = engineSet.parts[engineSet.root];
    if (root) {
      const specs = engineSpecs(root, Object.values(engineSet.parts), `${engine.vehicle} ${engine.name}`);
      const limitKey = Object.keys(engine.edits.fields).find((k) => k.endsWith('/mainEngine/maxRPM'));
      const peaks = curvePeaks(effectiveTorque(engineSet.parts, engineSet.root, engine.edits), limitKey ? engine.edits.fields[limitKey]! : specs.maxRPM);
      powerKw = peaks.power ? Math.round(peaks.power.kw) : null;
      torqueNm = peaks.torque ? Math.round(peaks.torque.nm) : null;
      fuelType = FUEL[specs.fuel] ?? null;
      induction = specs.fuel === 'electric' ? null : specs.forcedInduction === 'turbo' ? 'Turbocharged' : specs.forcedInduction === 'supercharger' ? 'Supercharged' : 'Naturally aspirated';
      engineName = `${specs.layout}${specs.displacementL ? ` ${specs.displacementL.toFixed(1)} L` : ''}`;
    }
    weight += setMass(engineSet.parts);
  }
  let transmission: string | null = null;
  const boxSet = pt?.gearbox ? sets[pt.gearbox.setId] : undefined;
  if (pt?.gearbox && boxSet) {
    const root = boxSet.parts[boxSet.root];
    if (root) {
      const specs = gearboxSpecs(root);
      const gears = pt.gearbox.edits.gearRatios ? effectiveRatios(boxSet.parts, boxSet.root, pt.gearbox.edits, pt.gearbox.tuning, {}).ratios.filter((r) => r > 0).length : specs.gears;
      transmission = specs.kind === 'CVT' ? 'CVT' : `${gears}-speed ${specs.kind}`;
    }
    weight += setMass(boxSet.parts);
  }
  // Axles this configuration fits (an axle slot left empty takes its suspension off).
  const axleSlots = slotChoices(doc, tax, sets).filter((s) => s.setPartIds);
  const fitted = (doc.axles ?? []).flatMap((a, index) => {
    const set = a.fitted ? sets[a.fitted.setId] : undefined;
    const slot = axleSlots.find((s) => s.label === `${a.name} suspension`);
    if (!set || (slot && !pc.parts[slot.slotType])) return [];
    return [{ index, name: a.name, y: a.y, parts: set.parts }];
  });
  for (const a of fitted) weight += setMass(a.parts);
  let drivetrain: string | null = null;
  if (fitted.length && (engineSet || boxSet)) {
    const plan = planDrivetrain({ engine: engineSet?.parts ?? null, gearbox: boxSet?.parts ?? null, axles: fitted }, pt?.drivetrain ?? DEFAULT_DRIVETRAIN);
    const driven = plan.axles.filter((a) => a.driven);
    drivetrain = !driven.length ? null : driven.length > 1 && driven.some((a) => a.front) && driven.some((a) => !a.front) ? 'AWD' : driven.every((a) => a.front) && fitted.length > 1 ? 'FWD' : 'RWD';
  }
  const weightKg = weight > 0 ? Math.round(weight) : null;
  return {
    weightKg,
    powerKw,
    torqueNm,
    kwPerTonne: powerKw && weightKg ? Math.round((powerKw / weightKg) * 1000) : null,
    engine: engineName,
    drivetrain,
    transmission,
    fuelType,
    induction,
    value,
  };
}

/** The labels a configuration's info file gets: the user's where set, else worked out. */
export function configLabels(stats: ConfigStats, info: VehicleConfig['info']): Record<string, string | number | { min: number; max: number }> {
  const out: Record<string, string | number | { min: number; max: number }> = {};
  const put = (key: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== '') out[key] = v;
  };
  put('Drivetrain', info?.drivetrain ?? stats.drivetrain);
  put('Transmission', info?.transmission ?? stats.transmission);
  put('Fuel Type', info?.fuelType ?? stats.fuelType);
  put('Induction Type', info?.induction ?? stats.induction);
  if (info?.years) out.Years = info.years;
  put('Population', info?.population);
  return out;
}
