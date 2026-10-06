import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';
import type { PowertrainEdits } from '../project/schema';
import type { DesignTarget } from './design';

/**
 * The engine builder and gearbox builder: every number a fitted engine or
 * gearbox's own jbeam has (mainEngine, turbocharger, supercharger, gearbox,
 * vehicleController, sound configs…), and applying the user's changes to
 * the game's parts before they're brought into the mod. Only values the game
 * already writes as numbers are offered, so the output never has a key the
 * game doesn't know; values driven by a tuning variable stay on the tuning page.
 */

/** Sections that aren't a device's settings (tables, slots, metadata). */
const NOT_SETTINGS = new Set(['information', 'slotType', 'slots', 'slots2', 'nodes', 'beams', 'triangles', 'flexbodies', 'props', 'variables', 'glowMap', 'sounds', 'controller', 'powertrain', 'energyStorage', 'hydros', 'rails', 'slidenodes', 'torsionbars', 'pressureWheels', 'quadTriangles', 'refNodes', 'cameraExternal', 'cameraChase', 'camerasInternal']);

/** Edit key for one number: "<part>/<section>/<key>". */
export const fieldKey = (part: string, section: string, key: string) => `${part}/${section}/${key}`;

/** Weight of every node in the set, as a multiplier (1 = the game's). */
export const MASS_SCALE = '@massScale';

export interface EditableField {
  key: string;
  part: string;
  section: string;
  name: string;
  /** The game's value. */
  value: number;
  label: string;
  unit: string;
  hint: string;
  /** Sensible slider range. */
  min: number;
  max: number;
  /** One of the settings mods usually change (shown outside advanced mode). */
  common: boolean;
}

/** What the well-known keys mean, for labels and ranges. Anything else is shown by its own name. */
const KNOWN: Record<string, { label: string; unit?: string; hint?: string; range?: [number, number] }> = {
  idleRPM: { label: 'Idle speed', unit: 'rpm', range: [300, 3000] },
  maxRPM: { label: 'Rev limit', unit: 'rpm', hint: 'Where the torque curve stops', range: [2000, 20000] },
  revLimiterRPM: { label: 'Rev limiter', unit: 'rpm', range: [2000, 20000] },
  revLimiterCutTime: { label: 'Limiter cut time', unit: 's', range: [0, 0.5] },
  revLimiterType: { label: 'Rev limiter type' },
  inertia: { label: 'Rotating inertia', unit: 'kg·m²', hint: 'Lower revs up faster', range: [0.01, 2] },
  friction: { label: 'Static friction', unit: 'Nm', range: [0, 100] },
  dynamicFriction: { label: 'Dynamic friction', unit: 'Nm/(rad/s)', range: [0, 0.2] },
  engineBrakeTorque: { label: 'Engine braking', unit: 'Nm', range: [0, 200] },
  burnEfficiency: { label: 'Burn efficiency', range: [0, 1] },
  thermalsEnabled: { label: 'Thermals enabled', range: [0, 1] },
  engineBlockTemperatureDamageThreshold: { label: 'Block damage temperature', unit: '°C', range: [100, 400] },
  cylinderWallTemperatureDamageThreshold: { label: 'Cylinder wall damage temperature', unit: '°C', range: [100, 400] },
  headGasketDamageThreshold: { label: 'Head gasket damage threshold', range: [0, 5000000] },
  pistonRingDamageThreshold: { label: 'Piston ring damage threshold', range: [0, 5000000] },
  connectingRodDamageThreshold: { label: 'Connecting rod damage threshold', range: [0, 5000000] },
  maxTorqueRating: { label: 'Torque rating (breaks above)', unit: 'Nm', range: [0, 5000] },
  maxOverTorqueDamage: { label: 'Over-torque damage', range: [0, 2000] },
  oilVolume: { label: 'Oil volume', unit: 'L', range: [0, 20] },
  // cooling (the radiator and oil cooler parts set these on the engine)
  radiatorArea: { label: 'Radiator core area', unit: 'm²', hint: 'Bigger cools better, adds drag', range: [0, 2] },
  radiatorEffectiveness: { label: 'Radiator effectiveness', hint: 'How well the core sheds heat (race radiators are higher)', range: [0, 50000] },
  coolantVolume: { label: 'Coolant volume', unit: 'L', range: [0, 40] },
  thermostatTemperature: { label: 'Thermostat opens', unit: '°C', range: [50, 120] },
  radiatorFanTemperature: { label: 'Fan switches on', unit: '°C', range: [50, 130] },
  radiatorFanMaxAirSpeed: { label: 'Fan air speed', unit: 'm/s', range: [0, 30] },
  radiatorFanVolume: { label: 'Fan volume', range: [0, 2] },
  oilRadiatorArea: { label: 'Oil cooler area', unit: 'm²', range: [0, 1] },
  oilRadiatorEffectiveness: { label: 'Oil cooler effectiveness', range: [0, 50000] },
  oilThermostatTemperature: { label: 'Oil thermostat opens', unit: '°C', range: [50, 150] },
  engineBlockAirCoolingEfficiency: { label: 'Block air cooling', hint: 'Air-cooled engines rely on this', range: [0, 200] },
  // fuel
  fuelConsumption: { label: 'Fuel consumption', range: [0, 5] },
  // brakes
  brakeTorque: { label: 'Brake torque', unit: 'Nm', range: [0, 20000] },
  parkingTorque: { label: 'Handbrake torque', unit: 'Nm', range: [0, 10000] },
  brakeSpring: { label: 'Brake spring', range: [0, 200] },
  fuelCapacity: { label: 'Fuel capacity', unit: 'L', range: [1, 400] },
  instantAfterFireCoef: { label: 'Backfire (instant)', hint: 'Pops on lift-off', range: [0, 5] },
  sustainedAfterFireCoef: { label: 'Backfire (sustained)', range: [0, 5] },
  instantAfterFireFuelDelay: { label: 'Backfire fuel delay', unit: 's', range: [0, 2] },
  starterTorque: { label: 'Starter torque', unit: 'Nm', range: [0, 200] },
  starterMaxAV: { label: 'Starter speed', unit: 'rad/s', range: [0, 200] },
  shiftLightRPM: { label: 'Shift light', unit: 'rpm', range: [1000, 20000] },
  // forced induction
  wastegateStart: { label: 'Wastegate opens', unit: 'psi', range: [0, 60] },
  wastegateLimit: { label: 'Wastegate limit', unit: 'psi', range: [0, 60] },
  wastegateFactor: { label: 'Wastegate factor', range: [0, 2] },
  maxExhaustPower: { label: 'Max exhaust power', range: [0, 100000] },
  turboSizeCoef: { label: 'Turbo size', range: [0, 5] },
  pressureRatePSI: { label: 'Boost build rate', unit: 'psi/s', range: [0, 200] },
  frictionCoef: { label: 'Friction', range: [0, 100] },
  bovEnabled: { label: 'Blow-off valve', range: [0, 1] },
  bovSoundVolumeCoef: { label: 'Blow-off volume', range: [0, 4] },
  hissVolumePerPSI: { label: 'Hiss volume per psi', range: [0, 1] },
  whineVolumePer10kRPM: { label: 'Whine volume', range: [0, 1] },
  whinePitchPer10kRPM: { label: 'Whine pitch', range: [0, 2] },
  gearRatio: { label: 'Pulley ratio', range: [0.1, 10] },
  // gearbox and shifting
  gearboxNode: { label: 'Gearbox node' },
  oneWayViscousCoef: { label: 'One-way viscous coupling', range: [0, 100] },
  lockTorque: { label: 'Lock torque', unit: 'Nm', range: [0, 10000] },
  clutchMass: { label: 'Clutch mass', unit: 'kg', range: [0, 50] },
  lowShiftDownRPM: { label: 'Downshift (low load)', unit: 'rpm', range: [500, 10000] },
  highShiftDownRPM: { label: 'Downshift (high load)', unit: 'rpm', range: [500, 10000] },
  lowShiftUpRPM: { label: 'Upshift (low load)', unit: 'rpm', range: [500, 20000] },
  highShiftUpRPM: { label: 'Upshift (high load)', unit: 'rpm', range: [500, 20000] },
  clutchLaunchStartRPM: { label: 'Launch clutch start', unit: 'rpm', range: [500, 10000] },
  clutchLaunchTargetRPM: { label: 'Launch clutch target', unit: 'rpm', range: [500, 10000] },
  // sound
  mainGain: { label: 'Main volume', unit: 'dB', range: [-40, 20] },
  onLoadGain: { label: 'On-load volume', range: [0, 2] },
  offLoadGain: { label: 'Off-load volume', range: [0, 2] },
  maxLoadMix: { label: 'Max load mix', range: [0, 1] },
  minLoadMix: { label: 'Min load mix', range: [0, 1] },
  intakeMuffling: { label: 'Intake muffling', range: [0, 1] },
  exhaustMuffling: { label: 'Exhaust muffling', range: [0, 1] },
  lowShelfGain: { label: 'Bass', unit: 'dB', range: [-24, 24] },
  highShelfGain: { label: 'Treble', unit: 'dB', range: [-24, 24] },
  eqLowGain: { label: 'EQ low', unit: 'dB', range: [-24, 24] },
  eqHighGain: { label: 'EQ high', unit: 'dB', range: [-24, 24] },
  eqFundamentalGain: { label: 'EQ fundamental', unit: 'dB', range: [-24, 24] },
};

/** Section headings as the builder shows them. */
export const SECTION_LABELS: Record<string, string> = {
  mainEngine: 'Engine',
  turbocharger: 'Turbocharger',
  supercharger: 'Supercharger',
  n2o: 'Nitrous',
  gearbox: 'Gearbox',
  vehicleController: 'Shifting (vehicle controller)',
  soundConfig: 'Sound: intake',
  soundConfigExhaust: 'Sound: exhaust',
  mainTank: 'Fuel tank',
  clutch: 'Clutch',
  torqueConverter: 'Torque converter',
};

function rangeFor(name: string, value: number): [number, number] {
  const known = KNOWN[name]?.range;
  if (known && value >= known[0] && value <= known[1]) return known;
  if (value === 0) return [0, 1];
  const mag = Math.abs(value);
  return value > 0 ? [0, mag * 3] : [-mag * 3, mag * 3];
}

/** Every number in the set's device sections, part by part. */
export function editableFields(parts: Readonly<Record<string, JbeamObject>>): EditableField[] {
  const out: EditableField[] = [];
  for (const [part, body] of Object.entries(parts)) {
    for (const [section, value] of Object.entries(body)) {
      if (NOT_SETTINGS.has(section) || !isJbeamObject(value)) continue;
      for (const [name, v] of Object.entries(value)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const known = KNOWN[name];
        const [min, max] = rangeFor(name, v);
        out.push({ key: fieldKey(part, section, name), part, section, name, value: v, label: known?.label ?? name, unit: known?.unit ?? '', hint: known?.hint ?? '', min, max, common: !!known });
      }
    }
  }
  return out;
}

/** [rpm, Nm] rows of a torque table (header row skipped; variable cells skipped). */
export function torqueTable(v: JbeamValue | undefined): [number, number][] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => (Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' ? [[r[0], r[1]] as [number, number]] : []));
}

/** The part whose mainEngine carries the torque curve (the engine's own part). */
export function torquePart(parts: Readonly<Record<string, JbeamObject>>, root: string): string | null {
  const has = (n: string) => {
    const m = parts[n]?.mainEngine;
    return isJbeamObject(m) && torqueTable(m.torque).length > 1;
  };
  if (has(root)) return root;
  return Object.keys(parts).find(has) ?? null;
}

/** The part whose gearbox section has the ratios. */
export function ratiosPart(parts: Readonly<Record<string, JbeamObject>>, root: string): string | null {
  const has = (n: string) => {
    const g = parts[n]?.gearbox;
    return isJbeamObject(g) && Array.isArray(g.gearRatios);
  };
  if (has(root)) return root;
  return Object.keys(parts).find(has) ?? null;
}

/**
 * The gear ratios as they'll be: the edited list, else the game's with any
 * $variables resolved to the tuning value or the variable's default.
 */
export function effectiveRatios(parts: Readonly<Record<string, JbeamObject>>, root: string, edits: PowertrainEdits, tuning: Readonly<Record<string, number>>, varDefaults: Readonly<Record<string, number>>): { ratios: number[]; usesVariables: boolean } {
  if (edits.gearRatios) return { ratios: edits.gearRatios, usesVariables: false };
  const p = ratiosPart(parts, root);
  const g = p ? parts[p]!.gearbox : undefined;
  const raw = isJbeamObject(g) && Array.isArray(g.gearRatios) ? g.gearRatios : [];
  let usesVariables = false;
  const ratios = raw.flatMap((r) => {
    if (typeof r === 'number') return [r];
    if (typeof r === 'string' && r.startsWith('$') && !r.startsWith('$=')) {
      usesVariables = true;
      const v = tuning[r] ?? varDefaults[r];
      return typeof v === 'number' ? [v] : [];
    }
    return [];
  });
  return { ratios, usesVariables };
}

export function effectiveTorque(parts: Readonly<Record<string, JbeamObject>>, root: string, edits: PowertrainEdits): [number, number][] {
  if (edits.torque) return edits.torque;
  const p = torquePart(parts, root);
  const m = p ? parts[p]!.mainEngine : undefined;
  return isJbeamObject(m) ? torqueTable(m.torque) : [];
}

/** Peak torque and power of a curve, up to `limit` rpm. */
export function curvePeaks(curve: readonly [number, number][], limit: number | null): { torque: { nm: number; rpm: number } | null; power: { kw: number; rpm: number } | null } {
  let torque: { nm: number; rpm: number } | null = null;
  let power: { kw: number; rpm: number } | null = null;
  for (const [rpm, nm] of curve) {
    if (limit !== null && rpm > limit) continue;
    if (!torque || nm > torque.nm) torque = { nm, rpm };
    const kw = (nm * rpm * 2 * Math.PI) / 60000;
    if (!power || kw > power.kw) power = { kw, rpm };
  }
  return { torque, power };
}

/** Node weights of the set, summed (option rows carry the running nodeWeight; a row's own object overrides it). */
export function setMass(parts: Readonly<Record<string, JbeamObject>>): number {
  let total = 0;
  for (const body of Object.values(parts)) {
    const table = body.nodes;
    if (!Array.isArray(table)) continue;
    let weight = 0;
    for (const row of table.slice(1)) {
      if (isJbeamObject(row)) {
        if (typeof row.nodeWeight === 'number') weight = row.nodeWeight;
        continue;
      }
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const own = row.find((c): c is JbeamObject => isJbeamObject(c));
      total += own && typeof own.nodeWeight === 'number' ? own.nodeWeight : weight;
    }
  }
  return total;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

function scaleNodeWeights(table: JbeamValue, k: number): JbeamValue {
  if (!Array.isArray(table)) return table;
  const scale = (o: JbeamObject): JbeamObject => (typeof o.nodeWeight === 'number' ? { ...o, nodeWeight: r4(o.nodeWeight * k) } : o);
  return table.map((row, i) => {
    if (i === 0) return row;
    if (isJbeamObject(row)) return scale(row);
    if (Array.isArray(row)) return row.map((c) => (isJbeamObject(c) ? scale(c) : c));
    return row;
  });
}

/**
 * The game's parts with the builder's changes applied (a copy; parts not
 * touched are shared). Keys that no longer match a number are skipped.
 */
export function applyPowertrainEdits(parts: Readonly<Record<string, JbeamObject>>, root: string, edits: PowertrainEdits | undefined): Record<string, JbeamObject> {
  const out: Record<string, JbeamObject> = { ...parts };
  if (!edits) return out;
  const touch = (part: string, section: string): JbeamObject | null => {
    const body = out[part];
    const sec = body?.[section];
    if (!body || !isJbeamObject(sec)) return null;
    if (out[part] === parts[part]) out[part] = { ...body };
    if (out[part]![section] === parts[part]?.[section]) out[part]![section] = { ...sec };
    return out[part]![section] as JbeamObject;
  };
  for (const [key, value] of Object.entries(edits.fields)) {
    if (key === MASS_SCALE) continue;
    const [part, section, name] = key.split('/');
    if (!part || !section || !name) continue;
    if (typeof parts[part]?.[section] !== 'object' || typeof (parts[part][section] as JbeamObject)[name] !== 'number') continue;
    touch(part, section)![name] = value;
  }
  // Words the game already has as words (an engine's sound sampleName…).
  for (const [key, value] of Object.entries(edits.texts ?? {})) {
    const [part, section, name] = key.split('/');
    if (!part || !section || !name) continue;
    if (typeof parts[part]?.[section] !== 'object' || typeof (parts[part][section] as JbeamObject)[name] !== 'string') continue;
    touch(part, section)![name] = value;
  }
  if (edits.torque && edits.torque.length > 1) {
    const p = torquePart(parts, root);
    const sec = p ? touch(p, 'mainEngine') : null;
    if (sec) {
      const header = Array.isArray(sec.torque) && Array.isArray(sec.torque[0]) ? sec.torque[0] : ['rpm', 'torque'];
      sec.torque = [header, ...[...edits.torque].sort((a, b) => a[0] - b[0]).map(([r, t]) => [r4(r), r4(t)])];
    }
  }
  if (edits.gearRatios && edits.gearRatios.length) {
    const p = ratiosPart(parts, root);
    const sec = p ? touch(p, 'gearbox') : null;
    if (sec) sec.gearRatios = edits.gearRatios.map(r4);
  }
  const k = edits.fields[MASS_SCALE];
  if (typeof k === 'number' && k > 0 && k !== 1) {
    for (const [name, body] of Object.entries(out)) if (Array.isArray(body.nodes)) out[name] = { ...body, nodes: scaleNodeWeights(body.nodes, k) };
  }
  // The modder's own versions: copies of a part in the same slot, with their own values.
  const taken = new Set<string>();
  for (const v of edits.versions ?? []) {
    const base = out[v.base];
    const name = `${v.base}_${v.id}`;
    if (!base || out[name]) continue;
    const copy = structuredClone(base);
    const info = isJbeamObject(copy.information) ? copy.information : {};
    copy.information = { ...info, name: v.label, ...(v.price !== null ? { value: v.price } : {}) };
    for (const [key, value] of Object.entries(v.fields)) {
      const [section, field] = key.split('/');
      const sec = section ? copy[section] : undefined;
      if (field && isJbeamObject(sec) && typeof sec[field] === 'number') sec[field] = value;
    }
    out[name] = copy;
    for (const [key, range] of Object.entries(v.tunable ?? {})) makeTunable(out, name, key, range, `jbf_${v.id}_`, taken);
  }
  // Settings the player can adjust in the game's tuning menu.
  for (const [key, range] of Object.entries(edits.tunable ?? {})) {
    const [part, ...rest] = key.split('/');
    if (part && out[part]) makeTunable(out, part, rest.join('/'), range, 'jbf_', taken);
  }
  return out;
}

const VARIABLES_HEADER = ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'];

/**
 * Make one number of a part a tuning variable: a $variable in the part's `variables` table (the
 * game's tuning menu shows it under the section's name, from min to max, starting at the value
 * the part has), and the number replaced by it. The part must already be a copy (it's changed).
 */
function makeTunable(out: Record<string, JbeamObject>, part: string, key: string, range: { min: number; max: number }, prefix: string, taken: Set<string>): void {
  const [section, field] = key.split('/');
  const body = out[part];
  if (!body || !section || !field) return;
  const sec = body[section];
  if (!isJbeamObject(sec) || typeof sec[field] !== 'number') return;
  const value = sec[field];
  const min = Math.min(range.min, range.max, value);
  const max = Math.max(range.min, range.max, value);
  let name = `$${prefix}${section}_${field}`.replace(/[^A-Za-z0-9_$]/g, '_');
  for (let i = 2; taken.has(name); i++) name = `$${prefix}${section}_${field}_${i}`.replace(/[^A-Za-z0-9_$]/g, '_');
  taken.add(name);
  const known = KNOWN[field];
  const table = Array.isArray(body.variables) && Array.isArray(body.variables[0]) ? body.variables : [VARIABLES_HEADER];
  const nextSec = { ...sec, [field]: name };
  out[part] = { ...body, [section]: nextSec, variables: [...table, [name, 'range', known?.unit ?? '', SECTION_LABELS[section] ?? section, r4(value), r4(min), r4(max), known?.label ?? field, known?.hint ?? `${field} (${SECTION_LABELS[section] ?? section})`]] };
}

/** Torque curve operations the builder offers. */
export const curveOps = {
  /** Every point's torque times k. */
  scale: (curve: readonly [number, number][], k: number): [number, number][] => curve.map(([r, t]) => [r, r4(t * k)]),
  /** Stretch the rpm axis so the curve ends at `toRpm` (rev it higher or lower). */
  stretch: (curve: readonly [number, number][], toRpm: number): [number, number][] => {
    const top = Math.max(...curve.map(([r]) => r), 1);
    return curve.map(([r, t]) => [Math.round((r / top) * toRpm), t]);
  },
  /** Set one point. */
  set: (curve: readonly [number, number][], i: number, nm: number): [number, number][] => curve.map((p, j) => (j === i ? [p[0], r4(Math.max(0, nm))] : p)),
  /** Add a point halfway between two others (or past the end). */
  insertAfter: (curve: readonly [number, number][], i: number): [number, number][] => {
    const a = curve[i]!;
    const b = curve[i + 1];
    const p: [number, number] = b ? [Math.round((a[0] + b[0]) / 2), r4((a[1] + b[1]) / 2)] : [a[0] + 500, a[1]];
    return [...curve.slice(0, i + 1), p, ...curve.slice(i + 1)];
  },
  remove: (curve: readonly [number, number][], i: number): [number, number][] => (curve.length > 2 ? curve.filter((_, j) => j !== i) : [...curve]),
};

/**
 * Forward gear ratios in a geometric progression from first to top gear
 * (the classic even spacing), as the jbeam lists them: reverse, neutral, forward.
 */
export function spacedRatios(reverse: number, first: number, top: number, gears: number): number[] {
  const n = Math.max(1, Math.round(gears));
  const forward = n === 1 ? [first] : Array.from({ length: n }, (_, i) => r4(first * (top / first) ** (i / (n - 1))));
  return [-Math.abs(reverse), 0, ...forward];
}

/** Road speed in km/h at `rpm` in a gear. */
export function speedAt(rpm: number, gear: number, finalDrive: number, tyreRadiusM: number): number {
  if (!gear || !finalDrive) return 0;
  return ((rpm / (Math.abs(gear) * finalDrive)) * 2 * Math.PI * tyreRadiusM * 60) / 1000;
}

/** An engine's sound configs (intake, exhaust…): the sections that name a sound blend. */
export interface SoundConfig {
  part: string;
  section: string;
  /** Edit key of its sampleName. */
  key: string;
  /** The game's blend. */
  sampleName: string;
}

export function soundConfigs(parts: Readonly<Record<string, JbeamObject>>): SoundConfig[] {
  const out: SoundConfig[] = [];
  for (const [part, body] of Object.entries(parts)) {
    for (const [section, value] of Object.entries(body)) {
      if (!isJbeamObject(value) || typeof value.sampleName !== 'string') continue;
      out.push({ part, section, key: fieldKey(part, section, 'sampleName'), sampleName: value.sampleName });
    }
  }
  return out;
}

/** Cylinders from an engine's name ("3.5L V6", "I4", "Flat 6"…), for the synthesized preview; null when unknown. */
export function cylindersOf(text: string): number | null {
  const m = /\b(?:[VIWLH]|flat[- ]?|boxer[- ]?|inline[- ]?|straight[- ]?)(\d{1,2})\b/i.exec(text) ?? /\b(\d{1,2})[- ]?cyl/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 16) return n;
  if (/rotary|wankel/i.test(text)) return 2;
  return null;
}

/** What the engine designer can set on this base engine (keys it already has), and its weight. */
export function designTarget(parts: Readonly<Record<string, JbeamObject>>, root: string): DesignTarget {
  const tp = torquePart(parts, root);
  const keys: DesignTarget['keys'] = {};
  const main = tp ? parts[tp]!.mainEngine : undefined;
  if (tp && isJbeamObject(main)) for (const name of ['maxRPM', 'revLimiterRPM', 'idleRPM', 'inertia', 'friction', 'dynamicFriction', 'engineBrakeTorque'] as const) if (typeof main[name] === 'number') keys[name] = fieldKey(tp, 'mainEngine', name);
  let hasTurbo = false;
  for (const [part, body] of Object.entries(parts)) {
    const t = body.turbocharger;
    if (!isJbeamObject(t)) continue;
    hasTurbo = true;
    if (typeof t.wastegateStart === 'number') keys.wastegateStart ??= fieldKey(part, 'turbocharger', 'wastegateStart');
    if (typeof t.wastegateLimit === 'number') keys.wastegateLimit ??= fieldKey(part, 'turbocharger', 'wastegateLimit');
  }
  return { keys, hasTurbo, gameMassKg: setMass(parts) };
}
