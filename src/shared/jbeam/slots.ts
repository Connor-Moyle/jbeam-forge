import type { JbeamObject, JbeamValue } from './parse';

/**
 * The slot types a part fits. Most parts name one; over a hundred of the game's name several
 * ("slotType": ["sunburst2_engine_1_6_intake", "sunburst2_engine_2_0_intake"]: one intake for
 * three engines).
 */
export function slotTypesOf(body: { slotType?: JbeamValue } | undefined): string[] {
  const v = body?.slotType;
  return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** The first slot type a part names ('' when it names none). */
export const firstSlotType = (body: { slotType?: JbeamValue } | undefined): string => slotTypesOf(body)[0] ?? '';

/** The slot types one row of a slots or slots2 table lets in: its allowTypes, or the slot's own name. */
export function rowAllows(header: readonly string[], row: readonly JbeamValue[]): string[] {
  const allow = row[header.indexOf('allowTypes')];
  if (Array.isArray(allow)) {
    const out = allow.filter((a): a is string => typeof a === 'string');
    if (out.length) return out;
  }
  const out: string[] = [];
  for (const col of ['type', 'name']) {
    const v = row[header.indexOf(col)];
    if (typeof v === 'string' && v) out.push(v);
  }
  return out;
}

/** How alike two part names are: the letters they share at the start and at the end. */
function alike(a: string, b: string): number {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return head + tail;
}

/**
 * A part with slot defaults that can be fitted. A default naming a part no file defines is left
 * empty, as the game leaves it (the Rock Bouncer's rear air bump stop). A default naming a part
 * made for another slot is swapped for the part of the right slot with the nearest name: the ETK's
 * rear differential names the front final drive (etk_finaldrive_F_323 in the slot etk_finaldrive_R),
 * which the game's own configurations paper over and a mod's default configuration can't.
 */
export function fittingDefaults(body: JbeamObject, find: (name: string) => JbeamObject | undefined, fitting: (slotType: string) => readonly string[]): JbeamObject {
  let out = body;
  for (const key of ['slots', 'slots2'] as const) {
    const table = body[key];
    if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
    const header = table[0].map(String);
    const col = header.indexOf('default');
    if (col < 0) continue;
    let changed = false;
    const rows = table.map((row, i) => {
      if (i === 0 || !Array.isArray(row)) return row;
      const named = row[col];
      if (typeof named !== 'string' || !named) return row;
      const part = find(named);
      const allows = rowAllows(header, row);
      let next = named;
      if (!part) next = '';
      else if (allows.length && !slotTypesOf(part).some((t) => allows.includes(t))) {
        const candidates = [...new Set(allows.flatMap((t) => [...fitting(t)]))].sort();
        next = candidates.reduce<{ name: string; score: number }>((best, name) => (alike(name, named) > best.score ? { name, score: alike(name, named) } : best), { name: '', score: -1 }).name;
      }
      if (next === named) return row;
      changed = true;
      const copy = [...row];
      copy[col] = next;
      return copy;
    });
    if (changed) out = { ...out, [key]: rows };
  }
  return out;
}
