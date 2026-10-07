import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';

/**
 * A gearbox's shifting written for another engine. The game's gearboxes carry the revs their own
 * car launches and shifts at (a race transaxle lets the clutch in from 3500 rpm and shifts up at
 * 4300); behind an engine that never gets there (a bus diesel stops at 2200) the clutch stays open
 * and the car sits still at full throttle. The launch and shift revs are brought down into the
 * fitted engine's range; a gearbox that already suits the engine is left as the game has it.
 */

export interface RevRange {
  idle: number;
  /** Where the engine stops revving: the lower of its torque curve's end and its limiter. */
  limit: number;
}

const SECTION = 'vehicleController';
/** The game's own values where a gearbox gives none (vehicleController.lua and its shift logic). */
const DEFAULTS = { clutchLaunchStartRPM: 2000, clutchLaunchTargetRPM: 3000, lowShiftDownRPM: 2000, highShiftDownRPM: 3500, lowShiftUpRPM: 2500, highShiftUpRPM: 5000 };
const SHIFT_KEYS = ['lowShiftDownRPM', 'highShiftDownRPM', 'lowShiftUpRPM', 'highShiftUpRPM'] as const;
/** The clutch is fully in by this share of the engine's revs, and the last upshift comes by this one. */
const LAUNCH_BY = 0.8;
const SHIFT_BY = 0.95;

const round50 = (rpm: number) => Math.round(rpm / 50) * 50;

/** A number, or a $variable's default from the parts' variables tables. */
function numberOf(v: JbeamValue | undefined, parts: readonly JbeamObject[]): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return null;
  for (const p of parts) {
    if (!Array.isArray(p.variables)) continue;
    for (const r of p.variables.slice(1)) if (Array.isArray(r) && r[0] === v && typeof r[4] === 'number') return r[4];
  }
  return null;
}

/** The rev range of a combustion engine among these parts (null for a motor, or no engine). */
export function engineRevRange(parts: readonly JbeamObject[]): RevRange | null {
  let range: RevRange | null = null;
  for (const p of parts) {
    const e = p.mainEngine;
    if (!isJbeamObject(e)) continue;
    const idle = numberOf(e.idleRPM, parts);
    const max = numberOf(e.maxRPM, parts);
    const limiter = numberOf(e.revLimiterRPM, parts);
    if (idle === null || (max === null && limiter === null)) continue;
    const limit = Math.min(max ?? Infinity, limiter ?? Infinity);
    // Later parts (an ECU, a long block) restate the engine's revs: the lowest limit is the safe one.
    if (limit > idle && (!range || limit < range.limit)) range = { idle, limit };
  }
  return range;
}

const numbersIn = (v: JbeamValue | undefined): number[] => (typeof v === 'number' ? [v] : Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

/**
 * The gearbox's parts with their launch and shift revs fitted to the engine (a copy; parts that
 * need nothing are shared). `keep` lists the settings the modder set by hand ("part/section/name"),
 * which stay as they are. Returns the names of the parts changed.
 */
export function fitShiftingToEngine(parts: Readonly<Record<string, JbeamObject>>, root: string, engine: RevRange, keep: ReadonlySet<string> = new Set()): { parts: Record<string, JbeamObject>; changed: string[] } {
  const out: Record<string, JbeamObject> = { ...parts };
  const withSection = Object.keys(parts).filter((name) => isJbeamObject(parts[name]![SECTION]));
  // The game merges every part's section into one: what the gearbox says as a whole.
  const merged: JbeamObject = {};
  for (const name of withSection) Object.assign(merged, parts[name]![SECTION] as JbeamObject);
  // Where a value the gearbox leaves to the game's default is written when the default doesn't fit.
  const home = withSection.includes(root) ? root : (withSection[0] ?? root);
  const changed = new Set<string>();
  const write = (part: string, key: string, value: JbeamValue) => {
    const body = out[part];
    if (keep.has(`${part}/${SECTION}/${key}`) || !body) return;
    const sec = body[SECTION];
    out[part] = { ...body, [SECTION]: { ...(isJbeamObject(sec) ? sec : {}), [key]: value } };
    changed.add(part);
  };
  /** Each part that states the key, or the home part when the game's default applies. */
  const places = (key: string) => {
    const stated = withSection.filter((name) => (parts[name]![SECTION] as JbeamObject)[key] !== undefined);
    return stated.length ? stated : [home];
  };
  const stated = (part: string, key: string): JbeamValue | undefined => {
    const sec = parts[part]?.[SECTION];
    return isJbeamObject(sec) ? sec[key] : undefined;
  };

  // Launch: the clutch starts to bite at (start − idle) rpm at full throttle and is fully in
  // (target) rpm above that once the launch has gone on a moment.
  const start = merged.clutchLaunchStartRPM ?? DEFAULTS.clutchLaunchStartRPM;
  const target = merged.clutchLaunchTargetRPM ?? DEFAULTS.clutchLaunchTargetRPM;
  if (typeof start === 'number' && typeof target === 'number') {
    const need = Math.max(0, start - engine.idle) + target;
    const room = engine.limit * LAUNCH_BY;
    if (need > room) {
      const k = room / need;
      for (const part of places('clutchLaunchStartRPM')) write(part, 'clutchLaunchStartRPM', round50(engine.idle + Math.max(0, start - engine.idle) * k));
      for (const part of places('clutchLaunchTargetRPM')) write(part, 'clutchLaunchTargetRPM', round50(target * k));
    }
  }

  // Shift points: when the highest upshift is past the engine's revs, all four tables come down together.
  // With calculateOptimalLoadShiftPoints the game works the high-load ones out from the torque curve itself.
  const computed = merged.calculateOptimalLoadShiftPoints === true;
  const used = SHIFT_KEYS.filter((key) => merged[key] !== undefined || !(computed && key.startsWith('high')));
  const ups = used.filter((key) => key.endsWith('UpRPM')).flatMap((key) => numbersIn(merged[key] ?? DEFAULTS[key]));
  const highest = Math.max(0, ...ups);
  if (highest > engine.limit * SHIFT_BY) {
    const k = (engine.limit * SHIFT_BY) / highest;
    // A gear's 0 means "never" and stays; nothing is brought down to the idle itself.
    const floor = round50(engine.idle * 1.3);
    const fit = (rpm: number) => (rpm <= 0 ? rpm : Math.max(floor, round50(rpm * k)));
    const fitValue = (v: JbeamValue): JbeamValue => (typeof v === 'number' ? fit(v) : Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? fit(x) : x)) : v);
    for (const key of used) for (const part of places(key)) write(part, key, fitValue(stated(part, key) ?? DEFAULTS[key]));
  }
  return { parts: out, changed: [...changed] };
}
