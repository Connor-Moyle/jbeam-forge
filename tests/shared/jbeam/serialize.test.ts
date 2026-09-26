import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJbeam, type JbeamObject } from '../../../src/shared/jbeam/parse';
import { formatNumber, JbeamComment, serializeJbeam, serializeJbeamValue } from '../../../src/shared/jbeam/serialize';

const QUIRKS = readFileSync(join(__dirname, '../../fixtures/jbeam/quirks.jbeam'), 'utf8');

describe('formatNumber', () => {
  it.each([
    [0, '0'],
    [-0, '-0'],
    [275, '275'],
    [0.865, '0.865'],
    [1e-7, '0.0000001'],
    [-1.5e-7, '-0.00000015'],
    [1.234e-10, '0.0000000001234'],
    [1e21, '1000000000000000000000'],
    [2.5e22, '25000000000000000000000'],
  ])('%s → %s', (n, s) => {
    expect(formatNumber(n)).toBe(s);
    expect(Object.is(Number(s), n)).toBe(true);
  });

  it('round-trips awkward doubles exactly', () => {
    for (const n of [0.1 + 0.2, Math.PI, 1 / 3, 123456789.12345679, 5e-324, 1.7976931348623157e308]) {
      expect(Number(formatNumber(n))).toBe(n);
    }
  });

  it('refuses non-finite numbers', () => {
    expect(() => formatNumber(Infinity)).toThrow(/non-finite/);
    expect(() => formatNumber(NaN)).toThrow(/non-finite/);
  });
});

describe('serializeJbeam', () => {
  const quirks = parseJbeam(QUIRKS).value as JbeamObject;

  it('writes idiomatic, aligned output (snapshot)', () => {
    expect(serializeJbeam(quirks)).toMatchSnapshot();
  });

  it('output is strict JSON-with-comments and round-trips exactly', () => {
    const out = serializeJbeam(quirks);
    expect(parseJbeam(out, { strict: true }).value).toStrictEqual(quirks);
  });

  it('is idempotent', () => {
    const once = serializeJbeam(quirks);
    const twice = serializeJbeam(parseJbeam(once).value as JbeamObject);
    expect(twice).toBe(once);
  });

  it('keeps short flat dicts inline and breaks long or nested ones', () => {
    const out = serializeJbeam({
      p: {
        short: { a: 1, b: 'x' },
        long: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`key_number_${i}`, i])),
        nested: { deep: { deeper: { a: 1 } } },
      },
    });
    expect(out).toContain('"short": {"a":1, "b":"x"}');
    expect(out).toMatch(/"long": \{\n {8}"key_number_0": 0,/);
    expect(out).toMatch(/"nested": \{\n {8}"deep": \{/);
  });

  it('writes comment markers inside tables and skips them for commas', () => {
    const out = serializeJbeam({
      p: {
        nodes: [['id', 'posX'], new JbeamComment('--HOOD--'), ['h1', 1], ['h2', 2], new JbeamComment('end')],
      },
    });
    expect(out).toContain('        //--HOOD--\n        ["h1", 1],\n        ["h2", 2]\n        //end\n');
    expect(parseJbeam(out, { strict: true }).value).toEqual({ p: { nodes: [['id', 'posX'], ['h1', 1], ['h2', 2]] } });
  });

  it('handles empty containers and empty documents', () => {
    expect(serializeJbeam({})).toBe('{}\n');
    expect(serializeJbeam({ p: { a: [], b: {} } })).toContain('"a": [],\n    "b": {}');
  });

  it('rejects comments outside arrays', () => {
    expect(() => serializeJbeamValue({ a: new JbeamComment('x') })).toThrow(/array elements/);
  });
});

describe('serializeJbeam — regressions', () => {
  it('keeps commas on earlier elements equal to the last one (long primitive arrays)', () => {
    const zeros = Array.from({ length: 120 }, () => 0); // too long to inline → one per line
    const out = serializeJbeam({ p: { v: zeros } });
    expect(parseJbeam(out, { strict: true }).value).toEqual({ p: { v: zeros } });
  });

  it('keeps commas when a comment precedes a duplicate of the last element', () => {
    const out = serializeJbeam({ p: { v: ['a', new JbeamComment('x'), 'b', 'a'] } });
    expect(parseJbeam(out, { strict: true }).value).toEqual({ p: { v: ['a', 'b', 'a'] } });
  });
});
