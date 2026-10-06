import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';
import type { PowertrainEdits } from '../project/schema';
import { fieldKey } from './edits';

/**
 * The driveline builder: a fitted suspension's differentials (and the
 * game's other driveline devices it declares), with their type, final drive
 * and locking settings. A differential's settings live either in the options
 * object at the end of its `powertrain` row or in a section named after the
 * device; both are read and edited in place. Keys for row options use the
 * section "powertrain:<device>".
 */

export const DIFF_TYPES = [
  { value: 'open', label: 'Open' },
  { value: 'lsd', label: 'Limited slip (LSD)' },
  { value: 'viscous', label: 'Viscous' },
  { value: 'locked', label: 'Locked (spool)' },
] as const;

/** Settings shown per differential, in order, with labels and ranges. */
export const DIFF_SETTINGS: { name: string; label: string; unit?: string; hint?: string; min: number; max: number; step: number; types?: string[] }[] = [
  { name: 'gearRatio', label: 'Final drive', unit: ':1', hint: 'Higher: quicker acceleration, lower top speed', min: 1.5, max: 8, step: 0.01 },
  { name: 'friction', label: 'Friction', unit: 'Nm', min: 0, max: 30, step: 0.1 },
  { name: 'lsdPreload', label: 'Preload', unit: 'Nm', hint: 'Locking before any torque goes through', min: 0, max: 1000, step: 5, types: ['lsd'] },
  { name: 'lsdLockCoef', label: 'Lock under power', hint: '0 open – 1 fully locked when accelerating', min: 0, max: 1, step: 0.01, types: ['lsd'] },
  { name: 'lsdRevLockCoef', label: 'Lock off power', hint: 'Locking on the overrun (coast)', min: 0, max: 1, step: 0.01, types: ['lsd'] },
  { name: 'viscousCoef', label: 'Viscous coupling', unit: 'Nm/(rad/s)', min: 0, max: 2000, step: 5, types: ['viscous'] },
  { name: 'viscousTorque', label: 'Viscous max torque', unit: 'Nm', min: 0, max: 5000, step: 10, types: ['viscous'] },
  { name: 'diffTorqueSplit', label: 'Torque split', hint: 'Share to the first output (0.5 = even)', min: 0, max: 1, step: 0.01 },
];

export interface DiffSetting {
  name: string;
  /** Edit key: "<part>/<section>/<name>". */
  key: string;
  /** The game's value: a number, a $variable (set on the tuning page) or absent. */
  value: number | string | null;
}

export interface Differential {
  part: string;
  /** Device name ("differential_R"). */
  device: string;
  /** Its type as the game has it ("differential", "splitShaft"…). */
  kind: string;
  diffType: { key: string; value: string | null };
  settings: DiffSetting[];
}

const DEVICE_KINDS = /^(differential|splitShaft|multiShaft|rangeBox|torsionReactor|viscousCoupling)$/;

/** Every differential-like device the set's parts declare in their powertrain tables. */
export function differentials(parts: Readonly<Record<string, JbeamObject>>): Differential[] {
  const out: Differential[] = [];
  for (const [part, body] of Object.entries(parts)) {
    const table = body.powertrain;
    if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
    const header = (table[0]).map(String);
    const typeCol = header.indexOf('type');
    const nameCol = header.indexOf('name');
    for (const row of table.slice(1)) {
      if (!Array.isArray(row)) continue;
      const kind = row[typeCol];
      const device = row[nameCol];
      if (typeof kind !== 'string' || typeof device !== 'string' || !DEVICE_KINDS.test(kind) || kind === 'rangeBox' || kind === 'torsionReactor') continue;
      const opts = row.find((c): c is JbeamObject => isJbeamObject(c));
      const sec = isJbeamObject(body[device]) ? body[device] : null;
      // A section named after the device wins over the row's options (the game merges them that way).
      const where = (name: string): { key: string; value: JbeamValue | undefined } => {
        if (sec && sec[name] !== undefined) return { key: fieldKey(part, device, name), value: sec[name] };
        if (opts && opts[name] !== undefined) return { key: fieldKey(part, `powertrain:${device}`, name), value: opts[name] };
        return { key: sec ? fieldKey(part, device, name) : fieldKey(part, `powertrain:${device}`, name), value: undefined };
      };
      const dt = where('diffType');
      const settings = DIFF_SETTINGS.map((s) => {
        const w = where(s.name);
        return { name: s.name, key: w.key, value: typeof w.value === 'number' || typeof w.value === 'string' ? w.value : null };
      });
      out.push({ part, device, kind, diffType: { key: dt.key, value: typeof dt.value === 'string' ? dt.value : null }, settings });
    }
  }
  return out;
}

/** The value a differential setting will have: the edit, else the game's number (null for a $variable or absent). */
export function settingValue(s: DiffSetting, edits: PowertrainEdits | undefined): number | null {
  const e = edits?.fields[s.key];
  if (typeof e === 'number') return e;
  return typeof s.value === 'number' ? s.value : null;
}

/** Wheel and brake settings a suspension's wheel rows carry (pressureWheels options), in order. */
export const WHEEL_SETTINGS: { name: string; label: string; unit?: string; hint?: string; min: number; max: number; step: number }[] = [
  { name: 'brakeTorque', label: 'Brake torque', unit: 'Nm', hint: 'How hard this axle brakes', min: 0, max: 20000, step: 50 },
  { name: 'parkingTorque', label: 'Handbrake torque', unit: 'Nm', min: 0, max: 10000, step: 50 },
  { name: 'brakeSpring', label: 'Brake response', hint: 'How quickly the brakes bite', min: 0, max: 100, step: 1 },
  { name: 'brakeVentingCoef', label: 'Brake venting', hint: 'Cooling of the discs', min: 0, max: 5, step: 0.05 },
  { name: 'pressurePSI', label: 'Tyre pressure', unit: 'psi', min: 5, max: 80, step: 0.5 },
  { name: 'enableABS', label: 'ABS (1 on, 0 off)', min: 0, max: 1, step: 1 },
];

/** A wheel/brake setting of the set: the value its wheel rows give it (the first found), and its edit key. */
export function wheelSettings(parts: Readonly<Record<string, JbeamObject>>): { part: string; name: string; key: string; value: number }[] {
  const out: { part: string; name: string; key: string; value: number }[] = [];
  for (const [part, body] of Object.entries(parts)) {
    const table = body.pressureWheels;
    if (!Array.isArray(table)) continue;
    const seen = new Set<string>();
    for (const row of table) {
      const objs = isJbeamObject(row) ? [row] : Array.isArray(row) ? row.filter((c): c is JbeamObject => isJbeamObject(c)) : [];
      for (const o of objs)
        for (const s of WHEEL_SETTINGS) {
          const v = o[s.name];
          if (typeof v === 'number' && !seen.has(s.name)) {
            seen.add(s.name);
            out.push({ part, name: s.name, key: fieldKey(part, 'pressureWheels', s.name), value: v });
          }
        }
    }
  }
  return out;
}

/**
 * The driveline edits applied: numbers and words at their keys, in the
 * device's section or its powertrain row options (added when the game left
 * them to its defaults, so switching an open diff to an LSD can set its
 * locking). Parts not touched are shared.
 */
export function applyDrivelineEdits(parts: Readonly<Record<string, JbeamObject>>, edits: PowertrainEdits | undefined): Record<string, JbeamObject> {
  const out: Record<string, JbeamObject> = { ...parts };
  if (!edits) return out;
  const entries: [string, number | string][] = [...Object.entries(edits.fields), ...Object.entries(edits.texts ?? {})];
  for (const [key, value] of entries) {
    const [part, section, name] = key.split('/');
    if (!part || !section || !name || !out[part]) continue;
    if (section === 'pressureWheels') {
      // Every wheel row's options that set it (rows take the last options object, so all of them).
      const table = out[part].pressureWheels;
      if (!Array.isArray(table)) continue;
      const set = (o: JbeamObject): JbeamObject => (name in o ? { ...o, [name]: value } : o);
      out[part] = { ...out[part], pressureWheels: table.map((row) => (isJbeamObject(row) ? set(row) : Array.isArray(row) ? row.map((c) => (isJbeamObject(c) ? set(c) : c)) : row)) };
      continue;
    }
    if (section.startsWith('powertrain:')) {
      const device = section.slice('powertrain:'.length);
      const table = out[part].powertrain;
      if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
      const nameCol = (table[0]).map(String).indexOf('name');
      const at = table.findIndex((r, i) => i > 0 && Array.isArray(r) && r[nameCol] === device);
      if (at < 0) continue;
      const row = [...(table[at] as JbeamValue[])];
      const oi = row.findIndex((c) => isJbeamObject(c));
      if (oi >= 0) row[oi] = { ...(row[oi] as JbeamObject), [name]: value };
      else row.push({ [name]: value });
      const t = [...table];
      t[at] = row;
      out[part] = { ...out[part], powertrain: t };
    } else {
      const sec = out[part][section];
      if (!isJbeamObject(sec)) continue;
      out[part] = { ...out[part], [section]: { ...sec, [name]: value } };
    }
  }
  return out;
}
