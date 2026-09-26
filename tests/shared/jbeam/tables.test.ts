import { describe, expect, it } from 'vitest';
import { parseJbeam, type JbeamValue } from '../../../src/shared/jbeam/parse';
import { serializeJbeam } from '../../../src/shared/jbeam/serialize';
import { readTable, withoutResets, writeTable, JbeamTableError, type WritableRecord } from '../../../src/shared/jbeam/tables';

const NODES: JbeamValue = [
  { nodeMaterial: '|NM_METAL' },
  ['id', 'posX', 'posY', 'posZ'],
  { group: 'hood' },
  { nodeWeight: 0.5 },
  ['h1', -0.72, -0.8, 0.865],
  ['h2', 0, -1.6, 0.775, { nodeWeight: 2, selfCollision: false }],
  { group: '' },
  ['h3', 0.1, 0.2, 0.3],
];

describe('readTable', () => {
  it('maps rows by header and applies running + inline options', () => {
    const t = readTable(NODES);
    expect(t.header).toEqual(['id', 'posX', 'posY', 'posZ']);
    expect(t.records.map((r) => r.values.id)).toEqual(['h1', 'h2', 'h3']);
    expect(t.records[0]).toEqual({
      values: { id: 'h1', posX: -0.72, posY: -0.8, posZ: 0.865 },
      options: { nodeMaterial: '|NM_METAL', group: 'hood', nodeWeight: 0.5 },
      inlineOptions: {},
      extra: [],
    });
    expect(t.records[1]!.options).toEqual({ nodeMaterial: '|NM_METAL', group: 'hood', nodeWeight: 2, selfCollision: false });
    expect(t.records[1]!.inlineOptions).toEqual({ nodeWeight: 2, selfCollision: false });
    // Inline options apply to that row only.
    expect(t.records[2]!.options).toEqual({ nodeMaterial: '|NM_METAL', group: '', nodeWeight: 0.5 });
  });

  it('treats a dict inside the declared columns as a value, not options', () => {
    const t = readTable([['name', 'size'], ['box', { x: 1 }]]);
    expect(t.records[0]!.values.size).toEqual({ x: 1 });
    expect(t.records[0]!.inlineOptions).toEqual({});
  });

  it('keeps short rows and extra cells', () => {
    const t = readTable([['type', 'name', 'inputName', 'inputIndex', 'gearRatio'], ['shaft', 'a', 'b', 1], ['x', 'y', 'z', 1, 2, 'bonus']]);
    expect(t.records[0]!.values).toEqual({ type: 'shaft', name: 'a', inputName: 'b', inputIndex: 1 });
    expect(t.records[1]!.extra).toEqual(['bonus']);
  });

  it.each([
    [{}, /must be an array/],
    [[{ a: 1 }], /no header row/],
    [[['id', 2]], /only strings/],
    [[['id'], 'oops'], /Unexpected string/],
  ])('rejects malformed tables %#', (section, message) => {
    expect(() => readTable(section as JbeamValue)).toThrow(message);
  });
});

describe('writeTable', () => {
  const reset = { group: '' };

  it('round-trips through readTable (values + effective options)', () => {
    const t = readTable(NODES);
    const written = writeTable(t.header, t.records, { resetValues: reset });
    const back = readTable(written as JbeamValue);
    expect(back.records.map((r) => r.values)).toEqual(t.records.map((r) => r.values));
    expect(back.records.map((r) => withoutResets(r.options, reset))).toEqual(t.records.map((r) => withoutResets(r.options, reset)));
  });

  it('emits option rows only where options change', () => {
    const header = ['id1:', 'id2:'];
    const spring = { beamSpring: 2000000, beamDamp: 150 };
    const out = writeTable(header, [
      { values: { 'id1:': 'a', 'id2:': 'b' }, options: spring },
      { values: { 'id1:': 'b', 'id2:': 'c' }, options: spring },
      { values: { 'id1:': 'c', 'id2:': 'd' }, options: { ...spring, beamDamp: 250 } },
    ]);
    expect(out).toEqual([header, spring, ['a', 'b'], ['b', 'c'], { beamDamp: 250 }, ['c', 'd']]);
  });

  it('writes a reset when an option is dropped, and errors without one', () => {
    const header = ['id'];
    const recs: WritableRecord[] = [
      { values: { id: 'a' }, options: { group: 'hood' } },
      { values: { id: 'b' }, options: {} },
    ];
    expect(writeTable(header, recs, { resetValues: { group: '' } })).toEqual([header, { group: 'hood' }, ['a'], { group: '' }, ['b']]);
    expect(() => writeTable(header, recs)).toThrow(JbeamTableError);
  });

  it('puts inlineKeys on the row itself', () => {
    const out = writeTable(['id', 'posX'], [{ values: { id: 'a', posX: 1 }, options: { nodeWeight: 3, group: 'g' } }], { inlineKeys: ['nodeWeight'] });
    expect(out).toEqual([['id', 'posX'], { group: 'g' }, ['a', 1, { nodeWeight: 3 }]]);
  });

  it('rejects gaps before a filled column', () => {
    expect(() => writeTable(['a', 'b', 'c'], [{ values: { a: 1, c: 3 }, options: {} }])).toThrow(/missing column "b"/);
  });

  it('serializes a nodes section idiomatically (snapshot) and parses back strictly', () => {
    const t = readTable(NODES);
    const doc = { hood: { nodes: writeTable(t.header, t.records, { resetValues: reset, comments: new Map([[0, '--HOOD--']]) }) } };
    const text = serializeJbeam(doc);
    expect(text).toMatchSnapshot();
    expect(() => parseJbeam(text, { strict: true })).not.toThrow();
  });
});
