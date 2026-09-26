import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JbeamSyntaxError, parseJbeam, type Diagnostic } from '../../../src/shared/jbeam/parse';

const QUIRKS = readFileSync(join(__dirname, '../../fixtures/jbeam/quirks.jbeam'), 'utf8');

function syntaxError(text: string): JbeamSyntaxError {
  try {
    parseJbeam(text);
  } catch (err) {
    expect(err).toBeInstanceOf(JbeamSyntaxError);
    return err as JbeamSyntaxError;
  }
  throw new Error('expected a syntax error');
}

const codes = (ds: Diagnostic[]) => ds.map((d) => d.code);

describe('parseJbeam — official quirks', () => {
  it('parses the quirks fixture to the expected value', () => {
    const { value } = parseJbeam(QUIRKS);
    expect(value).toEqual({
      test_part: {
        information: { authors: 'JBeam Forge tests', name: 'Quirks', value: 275 },
        slotType: 'test_part',
        slots2: [
          ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
          ['test_mod', ['test_mod'], [], '', 'Additional Modification', { coreSlot: true }],
        ],
        scaledragCoef: 1,
        nodes: [
          ['id', 'posX', 'posY', 'posZ'],
          { nodeMaterial: '|NM_METAL' },
          { group: 'test_part' },
          { nodeWeight: 0.5 },
          ['n1', -0.72, -0.8, 0.865],
          ['n2', 0.001, 250, 0, { nodeWeight: 2 }],
          { group: '' },
        ],
        beams: [['id1:', 'id2:'], { beamSpring: 2000000, beamDamp: 150, beamDeform: 'FLT_MAX', beamStrength: 'FLT_MAX' }, ['n1', 'n2']],
        spoke1: { 'links:': ['n1'] },
        brakes: { brakeTorque: '$=$brakebias == nil and $brakestrength*600 or 2800' },
        text: 'quote " backslash \\ tab \t unicode é slash /',
        flags: [true, false, null],
      },
    });
  });

  it('preserves key order', () => {
    const { value } = parseJbeam(QUIRKS);
    expect(Object.keys((value as Record<string, object>).test_part!)).toEqual([
      'information',
      'slotType',
      'slots2',
      'scaledragCoef',
      'nodes',
      'beams',
      'spoke1',
      'brakes',
      'text',
      'flags',
    ]);
  });

  it('reports info diagnostics only when asked', () => {
    expect(parseJbeam(QUIRKS).diagnostics.every((d) => d.level === 'warning')).toBe(true);
    const all = codes(parseJbeam(QUIRKS, { collectInfo: true }).diagnostics);
    for (const c of ['comment', 'missing-comma', 'trailing-comma', 'extra-comma', 'number-format'] as const) expect(all).toContain(c);
  });

  it('locates diagnostics by line and column', () => {
    const { diagnostics } = parseJbeam('{\n"a": 1\n"b": 2}', { collectInfo: true });
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'missing-comma', line: 3, col: 1 })]);
  });

  it('warns on stray commas around the colon', () => {
    const w = parseJbeam('{"a",: 1, "b":, 2}').diagnostics;
    expect(w.map((d) => d.message)).toEqual([expect.stringContaining("before ':'"), expect.stringContaining('after key "b"')]);
  });
});

describe('parseJbeam — tolerated non-standard input (warnings)', () => {
  it('bare identifiers become strings, nil becomes null', () => {
    const r = parseJbeam('{"a": FLT_MAX, "b": nil, c: 1}');
    expect(r.value).toEqual({ a: 'FLT_MAX', b: null, c: 1 });
    expect(codes(r.diagnostics)).toEqual(['bare-identifier', 'nil-literal', 'bare-identifier']);
  });

  it('single-quoted strings', () => {
    const r = parseJbeam("{'a': 'it\\'s'}");
    expect(r.value).toEqual({ a: "it's" });
    expect(codes(r.diagnostics)).toContain('single-quoted-string');
  });

  it('duplicate keys: last value wins, first position kept', () => {
    const r = parseJbeam('{"a": 1, "b": 2, "a": 3}');
    expect(r.value).toEqual({ a: 3, b: 2 });
    expect(Object.keys(r.value as object)).toEqual(['a', 'b']);
    expect(r.diagnostics[0]).toMatchObject({ code: 'duplicate-key', line: 1, col: 18 });
  });

  it('unknown escapes are kept literally', () => {
    const r = parseJbeam('{"p": "C:\\dir"}');
    expect(r.value).toEqual({ p: 'C:\\dir' });
    expect(codes(r.diagnostics)).toEqual(['unknown-escape']);
  });

  it('a "__proto__" key is data, not a prototype write', () => {
    const { value } = parseJbeam('{"__proto__": {"polluted": true}}');
    expect(Object.keys(value as object)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it('parses number forms seen in the wild', () => {
    expect(parseJbeam('[.5, -.5, 1., 1e3, 2.5E-2, 007, +1]').value).toEqual([0.5, -0.5, 1, 1000, 0.025, 7, 1]);
  });
});

describe('parseJbeam — hard errors with positions', () => {
  it.each([
    ['{"a": "unterminated', /Unterminated string.*line 1, col 7/],
    ['{"a": 1 /* never closed', /Unterminated block comment.*line 1, col 9/],
    ['{"a": [1, 2', /end of file inside an array/],
    ['{"a": 1', /end of file inside an object/],
    ['{"a" 1}', /Expected ':' after key "a"/],
    ['{"a": 1} {"b": 2}', /after the root value/],
    ['{"a": 1abc}', /Invalid number/],
    ['{"a": }', /expected a value/],
    ['{"a": "\\u12G4"}', /Invalid \\u escape/],
    ['', /end of file, expected a value/],
  ])('%s', (text, message) => {
    expect(syntaxError(text).message).toMatch(message);
  });

  it('reports the line of a multi-line error', () => {
    const err = syntaxError('{\n  "a": 1,\n  "b": ]\n}');
    expect(err.line).toBe(3);
    expect(err.col).toBe(8);
  });
});

describe('parseJbeam — strict mode (our own output)', () => {
  it('accepts JSON with comments', () => {
    expect(parseJbeam('// hi\n{"a": [1, 2] /* ok */}', { strict: true }).value).toEqual({ a: [1, 2] });
  });

  it.each(['{"a": 1 "b": 2}', '{"a": [1, 2,]}', '{"a": 1,}', '{"a": nil}', '{a: 1}', '{"a": .5}', '{"a": 1, "a": 2}'])('rejects %s', (text) => {
    expect(() => parseJbeam(text, { strict: true })).toThrow(/Strict mode/);
  });
});

describe('parseJbeam — regressions', () => {
  it('reads a number longer than 64 characters as one value', () => {
    const digits = `0.${'1'.repeat(100)}`;
    const { value, diagnostics } = parseJbeam(`[${digits}, 2]`, { collectInfo: true });
    expect(value).toEqual([Number(digits), 2]);
    expect(diagnostics).toEqual([]);
  });
});
