import { describe, expect, it } from 'vitest';
import { applyPatch, extensionTemplate, SAMPLE_EXTENSION } from '../../src/shared/extensions/api';
import { checkLua } from '../../src/shared/lua/check';

describe('extension edits (JSON Patch)', () => {
  const doc = { parts: [{ name: 'a' }, { name: 'b' }], meta: { name: 'Car' } };

  it('adds, replaces and removes, on a copy', () => {
    const next = applyPatch(doc, [
      { op: 'replace', path: '/parts/0/name', value: 'A' },
      { op: 'add', path: '/parts/-', value: { name: 'c' } },
      { op: 'add', path: '/parts/0', value: { name: 'first' } },
      { op: 'remove', path: '/parts/2' },
      { op: 'add', path: '/meta/brand', value: 'Forge' },
    ]);
    expect(next).toEqual({ parts: [{ name: 'first' }, { name: 'A' }, { name: 'c' }], meta: { name: 'Car', brand: 'Forge' } });
    expect(doc.parts[0]!.name).toBe('a');
  });

  it('refuses paths that aren’t there or reach into prototypes', () => {
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/parts/5/name', value: 'x' }])).toThrow(/isn't there/);
    expect(() => applyPatch(doc, [{ op: 'remove', path: '/meta/none' }])).toThrow(/nothing there/);
    expect(() => applyPatch(doc, [{ op: 'add', path: '/__proto__/polluted', value: 1 }])).toThrow(/Not allowed/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('extension templates', () => {
  it('runs the sample extension against a stand-in forge: two commands and a template whose Lua checks clean', () => {
    const commands: string[] = [];
    const templates: unknown[] = [];
    const forge = { commands: { register: (c: { id: string }) => commands.push(c.id) }, scripts: { registerTemplate: (t: unknown) => templates.push(t) }, project: {}, ui: {} };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the sample extension's own file, as its worker would
    new Function('forge', SAMPLE_EXTENSION.main)(forge);
    expect(commands).toEqual(['count-parts', 'tidy-names']);
    const t = extensionTemplate('hello-extension', templates[0]);
    expect(t.id).toBe('ext_hello_extension_speed_warning');
    expect(checkLua(t.lua, { controller: true }).diagnostics).toEqual([]);
  });

  it('rejects templates that aren’t well formed', () => {
    expect(() => extensionTemplate('x', { id: 'Bad Id', name: 'x' })).toThrow();
    expect(() => extensionTemplate('x', { id: 'ok', name: 'x', category: 'Body', description: '', name0: 'ok', params: [], outputs: [], actions: [{ id: 'a', label: 'A', key: '', call: 'os.exit()' }], lua: 'return {}' })).toThrow();
  });
});
