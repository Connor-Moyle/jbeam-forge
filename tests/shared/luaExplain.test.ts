import { describe, expect, it } from 'vitest';
import { explainLine, explainLua } from '@shared/lua/explain';
import { BUILT_IN_TEMPLATES } from '@shared/lua/library';

const ctxOf = (t: (typeof BUILT_IN_TEMPLATES)[number]) => ({ name: t.name0, params: t.params, outputs: t.outputs, actions: t.actions });

describe('script tutorials: every line explained', () => {
  it.each(BUILT_IN_TEMPLATES.map((t) => [t.id, t] as const))('%s: every line has a specific note, in blocks', (_id, t) => {
    const chunks = explainLua(t.lua, ctxOf(t));
    const lines = chunks.flatMap((c) => c.lines);
    const codeLines = t.lua.split('\n').filter((l) => l.trim()).length;
    expect(lines.length).toBe(codeLines);
    for (const l of lines) {
      expect(l.note.length, `${t.id}:${l.n}`).toBeGreaterThan(10);
      expect(l.note, `${t.id}:${l.n} ${l.text}`).not.toMatch(/^Continues the code above/);
    }
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.title.length).toBeGreaterThan(0);
  });

  it('ties settings, keys and outputs to the lines that use them', () => {
    const wipers = BUILT_IN_TEMPLATES.find((t) => t.id === 'wipers')!;
    const notes = explainLua(wipers.lua, ctxOf(wipers)).flatMap((c) => c.lines);
    const at = (text: RegExp) => notes.find((l) => text.test(l.text))!.note;
    expect(at(/lowSeconds = jbeamData\.lowSeconds/)).toMatch(/“Low speed wipe”/);
    expect(at(/^local function cycle/)).toMatch(/“Wipers: next speed” key \(lctrl w\)/);
    expect(at(/electrics\.values\[out\] = position/)).toMatch(/“Arm position” \(jbf_wipers\)/);
    expect(at(/^local function updateGFX/)).toMatch(/Every frame/);
    expect(at(/^return M$/)).toMatch(/last line/);
  });

  it('says which block an end closes', () => {
    const lua = 'local function f(x)\n  if x then\n    for i = 1, 3 do\n      print(i)\n    end\n  end\nend\nreturn M';
    const notes = explainLua(lua, { name: 't', params: [], outputs: [], actions: [] }).flatMap((c) => c.lines);
    expect(notes[4]!.note).toMatch(/loop started on line 3/);
    expect(notes[5]!.note).toMatch(/check started on line 2/);
    expect(notes[6]!.note).toMatch(/function f \(started on line 1\)/);
  });

  it('explains comments and Lua idioms in words', () => {
    const ctx = { name: 't', params: [], outputs: [], actions: [] };
    expect(explainLine('-- hello', ctx, null)).toMatch(/comment.*“hello”/);
    expect(explainLine('local y = a > 1 and 2 or 3', ctx, 'f')).toMatch(/2 when a > 1, otherwise 3/);
  });
});
