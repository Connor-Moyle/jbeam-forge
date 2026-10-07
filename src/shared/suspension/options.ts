import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';
import { slotTypesOf } from '../jbeam/slots';

/**
 * The game's alternative parts for a fitted set (suspension, engine or
 * gearbox): for each slot its parts declare (brakes, steering rack,
 * subframe, hubs, turbo, ECU, exhaust…), the other parts of the game that
 * fit it. The user picks which one is fitted by default and which others
 * ship as choices in the game's parts menu.
 */

export interface SlotAlternative {
  part: string;
  title: string;
}

export interface SlotOption {
  slotType: string;
  /** The slot's description in the game ("Front Brakes"). */
  title: string;
  /** The part the game fits by default ("" = empty). */
  default: string;
  alternatives: SlotAlternative[];
}

export interface SetOptions {
  slots: SlotOption[];
  /** The alternatives' jbeam, and the defaults of their own slots. */
  parts: Record<string, JbeamObject>;
  /** Body nodes the alternatives attach to (original positions). */
  anchors: Record<string, [number, number, number]>;
}

/** Per slot type: the default part, and the parts offered in game (the default always is). */
export type SetChoices = Record<string, { default: string; offer: string[] }>;

interface SlotRow {
  /** Slot types it accepts. */
  types: string[];
  /** The slot's own key (slots: its type; slots2: its name). */
  key: string;
  def: string;
  description: string;
  table: 'slots' | 'slots2';
  row: number;
  col: number;
}

/** A part's slot rows, both table formats. */
export function slotRows(body: JbeamObject): SlotRow[] {
  const out: SlotRow[] = [];
  for (const table of ['slots', 'slots2'] as const) {
    const t = body[table];
    if (!Array.isArray(t) || !Array.isArray(t[0])) continue;
    const h = (t[0]).map(String);
    const col = h.indexOf('default');
    const desc = h.indexOf('description');
    t.slice(1).forEach((row, i) => {
      if (!Array.isArray(row)) return;
      const k = row[h.indexOf(table === 'slots' ? 'type' : 'name')];
      const key = typeof k === 'string' ? k : '';
      const allow = table === 'slots2' ? row[h.indexOf('allowTypes')] : null;
      const types = Array.isArray(allow) ? allow.filter((x): x is string => typeof x === 'string') : [key];
      if (!key) return;
      out.push({ types, key, def: col >= 0 && typeof row[col] === 'string' ? row[col] : '', description: desc >= 0 && typeof row[desc] === 'string' ? row[desc] : key, table, row: i + 1, col });
    });
  }
  return out;
}


export function partTitleOf(body: JbeamObject, name: string): string {
  const info = isJbeamObject(body.information) ? body.information : null;
  return typeof info?.name === 'string' && info.name.trim() ? info.name.trim() : name;
}

/** A part and the defaults of its slots, all the way down. */
function closureOf(start: string, find: (name: string) => JbeamObject | undefined, max: number): string[] {
  const seen: string[] = [];
  const queue = [start];
  while (queue.length && seen.length < max) {
    const name = queue.shift()!;
    if (seen.includes(name)) continue;
    const body = find(name);
    if (!body) continue;
    seen.push(name);
    for (const r of slotRows(body)) if (r.def) queue.push(r.def);
  }
  return seen;
}

/**
 * The alternatives for every slot the set's parts declare. `pool` is every
 * part the game has for the car (its own first, then common ones); at most
 * `maxPerSlot` per slot, the car's own parts first.
 */
export function findOptions(set: readonly string[], find: (name: string) => JbeamObject | undefined, pool: Iterable<[string, JbeamObject]>, maxPerSlot = 16): Omit<SetOptions, 'anchors'> {
  const bySlot = new Map<string, string[]>();
  for (const [name, body] of pool) for (const st of slotTypesOf(body)) bySlot.set(st, [...(bySlot.get(st) ?? []), name]);
  const slots: SlotOption[] = [];
  const parts: Record<string, JbeamObject> = {};
  const inSet = new Set(set);
  const seenSlots = new Set<string>();
  for (const name of set) {
    const body = find(name);
    if (!body) continue;
    for (const r of slotRows(body)) {
      if (seenSlots.has(r.key)) continue;
      seenSlots.add(r.key);
      const alts = [...new Set(r.types.flatMap((t) => bySlot.get(t) ?? []))].filter((p) => p !== r.def).slice(0, maxPerSlot);
      if (!alts.length) continue;
      slots.push({ slotType: r.key, title: r.description, default: r.def, alternatives: alts.map((p) => ({ part: p, title: partTitleOf(find(p)!, p) })) });
      for (const a of alts) for (const p of closureOf(a, find, 12)) if (!inSet.has(p) && !parts[p]) parts[p] = find(p)!;
    }
  }
  return { slots, parts };
}

/**
 * The set as the user chose: the offered alternatives (and what their slots
 * hold) added, and each slot's default switched. Unchanged when there are
 * no choices.
 */
export function applyChoices<T extends { parts: Record<string, JbeamObject>; anchors: Record<string, [number, number, number]> }>(data: T, options: SetOptions | undefined, choices: SetChoices | undefined): T {
  if (!options || !choices || !Object.keys(choices).length) return data;
  const all = (n: string) => data.parts[n] ?? options.parts[n];
  const parts: Record<string, JbeamObject> = { ...data.parts };
  for (const [slot, c] of Object.entries(choices)) {
    const known = options.slots.find((s) => s.slotType === slot);
    if (!known) continue;
    for (const p of [c.default, ...c.offer]) if (p) for (const q of closureOf(p, all, 12)) parts[q] ??= structuredClone(options.parts[q] ?? data.parts[q]!);
    // Switch the default wherever the slot is declared.
    for (const [name, body] of Object.entries(parts)) {
      const rows = slotRows(body).filter((r) => r.key === slot && r.col >= 0 && r.def !== c.default);
      if (!rows.length) continue;
      const copy = structuredClone(body);
      for (const r of rows) ((copy[r.table] as JbeamValue[][])[r.row] as JbeamValue[])[r.col] = c.default;
      parts[name] = copy;
    }
  }
  return { ...data, parts, anchors: { ...options.anchors, ...data.anchors } };
}
