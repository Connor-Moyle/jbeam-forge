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
  /**
   * Rapid edits with the same key (a slider being dragged) merge into one
   * undo step while they keep coming within a moment of each other.
   */
  coalesce?: string;
}

const COALESCE_MS = 1200;

export interface HistoryEntry {
  id: number;
  label: string;
  patches: Patch[];
  inverse: Patch[];
  coalesce?: string;
  at?: number;
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
  /** Put back undo/redo history saved with the project (right after load; the document is the saved state). */
  restoreHistory: (history: SavedHistory) => void;
}

/** Undo/redo history as written next to a project file. */
export interface SavedHistory {
  version: 1;
  /** SHA-256 of the project text this history ends at; anything else and it doesn't apply. */
  projectHash: string;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/** Keep saved history to what's useful and fast to load. */
const MAX_SAVED_ENTRIES = 300;
const MAX_SAVED_CHARS = 32 * 1024 * 1024;

/**
 * The history to save with the document as it was at history position
 * `stateId`. Edits made while the save was in flight aren't in the file, so
 * the saved history stops at `stateId` (and only keeps redo when nothing was
 * edited since). Null when that position is no longer in the stack.
 */
export function historyForSave(s: Pick<ProjectState, 'undoStack' | 'redoStack'>, stateId: number, projectHash: string): string | null {
  const at = stateId === 0 ? 0 : s.undoStack.findIndex((e) => e.id === stateId) + 1;
  if (stateId !== 0 && at === 0) return null;
  const redo = at === s.undoStack.length ? s.redoStack : [];
  let undo = s.undoStack.slice(0, at).slice(-MAX_SAVED_ENTRIES);
  let text = JSON.stringify({ version: 1, projectHash, undo, redo } satisfies SavedHistory);
  // Drop the oldest steps until it fits; one big generate step can be most of it.
  while (text.length > MAX_SAVED_CHARS && undo.length > 0) {
    undo = undo.slice(Math.ceil(undo.length / 4));
    text = JSON.stringify({ version: 1, projectHash, undo, redo } satisfies SavedHistory);
  }
  return text;
}

export function parseSavedHistory(text: string): SavedHistory | null {
  try {
    const h = JSON.parse(text) as Partial<SavedHistory>;
    const entryOk = (e: unknown) => {
      const x = e as Partial<HistoryEntry>;
      return typeof x?.id === 'number' && typeof x.label === 'string' && Array.isArray(x.patches) && Array.isArray(x.inverse);
    };
    if (h.version !== 1 || typeof h.projectHash !== 'string' || !Array.isArray(h.undo) || !Array.isArray(h.redo)) return null;
    if (!h.undo.every(entryOk) || !h.redo.every(entryOk)) return null;
    return h as SavedHistory;
  } catch {
    return null;
  }
}

let nextEntryId = 1;

/**
 * Follow-up rules that run inside every command, in the same undo step
 * (e.g. renaming meshes after their part when one is reassigned).
 */
const documentHooks: ((draft: Draft<Project>) => void)[] = [];

export function addDocumentHook(hook: (draft: Draft<Project>) => void): () => void {
  documentHooks.push(hook);
  return () => {
    const i = documentHooks.indexOf(hook);
    if (i >= 0) documentHooks.splice(i, 1);
  };
}

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
      const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
        command.apply(draft);
        for (const hook of documentHooks) hook(draft);
      });
      if (patches.length === 0) return false;
      const now = Date.now();
      set((s) => {
        const top = s.undoStack[s.undoStack.length - 1];
        const merge = !!command.coalesce && top?.coalesce === command.coalesce && now - (top.at ?? 0) < COALESCE_MS && s.savedStateId !== top.id;
        const entry: HistoryEntry = merge
          ? { ...top, patches: [...top.patches, ...patches], inverse: [...inverse, ...top.inverse], at: now }
          : { id: nextEntryId++, label: command.label, patches, inverse, coalesce: command.coalesce, at: now };
        return { doc: next, undoStack: [...(merge ? s.undoStack.slice(0, -1) : s.undoStack), entry], redoStack: [] };
      });
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

    restoreHistory: (history) => {
      const ids = [...history.undo, ...history.redo].map((e) => e.id);
      nextEntryId = Math.max(nextEntryId, ...ids, 0) + 1;
      const top = history.undo[history.undo.length - 1]?.id ?? 0;
      set({ undoStack: history.undo, redoStack: history.redo, savedStateId: top });
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
