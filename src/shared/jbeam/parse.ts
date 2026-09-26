/**
 * Lenient jbeam parser (SPEC §3.4 — "jbeam is NOT JSON").
 *
 * Accepts everything observed in official BeamNG 0.39 content (see
 * docs/beamng-jbeam-syntax.md): `//` and `/* *\/` comments, missing commas
 * between object members and array elements, trailing commas, and the usual
 * JSON literals. Also tolerated with a diagnostic: bare identifiers (→ string,
 * `nil` → null), single-quoted strings, duplicate keys (last wins, first
 * position kept), unknown string escapes.
 *
 * Hard syntax errors throw JbeamSyntaxError with line/column. Key order is
 * preserved.
 */

export type JbeamValue = string | number | boolean | null | JbeamValue[] | JbeamObject;
export interface JbeamObject {
  [key: string]: JbeamValue;
}

export type DiagnosticLevel = 'info' | 'warning';

export type DiagnosticCode =
  | 'missing-comma'
  | 'trailing-comma'
  | 'extra-comma'
  | 'comment'
  | 'bare-identifier'
  | 'nil-literal'
  | 'single-quoted-string'
  | 'duplicate-key'
  | 'unknown-escape'
  | 'raw-control-char'
  | 'number-format';

export interface Diagnostic {
  level: DiagnosticLevel;
  code: DiagnosticCode;
  message: string;
  line: number;
  col: number;
}

export interface ParseOptions {
  /**
   * Strict mode (for our own serializer's output): any deviation from JSON
   * other than comments throws.
   */
  strict?: boolean;
  /** Record 'info'-level diagnostics (missing/trailing commas, comments). Default false. */
  collectInfo?: boolean;
}

export interface ParseResult {
  value: JbeamValue;
  diagnostics: Diagnostic[];
}

export class JbeamSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'JbeamSyntaxError';
  }
}

/** Character codes used by the scanner. */
const Ch = {
  Tab: 9,
  LF: 10,
  CR: 13,
  Space: 32,
  Quote: 34,
  Apos: 39,
  Plus: 43,
  Comma: 44,
  Minus: 45,
  Dot: 46,
  Slash: 47,
  Zero: 48,
  Nine: 57,
  Colon: 58,
  Star: 42,
  LBracket: 91,
  Backslash: 92,
  RBracket: 93,
  LBrace: 123,
  RBrace: 125,
  BOM: 0xfeff,
  NBSP: 0xa0,
} as const;

const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

const ESCAPES: Record<string, string> = { '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57) || c === Ch.Dot || c === Ch.Minus;
}

class Parser {
  private pos = 0;
  private line = 1;
  private lineStart = 0;
  readonly diagnostics: Diagnostic[] = [];

  constructor(
    private readonly src: string,
    private readonly opts: ParseOptions,
  ) {}

  parseDocument(): JbeamValue {
    this.skipTrivia();
    const value = this.parseValue();
    this.skipTrivia();
    // Official files sometimes end with "}," — tolerate trailing commas after the root.
    while (this.pos < this.src.length && this.src.charCodeAt(this.pos) === Ch.Comma) {
      this.note('info', 'trailing-comma', 'trailing comma after the root value');
      this.pos++;
      this.skipTrivia();
    }
    if (this.pos < this.src.length) this.fail(`Unexpected content after the root value: ${this.describeHere()}`);
    return value;
  }

  // ---- diagnostics ----

  private col(at = this.pos): number {
    return at - this.lineStart + 1;
  }

  private fail(message: string, line = this.line, col = this.col()): never {
    throw new JbeamSyntaxError(message, line, col);
  }

  private note(level: DiagnosticLevel, code: DiagnosticCode, message: string, line = this.line, col = this.col()): void {
    // Strict mode: everything except comments is an error.
    if (this.opts.strict && code !== 'comment') this.fail(`Strict mode: ${message}`, line, col);
    if (level === 'info' && !this.opts.collectInfo) return;
    this.diagnostics.push({ level, code, message, line, col });
  }

  private describeHere(): string {
    if (this.pos >= this.src.length) return 'end of file';
    return JSON.stringify(this.src.slice(this.pos, this.pos + 12));
  }

  // ---- trivia ----

  private newline(at: number): void {
    this.line++;
    this.lineStart = at + 1;
  }

  private skipTrivia(): void {
    const s = this.src;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (c === Ch.LF) {
        this.newline(this.pos);
        this.pos++;
      } else if (c === Ch.Space || c === Ch.Tab || c === Ch.CR || c === Ch.BOM || c === Ch.NBSP) {
        this.pos++;
      } else if (c === Ch.Slash && s.charCodeAt(this.pos + 1) === Ch.Slash) {
        this.note('info', 'comment', 'line comment');
        while (this.pos < s.length && s.charCodeAt(this.pos) !== Ch.LF) this.pos++;
      } else if (c === Ch.Slash && s.charCodeAt(this.pos + 1) === Ch.Star) {
        const startLine = this.line;
        const startCol = this.col();
        this.note('info', 'comment', 'block comment');
        this.pos += 2;
        for (;;) {
          if (this.pos >= s.length) this.fail('Unterminated block comment', startLine, startCol);
          const d = s.charCodeAt(this.pos);
          if (d === Ch.Star && s.charCodeAt(this.pos + 1) === Ch.Slash) {
            this.pos += 2;
            break;
          }
          if (d === Ch.LF) this.newline(this.pos);
          this.pos++;
        }
      } else {
        return;
      }
    }
  }

  // ---- values ----

  private parseValue(): JbeamValue {
    if (this.pos >= this.src.length) this.fail('Unexpected end of file, expected a value');
    const c = this.src.charCodeAt(this.pos);
    if (c === Ch.LBrace) return this.parseObject();
    if (c === Ch.LBracket) return this.parseArray();
    if (c === Ch.Quote || c === Ch.Apos) return this.parseString();
    if (c === Ch.Minus || c === Ch.Plus || c === Ch.Dot || (c >= Ch.Zero && c <= Ch.Nine)) return this.parseNumber();
    if (isIdentStart(c)) return this.parseIdentifierValue();
    this.fail(`Unexpected ${this.describeHere()}, expected a value`);
  }

  private parseObject(): JbeamObject {
    const obj: JbeamObject = {};
    const seen = new Set<string>();
    this.pos++; // {
    let needSeparator = false;
    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.src.length) this.fail('Unexpected end of file inside an object');
      const c = this.src.charCodeAt(this.pos);
      if (c === Ch.RBrace) {
        this.pos++;
        return obj;
      }
      if (c === Ch.Comma) {
        if (!needSeparator) this.note('info', 'extra-comma', 'extra comma');
        this.pos++;
        needSeparator = false;
        this.skipTrivia();
        if (this.src.charCodeAt(this.pos) === Ch.RBrace && seen.size > 0) this.note('info', 'trailing-comma', 'trailing comma in object');
        continue;
      }
      if (needSeparator) this.note('info', 'missing-comma', 'missing comma between object members');

      const keyLine = this.line;
      const keyCol = this.col();
      const key = this.parseKey();
      this.skipTrivia();
      // Seen in official content (large_tire): `"spoke1",: {…}` — a stray comma before the colon.
      while (this.src.charCodeAt(this.pos) === Ch.Comma) {
        const save = { pos: this.pos, line: this.line, lineStart: this.lineStart };
        this.pos++;
        this.skipTrivia();
        if (this.src.charCodeAt(this.pos) !== Ch.Colon) {
          ({ pos: this.pos, line: this.line, lineStart: this.lineStart } = save);
          break;
        }
        this.note('warning', 'extra-comma', `stray comma before ':' after key ${JSON.stringify(key)}`);
      }
      if (this.src.charCodeAt(this.pos) !== Ch.Colon) this.fail(`Expected ':' after key ${JSON.stringify(key)}, found ${this.describeHere()}`);
      this.pos++;
      this.skipTrivia();
      // Seen in official content: `"part":,` — a stray comma between colon and value.
      while (this.src.charCodeAt(this.pos) === Ch.Comma) {
        this.note('warning', 'extra-comma', `stray comma after key ${JSON.stringify(key)}`);
        this.pos++;
        this.skipTrivia();
      }
      const value = this.parseValue();
      if (seen.has(key)) this.note('warning', 'duplicate-key', `duplicate key ${JSON.stringify(key)} (last value wins)`, keyLine, keyCol);
      seen.add(key);
      setKey(obj, key, value);
      needSeparator = true;
    }
  }

  private parseKey(): string {
    const c = this.src.charCodeAt(this.pos);
    if (c === Ch.Quote || c === Ch.Apos) return this.parseString();
    if (isIdentStart(c) || (c >= Ch.Zero && c <= Ch.Nine)) {
      const start = this.pos;
      while (this.pos < this.src.length && isIdentPart(this.src.charCodeAt(this.pos))) this.pos++;
      const key = this.src.slice(start, this.pos);
      this.note('warning', 'bare-identifier', `unquoted key ${key}`, this.line, this.col(start));
      return key;
    }
    this.fail(`Expected an object key, found ${this.describeHere()}`);
  }

  private parseArray(): JbeamValue[] {
    const arr: JbeamValue[] = [];
    this.pos++; // [
    let needSeparator = false;
    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.src.length) this.fail('Unexpected end of file inside an array');
      const c = this.src.charCodeAt(this.pos);
      if (c === Ch.RBracket) {
        this.pos++;
        return arr;
      }
      if (c === Ch.Comma) {
        if (!needSeparator) this.note('info', 'extra-comma', 'extra comma');
        this.pos++;
        needSeparator = false;
        this.skipTrivia();
        if (this.src.charCodeAt(this.pos) === Ch.RBracket && arr.length > 0) this.note('info', 'trailing-comma', 'trailing comma in array');
        continue;
      }
      if (needSeparator) this.note('info', 'missing-comma', 'missing comma between array elements');
      arr.push(this.parseValue());
      needSeparator = true;
    }
  }

  private parseString(): string {
    const s = this.src;
    const quote = s.charCodeAt(this.pos);
    const startLine = this.line;
    const startCol = this.col();
    if (quote === Ch.Apos) this.note('warning', 'single-quoted-string', 'single-quoted string');
    this.pos++;
    let out = '';
    let chunkStart = this.pos;
    for (;;) {
      if (this.pos >= s.length) this.fail('Unterminated string', startLine, startCol);
      const c = s.charCodeAt(this.pos);
      if (c === quote) {
        out += s.slice(chunkStart, this.pos);
        this.pos++;
        return out;
      }
      if (c === Ch.Backslash) {
        out += s.slice(chunkStart, this.pos);
        const e = s[this.pos + 1];
        if (e === undefined) this.fail('Unterminated string', startLine, startCol);
        if (e === 'u') {
          const hex = s.slice(this.pos + 2, this.pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail(`Invalid \\u escape ${JSON.stringify(hex)}`);
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 6;
        } else if (e in ESCAPES) {
          out += ESCAPES[e];
          this.pos += 2;
        } else {
          this.note('warning', 'unknown-escape', `unknown escape \\${e} kept literally`);
          out += '\\' + e;
          this.pos += 2;
        }
        chunkStart = this.pos;
        continue;
      }
      if (c === Ch.LF) {
        this.note('warning', 'raw-control-char', 'raw newline inside string');
        this.newline(this.pos);
      }
      this.pos++;
    }
  }

  private parseNumber(): number {
    const s = this.src;
    const start = this.pos;
    // Sticky match on the full source, so arbitrarily long numbers are one token.
    NUMBER_RE.lastIndex = start;
    const text = NUMBER_RE.test(s) ? s.slice(start, NUMBER_RE.lastIndex) : null;
    if (!text) this.fail(`Invalid number ${this.describeHere()}`);
    this.pos += text.length;
    if (text.startsWith('+') || /^[-+]?\./.test(text) || /\.(?:$|[eE])/.test(text) || /^-?0\d/.test(text)) {
      this.note('warning', 'number-format', `non-JSON number ${text}`, this.line, this.col(start));
    }
    // A number immediately followed by identifier characters is not a number (e.g. 1abc).
    if (this.pos < s.length && isIdentStart(s.charCodeAt(this.pos))) this.fail(`Invalid number ${JSON.stringify(s.slice(start, this.pos + 8))}`, this.line, this.col(start));
    return Number(text);
  }

  private parseIdentifierValue(): JbeamValue {
    const start = this.pos;
    while (this.pos < this.src.length && isIdentPart(this.src.charCodeAt(this.pos))) this.pos++;
    const word = this.src.slice(start, this.pos);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    if (word === 'nil') {
      this.note('warning', 'nil-literal', 'bare nil treated as null', this.line, this.col(start));
      return null;
    }
    this.note('warning', 'bare-identifier', `bare identifier ${word} treated as a string`, this.line, this.col(start));
    return word;
  }
}

/** Assign without letting a "__proto__" key touch the prototype. */
function setKey(obj: JbeamObject, key: string, value: JbeamValue): void {
  if (key === '__proto__') Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  else obj[key] = value;
}

export function parseJbeam(text: string, opts: ParseOptions = {}): ParseResult {
  const parser = new Parser(text, opts);
  const value = parser.parseDocument();
  return { value, diagnostics: parser.diagnostics };
}

export function isJbeamObject(v: JbeamValue | undefined): v is JbeamObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
