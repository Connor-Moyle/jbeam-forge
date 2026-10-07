import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';
import { wheelNames } from '../suspension/wheels';

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
 *
 * An axle that has to drive but has no differential (the rear suspension of a
 * front-drive car behind a rear-drive gearbox) is given one, with a half-shaft
 * to each of its wheels: the car drives, in place of an export stopped for a
 * part the suspension never had.
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
  /** For a differential added to an axle that had none: its final drive (absent: the gearbox's own car's, or DEFAULT_FINAL_DRIVE). */
  finalDrive?: number;
  /** And its kind (absent: open). */
  axleDiff?: CentreDiff;
}

export const DEFAULT_DRIVETRAIN: DrivetrainSettings = { layout: 'auto', frontShare: 0.4, centre: 'viscous' };

export interface PtRow {
  part: string;
  type: string;
  name: string;
  input: string;
  index: number;
  /** The row's own settings, when it has any. */
  options?: JbeamObject;
}

/** The final drive a differential we add gets when the gearbox brought none to copy. */
export const DEFAULT_FINAL_DRIVE = 3.7;

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
      const last = row[row.length - 1];
      out.push({ part, type, name, input, index, ...(isJbeamObject(last) ? { options: last } : {}) });
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
  /** It had no differential and is driven by one added for it. */
  given?: boolean;
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
  /** The way the power goes, device by device from the engine to the wheels, for showing. */
  path: PathStep[];
  /** The final drive of a differential added to an axle (null when none was added). */
  givenFinalDrive: number | null;
  problems: string[];
}

export interface PathStep {
  /** How far down the line it is (the engine is 0; both outputs of a differential are one deeper). */
  depth: number;
  label: string;
  /** Added by JBeam Forge to join the parts up (not one of the game's). */
  added: boolean;
}

const DEVICE_LABELS: Record<string, string> = {
  combustionEngine: 'Engine',
  electricMotor: 'Electric motor',
  frictionClutch: 'Clutch',
  torqueConverter: 'Torque converter',
  centrifugalClutch: 'Centrifugal clutch',
  viscousClutch: 'Viscous coupling',
  manualGearbox: 'Manual gearbox',
  sequentialGearbox: 'Sequential gearbox',
  automaticGearbox: 'Automatic gearbox',
  dctGearbox: 'Dual-clutch gearbox',
  cvtGearbox: 'CVT gearbox',
  electricMotorGearbox: 'Reduction gear',
  rangeBox: 'Range box',
  splitShaft: 'Split shaft',
  differential: 'Differential',
  shaft: 'Shaft',
};

/** The devices from the engine down, in the order the power reaches them. */
function powerPath(rows: readonly (PtRow & { added?: boolean })[]): PathStep[] {
  const out: PathStep[] = [];
  const seen = new Set<string>();
  const walk = (name: string, depth: number) => {
    for (const r of rows.filter((x) => x.input === name).sort((a, b) => a.index - b.index)) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      // A torsion reactor only passes the twist on to the mounts: not a step of its own.
      if (r.type === 'torsionReactor') {
        walk(r.name, depth);
        continue;
      }
      const wheel = typeof r.options?.connectedWheel === 'string' ? r.options.connectedWheel : null;
      const ratio = typeof r.options?.gearRatio === 'number' && r.type === 'differential' && r.options.gearRatio !== 1 ? `, ${r.options.gearRatio}:1` : '';
      const kind = r.type === 'differential' ? ` (${Array.isArray(r.options?.diffType) ? r.options.diffType.filter((x): x is string => typeof x === 'string').join(' or ') : typeof r.options?.diffType === 'string' ? r.options.diffType : 'open'}${ratio})` : '';
      out.push({ depth, label: wheel ? `Half-shaft to wheel ${wheel}` : `${DEVICE_LABELS[r.type] ?? r.type}${kind}`, added: !!r.added });
      walk(r.name, depth + 1);
    }
  };
  for (const r of rows.filter((x) => x.type === 'combustionEngine' || x.type === 'electricMotor')) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push({ depth: 0, label: DEVICE_LABELS[r.type]!, added: false });
    walk(r.name, 1);
  }
  return out;
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
  // An axle with no differential of its own that the gearbox set's differential already turns (a
  // front-drive car's front suspension on its own transaxle) is driven as it is.
  const boxNames = new Set(boxRows.map((r) => r.name));
  const boxFed = (a: AxlePlan) => !a.driveable && a.entries.length > 0 && a.entries.every((e) => boxNames.has(e.input));
  // The wheels each axle makes, by side: an axle with one each side can be given a differential.
  const pairs = input.axles.map((a) => {
    const names = wheelNames(a.parts);
    const left = names.filter((w) => /L\d*$/i.test(w));
    const right = names.filter((w) => /R\d*$/i.test(w));
    return left.length === 1 && right.length === 1 ? { L: left[0]!, R: right[0]! } : null;
  });
  const giveable = (a: AxlePlan, i: number) => !a.driveable && !boxFed(a) && pairs[i] !== null;
  const given = new Set<number>();
  if (input.gearbox && boxRows.length) {
    if (settings.layout === 'auto') {
      // Nothing drives: the rearmost axle that can take a differential gets one (rear-wheel drive, the usual case).
      if (!axles.some((a) => a.driveable || boxFed(a))) {
        const order = axles.map((a, i) => ({ a, i })).filter(({ a, i }) => giveable(a, i)).sort((x, y) => input.axles[y.i]!.y - input.axles[x.i]!.y);
        if (order[0]) given.add(order[0].a.index);
      }
    } else {
      axles.forEach((a, i) => {
        const wanted = settings.layout === 'awd' || (settings.layout === 'fwd' ? a.front : !a.front || input.axles.length === 1);
        if (wanted && giveable(a, i)) given.add(a.index);
      });
    }
  }
  for (const a of axles)
    if (given.has(a.index)) {
      a.driven = true;
      a.given = true;
    }
  const driven = axles.filter((a) => a.driven);
  if (settings.layout !== 'auto' && driveable.length && !driven.length) problems.push(settings.layout === 'fwd' ? 'The front axle has no differential: it can’t drive.' : settings.layout === 'rwd' ? 'The rear axle has no differential: it can’t drive.' : 'No axle can drive.');
  if (!driveable.length && !given.size && !axles.some(boxFed) && input.axles.length) problems.push('None of the fitted suspensions has a differential, so no wheel is driven. Fit a suspension from a driven axle.');

  const rewire = new Map<number, Map<string, [string, number]>>();
  // The differential a given axle's own wheel shafts were waiting for (when they all name one), or null.
  const awaited = (a: AxlePlan) => {
    const names = [...new Set(a.entries.filter((e) => !known.has(e.input)).map((e) => e.input))];
    return names.length === 1 && a.entries.every((e) => !known.has(e.input)) ? names[0]! : null;
  };
  // Rows of an axle that isn't driven go; so do rows still pointing at a device nothing brought (the game would complain).
  // A given axle keeps its wheel shafts when the differential added for it is the one they name.
  const drop = new Set(
    axles
      .filter((a) => (given.has(a.index) ? a.entries.length > 0 && awaited(a) === null : (a.driveable && !a.driven) || (!a.driveable && a.entries.some((e) => !known.has(e.input)))))
      .map((a) => a.index),
  );
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
    return { source, axles, rows: null, rewire, drop, boxDrop, boxLock: new Set(), path: powerPath([...engineRows, ...axleRows.flatMap((rows, i) => (drop.has(input.axles[i]!.index) ? [] : rows))]), givenFinalDrive: null, problems };
  }

  const feed = (a: AxlePlan, from: string, index: number) => {
    const shaft = `jbf_driveshaft_${a.index + 1}`;
    add(['shaft', shaft, from, index]);
    const m = new Map<string, [string, number]>();
    for (const e of a.entries) m.set(e.device, [shaft, 1]);
    rewire.set(a.index, m);
    a.via = from === source ? 'a drive shaft from the gearbox' : `a drive shaft from ${from}`;
  };
  // The final drive of the differential the gearbox's own car had, for the one we add (a gearbox
  // with none in it expects the axle to gear it down).
  const boxFinal = allBoxRows.map((r) => (r.type === 'differential' && boxDrop.has(r.name) ? r.options?.gearRatio : undefined)).find((v): v is number => typeof v === 'number' && v > 1.5);
  const givenRatio = Math.round((settings.finalDrive ?? boxFinal ?? DEFAULT_FINAL_DRIVE) * 100) / 100;
  const give = (a: AxlePlan, from: string, index: number) => {
    const i = axles.indexOf(a);
    const pair = pairs[i]!;
    const shaft = `jbf_driveshaft_${a.index + 1}`;
    add(['shaft', shaft, from, index]);
    const waiting = a.entries.length ? awaited(a) : null;
    const diff = waiting ?? `jbf_differential_${a.index + 1}`;
    add(['differential', diff, shaft, 1, { ...diffOptions(settings.axleDiff ?? 'open', 0.5), gearRatio: givenRatio, friction: 2, uiName: `${a.name} differential`, defaultVirtualInertia: 0.25 }]);
    if (!waiting) {
      add(['shaft', `jbf_halfshaft_${pair.L}`, diff, 1, { connectedWheel: pair.L, friction: 1.5, uiName: `${a.name} left half-shaft` }]);
      add(['shaft', `jbf_halfshaft_${pair.R}`, diff, 2, { connectedWheel: pair.R, friction: 1.5, uiName: `${a.name} right half-shaft` }]);
    }
    a.via = 'a differential and half-shafts added for it (the suspension has none)';
  };
  const connect = (a: AxlePlan, from: string, index: number) => (given.has(a.index) ? give(a, from, index) : feed(a, from, index));
  // Split one output between groups of axles with differentials, as a binary tree.
  let n = 0;
  const split = (groups: AxlePlan[][], from: string, index: number, share: number, type: CentreDiff) => {
    const flat = groups.flat();
    if (flat.length === 1) return connect(flat[0]!, from, index);
    const [first, second] = groups.length > 1 ? [groups[0]!, groups.slice(1).flat()] : [flat.slice(0, 1), flat.slice(1)];
    const name = n++ ? `jbf_centre_diff_${n}` : 'jbf_centre_diff';
    add(['differential', name, from, index, diffOptions(type, groups.length > 1 ? share : 0.5)]);
    split([first], name, 1, 0.5, 'locked');
    split([second], name, 2, 0.5, 'locked');
  };

  if (driven.length === 1 || driven.every((a) => !given.has(a.index) && resolved(a))) {
    // One axle (or it's all connected already): leave what's connected, add a shaft where the input is missing.
    for (const a of driven) {
      if (given.has(a.index)) {
        give(a, source, 1);
        continue;
      }
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
  for (const a of axles) if (!a.driven) a.via = a.driveable ? 'not driven (rolls freely)' : boxFed(a) ? a.entries.map((e) => e.input).join(', ') : 'no differential';
  // The line as it will be in the game: the engine, what's left of the gearbox set, what we add, and the axles as rewired.
  const locked = boxLock();
  const text = (v: JbeamValue | undefined) => (typeof v === 'string' ? v : '');
  const addedRows = out.map((row) => ({ part: '', type: text(row[0]), name: text(row[1]), input: text(row[2]), index: typeof row[3] === 'number' ? row[3] : 1, ...(isJbeamObject(row[4]) ? { options: row[4] } : {}), added: true }));
  const axleLine = axleRows.flatMap((rows, i) => {
    const a = input.axles[i]!;
    if (drop.has(a.index)) return [];
    return rows.map((r) => {
      const to = rewire.get(a.index)?.get(r.name);
      return to ? { ...r, input: to[0], index: to[1] } : r;
    });
  });
  const boxLine = boxRows.map((r) => (locked.has(r.name) ? { ...r, options: { ...r.options, diffType: 'locked' } } : r));
  const path = powerPath([...engineRows, ...boxLine, ...addedRows, ...axleLine]);
  return { source, axles, rows: out.length ? [['type', 'name', 'inputName', 'inputIndex'], ...out] : null, rewire, drop, boxDrop, boxLock: locked, path, givenFinalDrive: given.size ? givenRatio : null, problems };
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
