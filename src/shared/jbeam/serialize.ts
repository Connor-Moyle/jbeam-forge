
/**
 * Idiomatic jbeam writer (SPEC §3.4): official-style layout — each part key at
 * the root, 4-space indent, one table row per line with aligned columns,
 * short flat dicts inline — but always strict JSON (+ optional `//` comments),
 * so our output parses with both BeamNG and any JSON tool.
 *
 * Guarantees (tested): parse(serialize(v)) deep-equals v, and serializing is
 * idempotent.
 */

/** A `//` comment line inside an array (e.g. `//--HOOD--` in a nodes table). Writer-only. */
export class JbeamComment {
  constructor(readonly text: string) {}
}

export type WritableValue = string | number | boolean | null | WritableValue[] | WritableObject | JbeamComment;
export interface WritableObject {
  [key: string]: WritableValue;
}

export interface SerializeOptions {
  /** Max rendered width for a dict to stay on one line. Default 110. */
  inlineWidth?: number;
  /** Cells wider than this don't widen their column. Default 32. */
  maxColumnWidth?: number;
}

const INDENT = '    ';

/** Numbers without exponents, exact round-trip, -0 preserved. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Cannot serialize non-finite number ${n} to jbeam`);
  if (Object.is(n, -0)) return '-0';
  const s = String(n);
  const m = s.match(/^(-?)(\d)(?:\.(\d+))?e([-+]\d+)$/);
  if (!m) return s;
  const [, sign, lead, frac = '', expText] = m;
  const digits = lead! + frac;
  const exp = Number(expText);
  const point = 1 + exp; // position of the decimal point within `digits`
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function isPlainObject(v: WritableValue): v is WritableObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof JbeamComment);
}

function isPrimitive(v: WritableValue): v is string | number | boolean | null {
  return v === null || typeof v !== 'object';
}

/** Compact single-line rendering; used for cells, inline dicts and primitive arrays. */
function inline(v: WritableValue): string {
  if (v instanceof JbeamComment) throw new Error('Comments can only appear as array elements');
  if (v === null) return 'null';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.filter((x) => !(x instanceof JbeamComment)).map(inline).join(', ')}]`;
  const entries = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${inline(x)}`);
  return `{${entries.join(', ')}}`;
}

function isFlat(v: WritableValue): boolean {
  if (isPrimitive(v)) return true;
  if (v instanceof JbeamComment) return false;
  if (Array.isArray(v)) return v.every((x) => isPrimitive(x) || (Array.isArray(x) && x.every(isPrimitive)));
  return Object.values(v).every((x) => isPrimitive(x) || (isPlainObject(x) && Object.values(x).every(isPrimitive)) || (Array.isArray(x) && x.every(isPrimitive)));
}

/**
 * A "table" is an array whose elements are rows (arrays) and option dicts,
 * i.e. the jbeam section shape. Rendered one element per line, columns aligned.
 */
function isTable(v: WritableValue[]): boolean {
  let rows = 0;
  for (const el of v) {
    if (Array.isArray(el)) rows++;
    else if (!isPlainObject(el) && !(el instanceof JbeamComment)) return false;
  }
  return rows > 0;
}

class Writer {
  private readonly inlineWidth: number;
  private readonly maxColumnWidth: number;

  constructor(opts: SerializeOptions) {
    this.inlineWidth = opts.inlineWidth ?? 110;
    this.maxColumnWidth = opts.maxColumnWidth ?? 32;
  }

  value(v: WritableValue, depth: number): string {
    if (v instanceof JbeamComment) throw new Error('Comments can only appear as array elements');
    if (isPrimitive(v)) return inline(v);
    if (Array.isArray(v)) return this.array(v, depth);
    return this.object(v, depth);
  }

  object(obj: WritableObject, depth: number): string {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    if (depth > 0 && isFlat(obj)) {
      const one = inline(obj);
      if (one.length + depth * INDENT.length <= this.inlineWidth) return one;
    }
    const pad = INDENT.repeat(depth + 1);
    const lines = keys.map((k, i) => `${pad}${JSON.stringify(k)}: ${this.value(obj[k]!, depth + 1)}${i < keys.length - 1 ? ',' : ''}`);
    return `{\n${lines.join('\n')}\n${INDENT.repeat(depth)}}`;
  }

  array(arr: WritableValue[], depth: number): string {
    if (arr.length === 0) return '[]';
    const hasComments = arr.some((x) => x instanceof JbeamComment);
    if (!hasComments && arr.every(isPrimitive)) {
      const one = inline(arr);
      if (one.length + depth * INDENT.length <= this.inlineWidth * 2) return one;
    }
    const pad = INDENT.repeat(depth + 1);

    if (isTable(arr)) {
      const widths = this.columnWidths(arr);
      return this.lines(arr, pad, depth, (el) => (Array.isArray(el) ? this.row(el, widths) : inline(el)));
    }
    return this.lines(arr, pad, depth, (el) => this.value(el, depth + 1));
  }

  private lines(arr: WritableValue[], pad: string, depth: number, render: (el: WritableValue) => string): string {
    // The comma rule is positional: every value except the last non-comment one.
    // (Comparing by value would drop commas from earlier duplicates.)
    let lastIndex = -1;
    arr.forEach((el, i) => {
      if (!(el instanceof JbeamComment)) lastIndex = i;
    });
    const out = arr.map((el, i) => {
      if (el instanceof JbeamComment) return `${pad}//${el.text}`;
      return `${pad}${render(el)}${i === lastIndex ? '' : ','}`;
    });
    return `[\n${out.join('\n')}\n${INDENT.repeat(depth)}]`;
  }

  private columnWidths(table: WritableValue[]): number[] {
    const widths: number[] = [];
    for (const el of table) {
      if (!Array.isArray(el)) continue;
      el.forEach((cell, i) => {
        if (i === el.length - 1) return; // last cell is never padded
        const w = inline(cell).length + 1; // + comma
        if (w <= this.maxColumnWidth) widths[i] = Math.max(widths[i] ?? 0, w);
      });
    }
    return widths;
  }

  private row(cells: WritableValue[], widths: number[]): string {
    const parts = cells.map((cell, i) => {
      const text = inline(cell);
      if (i === cells.length - 1) return text;
      return `${text},`.padEnd(widths[i] ?? 0);
    });
    return `[${parts.join(' ')}]`;
  }
}

/**
 * Serialize a jbeam document. The root must be an object (part name → part);
 * part keys are written flush-left like official files.
 */
export function serializeJbeam(doc: WritableObject, opts: SerializeOptions = {}): string {
  const w = new Writer(opts);
  const keys = Object.keys(doc);
  if (keys.length === 0) return '{}\n';
  const parts = keys.map((k, i) => `${JSON.stringify(k)}: ${w.value(doc[k]!, 0)}${i < keys.length - 1 ? ',' : ''}`);
  return `{\n${parts.join('\n')}\n}\n`;
}

/** Serialize any value (used for non-root fragments in tests and tooling). */
export function serializeJbeamValue(v: WritableValue, opts: SerializeOptions = {}): string {
  return new Writer(opts).value(v, 0);
}
