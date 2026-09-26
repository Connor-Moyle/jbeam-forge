import { applyPatches, enablePatches, produce, produceWithPatches, type Draft, type Patch } from 'immer';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Project } from '@shared/project/schema';

enablePatches();

/**
 * The open project document + unlimited undo/redo (SPEC §4.5).
 *
 * Every document change goes through `execute(command)`: immer records the
 * forward and inverse patches, so undo/redo replays patches rather than
 * snapshotting whole documents. "Dirty" is derived by comparing the current
 * history position with the one recorded at the last save, so undoing back
 * to the saved state is clean again.
 */

export interface Command {
  /** Human-readable, shown in Edit → Undo "<label>" and the status bar. */
  label: string;
  apply: (draft: Draft<Project>) => void;
}

interface HistoryEntry {
  id: number;
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

export interface ProjectState {
  doc: Project | null;
  /** Where the document was last opened from / saved to; null = never saved. */
  filePath: string | null;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** History position at the last save/open; null = never saved (always dirty). */
  savedStateId: number | null;

  /** Replace the document with a freshly opened one (clean, empty history). */
  load: (doc: Project, filePath: string) => void;
  /** Start a new, never-saved document (dirty, empty history). */
  create: (doc: Project) => void;
  close: () => void;
  /** Apply an undoable change. Returns false when it changed nothing. */
  execute: (command: Command) => boolean;
  undo: () => string | null;
  redo: () => string | null;
  /**
   * Record a successful save of the document as it was at history position
   * `stateId` (captured when the text was serialized — edits made while the
   * save was in flight stay dirty). `update` may stamp e.g. modifiedAt without
   * creating history.
   */
  markSaved: (filePath: string, stateId: number, update?: (draft: Draft<Project>) => void) => void;
}

let nextEntryId = 1;

export function currentStateId(s: Pick<ProjectState, 'undoStack'>): number {
  return s.undoStack.length ? s.undoStack[s.undoStack.length - 1]!.id : 0;
}

export function isDirty(s: ProjectState): boolean {
  return s.doc !== null && (s.savedStateId === null || currentStateId(s) !== s.savedStateId);
}

export function createProjectStore(): StoreApi<ProjectState> {
  return createStore<ProjectState>()((set, get) => ({
    doc: null,
    filePath: null,
    undoStack: [],
    redoStack: [],
    savedStateId: null,

    load: (doc, filePath) => set({ doc, filePath, undoStack: [], redoStack: [], savedStateId: 0 }),
    create: (doc) => set({ doc, filePath: null, undoStack: [], redoStack: [], savedStateId: null }),
    close: () => set({ doc: null, filePath: null, undoStack: [], redoStack: [], savedStateId: null }),

    execute: (command) => {
      const { doc } = get();
      if (!doc) throw new Error(`Cannot run "${command.label}" without an open project`);
      const [next, patches, inverse] = produceWithPatches(doc, command.apply);
      if (patches.length === 0) return false;
      set((s) => ({
        doc: next,
        undoStack: [...s.undoStack, { id: nextEntryId++, label: command.label, patches, inverse }],
        redoStack: [],
      }));
      return true;
    },

    undo: () => {
      const { doc, undoStack } = get();
      const entry = undoStack[undoStack.length - 1];
      if (!doc || !entry) return null;
      set((s) => ({ doc: applyPatches(doc, entry.inverse), undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, entry] }));
      return entry.label;
    },

    redo: () => {
      const { doc, redoStack } = get();
      const entry = redoStack[redoStack.length - 1];
      if (!doc || !entry) return null;
      set((s) => ({ doc: applyPatches(doc, entry.patches), redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, entry] }));
      return entry.label;
    },

    markSaved: (filePath, stateId, update) => {
      const { doc } = get();
      if (!doc) return;
      // Save-time stamps are not user edits: no history entry, position unchanged.
      set({ doc: update ? produce(doc, update) : doc, filePath, savedStateId: stateId });
    },
  }));
}

/** The app's single project store. */
export const projectStore = createProjectStore();

export function useProjectStore<T>(selector: (s: ProjectState) => T): T {
  return useStore(projectStore, selector);
}
