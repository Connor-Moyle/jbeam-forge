import type { JbeamObject, JbeamValue } from '../jbeam/parse';

/**
 * Drive shafts (fork): joins the gearbox to the fitted axles' differentials.
 *
 * Each game part set brings its own `powertrain` rows ([type, name,
 * inputName, inputIndex, options?]). An axle cut from one car expects its
 * differential to be fed by a device of that car ("driveshaft",
 * "transfercase"…) that isn't here when the gearbox comes from another car,
 * so the car wouldn't drive. This works out, by device name, which axles are
 * driven and adds what's missing in a part of our own: a shaft from the
 * gearbox to one driven axle, or a centre differential splitting torque
 * front and rear (and between tandem axles). Axles left undriven lose their
 * powertrain rows, so their wheels roll freely.
 */

export const DRIVE_LAYOUTS = [
  { value: 'auto', label: 'As the axles were (auto)' },
  { value: 'rwd', label: 'Rear-wheel drive' },
  { value: 'fwd', label: 'Front-wheel drive' },
  { value: 'awd', label: 'All-wheel drive' },
] as const;
export type DriveLayout = (typeof DRIVE_LAYOUTS)[number]['value'];

export const CENTRE_DIFFS = [
  { value: 'viscous', label: 'Viscous (road AWD)' },
  { value: 'lsd', label: 'Limited slip' },
  { value: 'open', label: 'Open' },
  { value: 'locked', label: 'Locked (4x4)' },
] as const;
export type CentreDiff = (typeof CENTRE_DIFFS)[number]['value'];

export interface DrivetrainSettings {
  layout: DriveLayout;
  /** Share of torque to the front axles with all-wheel drive (0–1). */
  frontShare: number;
  centre: CentreDiff;
}

export const DEFAULT_DRIVETRAIN: DrivetrainSettings = { layout: 'auto', frontShare: 0.4, centre: 'viscous' };

export interface PtRow {
  part: string;
  type: string;
  name: string;
  input: string;
  index: number;
}

/** Every powertrain row of a set of parts. */
export function powertrainRows(parts: Readonly<Record<string, JbeamObject>>): PtRow[] {
  const out: PtRow[] = [];
  for (const [part, body] of Object.entries(parts)) {
    const table = body.powertrain;
    if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
    const header = table[0].map(String);
    const col = (n: string) => header.indexOf(n);
    const [t, n, i, x] = [col('type'), col('name'), col('inputName'), col('inputIndex')];
    if (t < 0 || n < 0 || i < 0) continue;
    for (const row of table.slice(1)) {
      if (!Array.isArray(row)) continue;
      const [type, name, input] = [row[t], row[n], row[i]];
      if (typeof type !== 'string' || typeof name !== 'string' || typeof input !== 'string') continue;
      const index = x >= 0 && typeof row[x] === 'number' ? row[x] : 1;
      out.push({ part, type, name, input, index });
    }
  }
  return out;
}

export interface DriveAxle {
  /** Position in the project's axle list. */
  index: number;
  name: string;
  /** Along the car (BeamNG Y: − front). */
  y: number;
  parts: Readonly<Record<string, JbeamObject>>;
}

export interface AxlePlan {
  index: number;
  name: string;
  front: boolean;
  /** It has a differential (it was driven in its own car). */
  driveable: boolean;
  driven: boolean;
  /** Its first devices and what feeds them now. */
  entries: { device: string; input: string; index: number }[];
  /** How it's fed after the plan, for display. */
  via: string;
}

export interface DrivetrainPlan {
  /** The gearbox's output device, or null without a gearbox. */
  source: string | null;
  axles: AxlePlan[];
  /** Rows of the part we add (header first), or null when nothing is needed. */
  rows: JbeamValue[][] | null;
  /** Axle index → device name → new input (name, index). */
  rewire: Map<number, Map<string, [string, number]>>;
  /** Axles whose powertrain rows are dropped (not driven). */
  drop: Set<number>;
  /** Devices of the gearbox set that go: its own car's driveline past what our axles take power from. */
  boxDrop: Set<string>;
  /** Differentials of the gearbox set left with one output in use: locked, so the power goes there. */
  boxLock: Set<string>;
  problems: string[];
}

/** The gearbox's end device: the one nothing else in the gearbox set takes power from. */
function gearboxOutput(rows: readonly PtRow[]): string | null {
  const inputs = new Set(rows.map((r) => r.input));
  const ends = rows.filter((r) => !inputs.has(r.name));
  const box = ends.find((r) => /gearbox/i.test(r.type)) ?? ends.find((r) => /gearbox/i.test(r.name)) ?? ends[ends.length - 1];
  return box?.name ?? null;
}

function diffOptions(type: CentreDiff, split: number): JbeamObject {
  const o: JbeamObject = { diffType: type, diffTorqueSplit: Math.round(split * 1000) / 1000, gearRatio: 1, friction: 1 };
  if (type === 'viscous') Object.assign(o, { viscousCoef: 25, viscousTorque: 1500 });
  if (type === 'lsd') Object.assign(o, { lsdPreload: 100, lsdLockCoef: 0.2, lsdRevLockCoef: 0.1 });
  return o;
}

/** Work out how the gearbox reaches each axle. */
export function planDrivetrain(input: { engine: Readonly<Record<string, JbeamObject>> | null; gearbox: Readonly<Record<string, JbeamObject>> | null; axles: readonly DriveAxle[] }, settings: DrivetrainSettings = DEFAULT_DRIVETRAIN): DrivetrainPlan {
  const problems: string[] = [];
  const engineRows = input.engine ? powertrainRows(input.engine) : [];
  const axleRows = input.axles.map((a) => powertrainRows(a.parts));
  // A gearbox set comes with its own car's driveline (transfer case, driveshaft, differential,
  // half-shafts). Where an axle has a device of the same name, the axle's is the one on the wheels.
  const allBoxRows = input.gearbox ? powertrainRows(input.gearbox) : [];
  const axleNames = new Set(axleRows.flat().map((r) => r.name));
  let boxRows = allBoxRows.filter((r) => !axleNames.has(r.name));
  const known = new Set([...engineRows, ...boxRows, ...axleRows.flat()].map((r) => r.name));
  const ys = input.axles.map((a) => a.y);
  const mid = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;

  const axles: AxlePlan[] = input.axles.map((a, i) => {
    const rows = axleRows[i]!;
    const own = new Set(rows.map((r) => r.name));
    const seen = new Set<string>();
    const entries = rows.filter((r) => !own.has(r.input) && !seen.has(r.name) && seen.add(r.name)).map((r) => ({ device: r.name, input: r.input, index: r.index }));
    const front = input.axles.length === 1 ? true : a.y <= mid;
    // Only an axle with its own differential can be driven: a suspension whose wheel shafts hang on a differential that
    // stayed behind (an empty slot, e.g. the ETK 800's front on a rear-drive car) just rolls.
    const driveable = entries.length > 0 && rows.some((r) => r.type === 'differential');
    return { index: a.index, name: a.name, front, driveable, driven: false, entries, via: '' };
  });

  // The same suspension on two axles: their devices share names, and the game would join them wrongly.
  const owner = new Map<string, number>();
  input.axles.forEach((a, i) => {
    for (const name of new Set(axleRows[i]!.map((r) => r.name))) {
      const other = owner.get(name);
      if (other !== undefined) problems.push(`${input.axles[other]!.name} and ${a.name} both have a device named ${name}: fit a different suspension on one of them.`);
      else owner.set(name, i);
    }
  });
  const driveable = axles.filter((a) => a.driveable);
  const want = (a: AxlePlan) => {
    if (!a.driveable) return false;
    if (settings.layout === 'rwd') return !a.front || input.axles.length === 1;
    if (settings.layout === 'fwd') return a.front;
    return true;
  };
  for (const a of axles) a.driven = want(a);
  const driven = axles.filter((a) => a.driven);
  if (settings.layout !== 'auto' && driveable.length && !driven.length) problems.push(settings.layout === 'fwd' ? 'The front axle has no differential: it can’t drive.' : settings.layout === 'rwd' ? 'The rear axle has no differential: it can’t drive.' : 'No axle can drive.');
  if (!driveable.length && input.axles.length) problems.push('None of the fitted suspensions has a differential, so no wheel is driven. Fit a suspension from a driven axle.');

  const rewire = new Map<number, Map<string, [string, number]>>();
  // Rows of an axle that isn't driven go; so do rows still pointing at a device nothing brought (the game would complain).
  const drop = new Set(axles.filter((a) => (a.driveable && !a.driven) || (!a.driveable && a.entries.some((e) => !known.has(e.input)))).map((a) => a.index));
  // The gearbox set keeps what leads to a device our axles take power from; the rest of its own
  // car's driveline feeds nothing here (a centre differential turning a shaft to nowhere lets all
  // the power out that way). When the axles take nothing from it, it ends at the gearbox itself.
  const kept = (rows: readonly PtRow[]) => {
    const taken = new Set(axleRows.flatMap((r, i) => (drop.has(input.axles[i]!.index) ? [] : r.map((x) => x.input))));
    let ends = rows.filter((r) => taken.has(r.name));
    if (!ends.length) ends = rows.filter((r) => /gearbox/i.test(r.type));
    if (!ends.length) return [...rows];
    const keep = new Set<string>();
    for (const todo = ends.map((r) => r.name); todo.length; ) {
      const name = todo.pop()!;
      if (keep.has(name)) continue;
      keep.add(name);
      for (const r of rows) if (r.name === name) todo.push(r.input);
    }
    return rows.filter((r) => keep.has(r.name));
  };
  boxRows = kept(boxRows);
  const boxDrop = new Set(allBoxRows.filter((r) => !boxRows.includes(r)).map((r) => r.name));
  const source = boxRows.length ? gearboxOutput(boxRows) : null;
  const out: JbeamValue[][] = [];
  const add = (row: JbeamValue[]) => out.push(row);
  /** The gearbox set's differentials with fewer than two outputs in use once the plan is made. */
  const boxLock = () => {
    const uses = new Map<string, Set<number>>();
    const use = (name: string, index: number) => uses.set(name, (uses.get(name) ?? new Set()).add(index));
    for (const r of boxRows) use(r.input, r.index);
    for (const row of out) if (typeof row[2] === 'string' && typeof row[3] === 'number') use(row[2], row[3]);
    axleRows.forEach((rows, i) => {
      const a = input.axles[i]!;
      if (drop.has(a.index)) return;
      for (const r of rows) {
        const to = rewire.get(a.index)?.get(r.name);
        use(to ? to[0] : r.input, to ? to[1] : r.index);
      }
    });
    return new Set(boxRows.filter((r) => r.type === 'differential' && (uses.get(r.name)?.size ?? 0) < 2).map((r) => r.name));
  };
  const resolved =(a: AxlePlan) => a.entries.every((e) => known.has(e.input) && !axleRows.some((rows, i) => input.axles[i]!.index !== a.index && rows.some((r) => r.name === e.input)));

  if (!source) {
    if (driven.length) problems.push('Fit a gearbox so the engine can reach the wheels.');
    for (const a of driven) a.via = a.entries.map((e) => e.input).join(', ');
    return { source, axles, rows: null, rewire, drop, boxDrop, boxLock: new Set(), problems };
  }

  const feed = (a: AxlePlan, from: string, index: number) => {
    const shaft = `jbf_driveshaft_${a.index + 1}`;
    add(['shaft', shaft, from, index]);
    const m = new Map<string, [string, number]>();
    for (const e of a.entries) m.set(e.device, [shaft, 1]);
    rewire.set(a.index, m);
    a.via = from === source ? 'a drive shaft from the gearbox' : `a drive shaft from ${from}`;
  };
  // Split one output between groups of axles with differentials, as a binary tree.
  let n = 0;
  const split = (groups: AxlePlan[][], from: string, index: number, share: number, type: CentreDiff) => {
    const flat = groups.flat();
    if (flat.length === 1) return feed(flat[0]!, from, index);
    const [first, second] = groups.length > 1 ? [groups[0]!, groups.slice(1).flat()] : [flat.slice(0, 1), flat.slice(1)];
    const name = n++ ? `jbf_centre_diff_${n}` : 'jbf_centre_diff';
    add(['differential', name, from, index, diffOptions(type, groups.length > 1 ? share : 0.5)]);
    split([first], name, 1, 0.5, 'locked');
    split([second], name, 2, 0.5, 'locked');
  };

  if (driven.length === 1 || driven.every(resolved)) {
    // One axle (or it's all connected already): leave what's connected, add a shaft where the input is missing.
    for (const a of driven) {
      if (resolved(a)) {
        a.via = a.entries.map((e) => e.input).join(', ');
        continue;
      }
      feed(a, source, 1);
    }
  } else {
    const fronts = driven.filter((a) => a.front);
    const rears = driven.filter((a) => !a.front);
    const groups = [fronts, rears].filter((g) => g.length);
    split(groups, source, 1, settings.frontShare, settings.centre);
    for (const a of driven) a.via = `the centre differential (${Math.round(settings.frontShare * 100)}% front)`;
    if (groups.some((g) => g.length > 1)) problems.push('Tandem axles share their end’s torque through a locked differential: check it in game.');
  }
  for (const a of axles) if (!a.driven) a.via = a.driveable ? 'not driven (rolls freely)' : 'no differential';
  return { source, axles, rows: out.length ? [['type', 'name', 'inputName', 'inputIndex'], ...out] : null, rewire, drop, boxDrop, boxLock: boxLock(), problems };
}

/** Apply the plan to the gearbox's (transplanted) parts: its dropped devices' rows go, its one-output differentials lock. */
export function applyDrivetrainToGearbox(parts: Record<string, JbeamObject>, plan: DrivetrainPlan): string[] {
  const changed: string[] = [];
  if (!plan.boxDrop.size && !plan.boxLock.size) return changed;
  for (const [part, body] of Object.entries(parts)) {
    const table = body.powertrain;
    if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
    const n = table[0].map(String).indexOf('name');
    if (n < 0) continue;
    let touched = false;
    const rows: JbeamValue[] = [table[0]];
    for (const row of table.slice(1)) {
      const name = Array.isArray(row) ? row[n] : undefined;
      if (!Array.isArray(row) || typeof name !== 'string') {
        rows.push(row);
      } else if (plan.boxDrop.has(name)) {
        touched = true;
      } else if (plan.boxLock.has(name)) {
        const last = row[row.length - 1];
        const options = last !== undefined && !Array.isArray(last) && typeof last === 'object' && last !== null ? last : null;
        rows.push(options ? [...row.slice(0, -1), { ...options, diffType: 'locked' }] : [...row, { diffType: 'locked' }]);
        touched = true;
      } else rows.push(row);
    }
    if (!touched) continue;
    if (rows.some((r) => Array.isArray(r) && typeof r[n] === 'string' && r !== table[0])) body.powertrain = rows;
    else delete body.powertrain;
    changed.push(part);
  }
  return changed;
}

/** Apply the plan to one axle's (transplanted) parts: rewire its entry devices, or drop its rows when it isn't driven. */
export function applyDrivetrainToAxle(parts: Record<string, JbeamObject>, plan: DrivetrainPlan, axleIndex: number): string[] {
  const changed: string[] = [];
  const dropAll = plan.drop.has(axleIndex);
  const wires = plan.rewire.get(axleIndex);
  if (!dropAll && !wires) return changed;
  for (const [part, body] of Object.entries(parts)) {
    const table = body.powertrain;
    if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
    const header = table[0].map(String);
    const [n, i, x] = [header.indexOf('name'), header.indexOf('inputName'), header.indexOf('inputIndex')];
    if (n < 0 || i < 0) continue;
    let touched = false;
    const rows: JbeamValue[] = [table[0]];
    for (const row of table.slice(1)) {
      if (!Array.isArray(row) || typeof row[n] !== 'string') {
        rows.push(row);
        continue;
      }
      if (dropAll) {
        touched = true;
        continue;
      }
      const to = wires?.get(row[n]);
      if (!to) {
        rows.push(row);
        continue;
      }
      const copy = [...row];
      copy[i] = to[0];
      if (x >= 0) copy[x] = to[1];
      rows.push(copy);
      touched = true;
    }
    if (touched) {
      if (dropAll) delete body.powertrain;
      else body.powertrain = rows;
      changed.push(part);
    }
  }
  return changed;
}
