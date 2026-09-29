import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/shared/project/io';
import { createProjectStore, currentStateId, historyForSave, isDirty, parseSavedHistory } from '../../src/renderer/app/stores/project';

const doc = () => createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));

describe('project store', () => {
  it('new documents are dirty; opened ones are clean', () => {
    const s = createProjectStore();
    s.getState().create(doc());
    expect(isDirty(s.getState())).toBe(true);
    s.getState().load(doc(), 'C:/p/test.jbforge');
    expect(isDirty(s.getState())).toBe(false);
  });

  it('executes commands with unlimited undo/redo', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    for (let i = 1; i <= 50; i++) s.getState().execute({ label: `rename ${i}`, apply: (d) => void (d.meta.name = `Name ${i}`) });
    expect(s.getState().doc!.meta.name).toBe('Name 50');
    for (let i = 0; i < 50; i++) s.getState().undo();
    expect(s.getState().doc!.meta.name).toBe('Test');
    expect(s.getState().undo()).toBeNull();
    expect(s.getState().redo()).toBe('rename 1');
    expect(s.getState().doc!.meta.name).toBe('Name 1');
  });

  it('returns the undone/redone label', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    s.getState().execute({ label: 'Set brand', apply: (d) => void (d.meta.brand = 'Forge') });
    expect(s.getState().undo()).toBe('Set brand');
    expect(s.getState().redo()).toBe('Set brand');
  });

  it('a no-op command creates no history', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    expect(s.getState().execute({ label: 'nothing', apply: () => undefined })).toBe(false);
    expect(s.getState().undoStack).toHaveLength(0);
  });

  it('a new command clears the redo stack', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    s.getState().execute({ label: 'a', apply: (d) => void (d.meta.brand = 'A') });
    s.getState().undo();
    s.getState().execute({ label: 'b', apply: (d) => void (d.meta.brand = 'B') });
    expect(s.getState().redoStack).toHaveLength(0);
    expect(s.getState().redo()).toBeNull();
  });

  it('dirty tracks the history position relative to the last save', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    s.getState().execute({ label: 'a', apply: (d) => void (d.meta.brand = 'A') });
    expect(isDirty(s.getState())).toBe(true);
    s.getState().undo();
    expect(isDirty(s.getState())).toBe(false); // back at the saved state
    s.getState().redo();
    s.getState().markSaved('x.jbforge', currentStateId(s.getState()));
    expect(isDirty(s.getState())).toBe(false);
    s.getState().undo();
    expect(isDirty(s.getState())).toBe(true); // before the saved state is dirty too
  });

  it('markSaved stamps without creating history or moving the position', () => {
    const s = createProjectStore();
    s.getState().create(doc());
    const before = currentStateId(s.getState());
    s.getState().markSaved('C:/p/new.jbforge', before, (d) => void (d.meta.modifiedAt = '2026-02-02T00:00:00.000Z'));
    expect(s.getState().doc!.meta.modifiedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(s.getState().filePath).toBe('C:/p/new.jbforge');
    expect(s.getState().undoStack).toHaveLength(0);
    expect(currentStateId(s.getState())).toBe(before);
    expect(isDirty(s.getState())).toBe(false);
  });

  it('documents are immutable snapshots (structural sharing)', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    const before = s.getState().doc!;
    s.getState().execute({ label: 'a', apply: (d) => void (d.meta.brand = 'A') });
    const after = s.getState().doc!;
    expect(after).not.toBe(before);
    expect(after.parts).toBe(before.parts); // untouched branches are shared
    expect(Object.isFrozen(after.meta)).toBe(true);
  });

  it('an edit made while a save was in flight stays dirty', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    s.getState().execute({ label: 'a', apply: (d) => void (d.meta.brand = 'A') });
    const serializedAt = currentStateId(s.getState()); // text taken here…
    s.getState().execute({ label: 'b', apply: (d) => void (d.meta.brand = 'B') }); // …user edits during the dialog
    s.getState().markSaved('x.jbforge', serializedAt);
    expect(isDirty(s.getState())).toBe(true);
    s.getState().undo();
    expect(isDirty(s.getState())).toBe(false);
  });

  it('refuses commands without an open project', () => {
    const s = createProjectStore();
    expect(() => s.getState().execute({ label: 'x', apply: () => undefined })).toThrow(/without an open project/);
  });
});

describe('undo history saved with the project', () => {
  it('round-trips: reopening the saved document brings back undo and redo', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    for (let i = 1; i <= 3; i++) s.getState().execute({ label: `rename ${i}`, apply: (d) => void (d.meta.name = `Name ${i}`) });
    s.getState().undo(); // "rename 3" is now redo
    const saved = s.getState().doc!;
    const text = historyForSave(s.getState(), currentStateId(s.getState()), 'hash')!;

    const reopened = createProjectStore();
    reopened.getState().load(saved, 'x.jbforge');
    reopened.getState().restoreHistory(parseSavedHistory(text)!);
    expect(isDirty(reopened.getState())).toBe(false);
    expect(reopened.getState().undo()).toBe('rename 2');
    expect(reopened.getState().doc!.meta.name).toBe('Name 1');
    reopened.getState().redo();
    expect(reopened.getState().redo()).toBe('rename 3');
    expect(reopened.getState().doc!.meta.name).toBe('Name 3');
  });

  it('stops at the saved position when edits happened during the save', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    s.getState().execute({ label: 'a', apply: (d) => void (d.meta.name = 'A') });
    const at = currentStateId(s.getState());
    s.getState().execute({ label: 'b', apply: (d) => void (d.meta.name = 'B') });
    const h = parseSavedHistory(historyForSave(s.getState(), at, 'hash')!)!;
    expect(h.undo.map((e) => e.label)).toEqual(['a']);
    expect(h.redo).toEqual([]);
  });

  it('rejects anything that is not a saved history', () => {
    expect(parseSavedHistory('{"version":2}')).toBeNull();
    expect(parseSavedHistory('nope')).toBeNull();
    expect(parseSavedHistory('{"version":1,"projectHash":"h","undo":[{"id":"x"}],"redo":[]}')).toBeNull();
  });
});

describe('coalesced edits', () => {
  it('merges rapid edits with the same key into one undo step', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    for (let i = 1; i <= 5; i++) s.getState().execute({ label: 'Drag', coalesce: 'name', apply: (d) => void (d.meta.name = `N${i}`) });
    expect(s.getState().undoStack).toHaveLength(1);
    s.getState().undo();
    expect(s.getState().doc!.meta.name).toBe('Test');
  });

  it('does not merge across a save', () => {
    const s = createProjectStore();
    s.getState().load(doc(), 'x.jbforge');
    s.getState().execute({ label: 'Drag', coalesce: 'name', apply: (d) => void (d.meta.name = 'A') });
    s.getState().markSaved('x.jbforge', currentStateId(s.getState()));
    s.getState().execute({ label: 'Drag', coalesce: 'name', apply: (d) => void (d.meta.name = 'B') });
    expect(s.getState().undoStack).toHaveLength(2);
    expect(isDirty(s.getState())).toBe(true);
  });
});

describe('undo limit', () => {
  it('keeps only the newest steps, and a project whose saved state dropped off stays changed', async () => {
    const { setUndoLimit } = await import('../../src/renderer/app/stores/project');
    setUndoLimit(5);
    try {
      const s = createProjectStore();
      s.getState().load(doc(), 'x.jbforge');
      for (let i = 0; i < 8; i++) s.getState().execute({ label: `rename ${i}`, apply: (d) => void (d.meta.name = `N${i}`) });
      expect(s.getState().undoStack).toHaveLength(5);
      // Undo everything that's left: 3 edits are still unsaved, so it must not read as saved.
      for (let i = 0; i < 5; i++) s.getState().undo();
      expect(s.getState().undoStack).toHaveLength(0);
      expect(s.getState().doc?.meta.name).toBe('N2');
      expect(isDirty(s.getState())).toBe(true);
      // Saving makes it clean again.
      s.getState().markSaved('x.jbforge', currentStateId(s.getState()));
      expect(isDirty(s.getState())).toBe(false);
    } finally {
      setUndoLimit(1000);
    }
  });
});
