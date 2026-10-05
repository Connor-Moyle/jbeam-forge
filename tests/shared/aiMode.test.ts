import { describe, expect, it } from 'vitest';
import { parseReply } from '../../src/shared/ai/changes';
import { checkReply } from '../../src/shared/ai/check';
import { AI_JOBS } from '../../src/shared/ai/jobs';
import { buildIterate, buildRequest, type AiContext } from '../../src/shared/ai/prompt';

const part = (name: string, extra: Partial<AiContext['parts'][number]> = {}): AiContext['parts'][number] => ({
  name,
  displayName: name,
  kind: 'Door',
  position: null,
  parent: 'test_body',
  construction: 'steel',
  price: 300,
  priceSet: false,
  massKg: 18,
  massSet: false,
  nodes: 20,
  meshes: 2,
  slot: name,
  description: '',
  opens: false,
  hinged: false,
  hingeProblem: 'it doesn’t open',
  ...extra,
});

const ctx: AiContext = {
  car: { name: 'Test', brand: 'Forge', bodyStyle: 'Coupe', country: 'Japan', years: '1995–1999' },
  parts: [part('test_body', { kind: 'Body', parent: null, massKg: 300 }), part('test_door_FL', { opens: true, hingeProblem: null }), part('test_door_FR', { opens: true, hingeProblem: 'generate it first' }), part('test_wing', { kind: 'Wing' })],
  materials: [
    { name: 'paint', color: [1, 0, 0], metallic: 0.2, roughness: 0.4, clearCoat: 1, opacity: 1, game: false },
    { name: 'bx_main', color: [1, 1, 1], metallic: 0, roughness: 0.5, clearCoat: 0, opacity: 1, game: true },
  ],
  configs: [],
  slots: { test_hood: ['test_hood', 'test_hood_carbon'] },
  scripts: { templates: [{ id: 'windows', name: 'Electric windows', description: 'Windows go up and down.', params: [{ id: 'speed', label: 'Speed', kind: 'number', min: 0.1, max: 5, default: 1 }] }], present: [] },
  engine: { name: 'I4', fields: [{ key: 'e/mainEngine/idleRPM', label: 'Idle speed', unit: 'rpm', value: 900, min: 300, max: 3000 }] },
  gearbox: null,
  tuning: [],
};

describe('AI mode: reading replies', () => {
  it('finds the JSON in a chatty answer, with comments, trailing commas and curly quotes', () => {
    const text = 'Sure! Here you go:\n```json\n{\n  // names first\n  “summary”: “Done”,\n  "changes": [{"do": "price", "part": "test_door_FL", "price": 450},],\n}\n```\nHope that helps.';
    const r = parseReply(text);
    expect(r.summary).toBe('Done');
    expect(r.changes[0]!.change).toEqual({ do: 'price', part: 'test_door_FL', price: 450 });
  });

  it('reads a bare object and marks changes it can’t understand', () => {
    const r = parseReply('{"changes": [{"do": "teleport"}, {"do": "mass", "part": "test_wing", "kg": 4}]}');
    expect(r.changes[0]!.change).toBeNull();
    expect(r.changes[0]!.problem).toMatch(/not understood/);
    expect(r.changes[1]!.change?.do).toBe('mass');
  });

  it('says what to do when there is no reply in the text', () => {
    expect(() => parseReply('I can’t help with that.')).toThrow(/No reply found/);
    expect(() => parseReply('{"summary": "x"}')).toThrow(/"changes"/);
  });
});

describe('AI mode: checking changes', () => {
  const check = (jobs: string[], changes: unknown[]) => checkReply(ctx, jobs, parseReply(JSON.stringify({ changes })));

  it('accepts sensible changes and describes them', () => {
    const r = check(['prices', 'weights'], [{ do: 'price', part: 'test_door_FL', price: 450 }, { do: 'mass', part: 'test_door_FL', kg: 16 }]);
    expect(r.every((c) => c.ok)).toBe(true);
    expect(r[0]!.text).toBe('test_door_FL: price $450 (was $300)');
  });

  it('refuses unknown names, other jobs’ changes, bad ranges and units', () => {
    const r = check(['prices', 'weights'], [
      { do: 'price', part: 'test_roof', price: 100 },
      { do: 'rename', part: 'test_body', displayName: 'Body' },
      { do: 'price', part: 'test_body', price: -5 },
      { do: 'mass', part: 'test_body', kg: 300000 },
      { do: 'mass', part: 'test_door_FL', kg: 0.1 },
    ]);
    expect(r.map((c) => c.ok)).toEqual([false, false, false, false, false]);
    expect(r[0]!.problem).toMatch(/no part called "test_roof"/);
    expect(r[1]!.problem).toMatch(/isn't one of the chosen jobs/);
    expect(r[4]!.problem).toMatch(/units/);
  });

  it('only hinges parts that can take one, and never the game’s own materials', () => {
    const r = check(['hinges', 'materials'], [
      { do: 'hinge', part: 'test_door_FL' },
      { do: 'hinge', part: 'test_door_FR' },
      { do: 'material', material: 'bx_main', roughness: 0.3 },
      { do: 'material', material: 'paint', opacity: 0 },
    ]);
    expect(r.map((c) => c.ok)).toEqual([true, false, false, false]);
    expect(r[1]!.problem).toMatch(/generate it first/);
  });

  it('checks scripts, configurations, powertrain keys and tuning ranges', () => {
    const r = check(['scripts', 'configs', 'engine', 'tuning'], [
      { do: 'script', template: 'windows', params: { speed: 2 } },
      { do: 'script', template: 'windows', params: { speed: 99 } },
      { do: 'config', name: 'Carbon', parts: { test_hood: 'test_hood_carbon' } },
      { do: 'config', name: 'Wrong', parts: { test_hood: 'test_door_FL' } },
      { do: 'powertrain', unit: 'engine', key: 'e/mainEngine/idleRPM', value: 850 },
      { do: 'powertrain', unit: 'engine', key: 'e/mainEngine/idleRPM2', value: 850 },
      { do: 'tuning', part: 'test_wing', setting: 'downforce', min: 0.5, max: 1.5, default: 1 },
      { do: 'tuning', part: 'test_door_FL', setting: 'downforce', min: 0.5, max: 1.5, default: 1 },
    ]);
    expect(r.map((c) => c.ok)).toEqual([true, false, true, false, true, false, true, false]);
  });
});

describe('AI mode: requests', () => {
  it('holds the rule book, the jobs, the notes, only the sections the jobs need, and examples of only the allowed changes', () => {
    const text = buildRequest(ctx, ['prices'], 'A cheap 90s coupe');
    expect(text).toMatch(/Only use names that appear in this request/);
    expect(text).toMatch(/# Your jobs\n1\. Prices/);
    expect(text).toMatch(/A cheap 90s coupe/);
    expect(text).toMatch(/test_door_FL \| test_door_FL \| Door/);
    expect(text).not.toMatch(/## Materials/);
    expect(text).toMatch(/"do": "price"/);
    expect(text).not.toMatch(/"do": "rename"/);
  });

  it('iterates with what was applied, what was refused and what the modder wants', () => {
    const text = buildIterate(ctx, ['prices'], 'cheaper please', { applied: ['test_door_FL: price $450'], refused: ['test_roof: no part called "test_roof"'] });
    expect(text).toMatch(/# Applied\n- test_door_FL: price \$450/);
    expect(text).toMatch(/# Refused \(fix these\)/);
    expect(text).toMatch(/cheaper please/);
  });

  it('every job allows at least one change and needs at least one section', () => {
    for (const j of AI_JOBS) {
      expect(j.allows.length).toBeGreaterThan(0);
      expect(j.needs.length).toBeGreaterThan(0);
    }
  });
});
