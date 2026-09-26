import { isJbeamObject, type JbeamObject, type JbeamValue } from './parse';
import { JbeamComment, type WritableValue } from './serialize';

/**
 * jbeam table semantics (verified against official 0.39 content, see
 * docs/beamng-jbeam-syntax.md):
 *
 *   "nodes": [
 *     ["id", "posX", "posY", "posZ"],        ← header row (first array)
 *     {"group":"covet_hood"},                ← option row: applies to every following row
 *     {"nodeWeight":0.5},                    ←   (cumulative, until overridden)
 *     ["h1rr", -0.72, -0.80, 0.865],         ← data row, mapped by header column
 *     ["h3", 0, -1.6, 0.8, {"nodeWeight":2}],← trailing dict = options for this row only
 *     {"group":""},                          ← reset (convention: empty value)
 *   ]
 *
 * Option dicts may also precede the header; they apply from the start.
 */

export interface TableRecord {
  /** Column name → value, in header order. Missing trailing columns are absent. */
  values: Record<string, JbeamValue>;
  /** Effective options for this row: running option rows ⊕ the row's own trailing dict. */
  options: JbeamObject;
  /** Only the row's trailing dict (empty if none). */
  inlineOptions: JbeamObject;
  /** Values beyond the header's columns (rare; kept so nothing is lost). */
  extra: JbeamValue[];
}

export interface Table {
  header: string[];
  records: TableRecord[];
}

export class JbeamTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JbeamTableError';
  }
}

export function readTable(section: JbeamValue): Table {
  if (!Array.isArray(section)) throw new JbeamTableError('A table section must be an array');
  let header: string[] | null = null;
  let running: JbeamObject = {};
  const records: TableRecord[] = [];

  for (const el of section) {
    if (isJbeamObject(el)) {
      running = { ...running, ...el };
      continue;
    }
    if (!Array.isArray(el)) throw new JbeamTableError(`Unexpected ${typeof el} element in a table`);
    if (header === null) {
      if (!el.every((c): c is string => typeof c === 'string')) throw new JbeamTableError('Table header row must contain only strings');
      header = el;
      continue;
    }
    let cells = el;
    let inlineOptions: JbeamObject = {};
    const last = el[el.length - 1];
    // A dict beyond the declared columns is per-row options; a dict *within* them is a value.
    if (el.length > header.length && isJbeamObject(last)) {
      inlineOptions = last;
      cells = el.slice(0, -1);
    }
    const values: Record<string, JbeamValue> = {};
    header.forEach((col, i) => {
      if (i < cells.length) values[col] = cells[i]!;
    });
    records.push({ values, options: { ...running, ...inlineOptions }, inlineOptions, extra: cells.slice(header.length) });
  }
  if (header === null) throw new JbeamTableError('Table has no header row');
  return { header, records };
}

export interface WriteTableOptions {
  /**
   * Value that resets an option when a later row no longer carries it,
   * e.g. `{ group: "", breakGroup: "" }`. Without one, dropping an option
   * mid-table is an error (jbeam has no "unset").
   */
  resetValues?: JbeamObject;
  /** Write these option keys on every row inline instead of as option rows. */
  inlineKeys?: readonly string[];
  /** Emit a comment line before the record at this index. */
  comments?: ReadonlyMap<number, string>;
}

/** Drop options that equal their reset value (a reset is equivalent to "unset"). */
export function withoutResets(options: JbeamObject, resetValues: JbeamObject): JbeamObject {
  const out: JbeamObject = {};
  for (const [k, v] of Object.entries(options)) if (!(k in resetValues) || !sameValue(v, resetValues[k])) out[k] = v;
  return out;
}

function sameValue(a: JbeamValue | undefined, b: JbeamValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rebuild a table section from records, emitting option rows only where the
 * effective options change. readTable(writeTable(t)) reproduces every
 * record's values and effective options.
 */
export type WritableRecord = Pick<TableRecord, 'values' | 'options'> & Partial<Pick<TableRecord, 'inlineOptions'>>;

export function writeTable(header: readonly string[], records: readonly WritableRecord[], opts: WriteTableOptions = {}): WritableValue[] {
  const out: WritableValue[] = [[...header]];
  const inlineKeys = new Set(opts.inlineKeys ?? []);
  let running: JbeamObject = {};

  records.forEach((rec, index) => {
    const comment = opts.comments?.get(index);
    if (comment !== undefined) out.push(new JbeamComment(comment));

    // Row-only options stay on the row; if they override a running option,
    // the running value is left as it is for the rows that follow.
    const rowOnly = rec.inlineOptions ?? {};
    const wanted: JbeamObject = {};
    const rowInline: JbeamObject = {};
    for (const [k, v] of Object.entries(rec.options)) {
      if (inlineKeys.has(k) || k in rowOnly) {
        rowInline[k] = v;
        if (!inlineKeys.has(k) && k in running) wanted[k] = running[k]!;
      } else {
        wanted[k] = v;
      }
    }

    const change: JbeamObject = {};
    for (const [k, v] of Object.entries(wanted)) if (!sameValue(running[k], v)) change[k] = v;
    for (const k of Object.keys(running)) {
      if (k in wanted) continue;
      if (!opts.resetValues || !(k in opts.resetValues)) {
        throw new JbeamTableError(`Option "${k}" is dropped at row ${index} but has no reset value`);
      }
      if (!sameValue(running[k], opts.resetValues[k])) change[k] = opts.resetValues[k]!;
    }
    if (Object.keys(change).length > 0) {
      out.push(change);
      running = { ...running, ...change };
      for (const [k, v] of Object.entries(opts.resetValues ?? {})) if (!(k in wanted) && sameValue(running[k], v)) delete running[k];
    }

    const lastCol = header.reduce((acc, col, i) => (col in rec.values ? i : acc), -1);
    const row: WritableValue[] = [];
    for (let i = 0; i <= lastCol; i++) {
      const col = header[i]!;
      if (!(col in rec.values)) throw new JbeamTableError(`Row ${index} is missing column "${col}" before a later filled column`);
      row.push(rec.values[col]!);
    }
    if (Object.keys(rowInline).length > 0) {
      if (lastCol !== header.length - 1) throw new JbeamTableError(`Row ${index} has inline options but not all ${header.length} columns`);
      row.push(rowInline);
    }
    out.push(row);
  });
  return out;
}
