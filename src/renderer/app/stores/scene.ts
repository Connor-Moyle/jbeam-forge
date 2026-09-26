import { create } from 'zustand';
import type { ImportedMesh } from '@renderer/import/normalize';
import type { TextureReport } from '@renderer/import/textures';
import { disposeImported } from '@renderer/import/dispose';
import { EMPTY_ARR } from '@shared/empty';

/**
 * Loaded geometry for the open project's sources, plus view state
 * (visibility, selection, hover). Runtime only: rebuilt from `doc.sources`
 * on open; the document holds what the user decided, not the triangles.
 */

export type SourceStatus = 'loading' | 'ready' | 'error' | 'missing';

export interface LoadedSource {
  sourceId: string;
  status: SourceStatus;
  /** Settings/texture-folder fingerprint the meshes were built with. */
  fingerprint: string;
  fileName: string;
  meshes: ImportedMesh[];
  textures: TextureReport | null;
  error: string | null;
  stats: { triangles: number; totalMs: number } | null;
}

interface SceneState {
  sources: Record<string, LoadedSource>;
  hidden: Record<string, true>;
  selection: readonly string[];
  hover: string | null;
  /** Changed to ask the viewport to frame meshes (empty keys = everything). */
  frameRequest: { id: number; keys: readonly string[] };

  setSource: (s: LoadedSource) => void;
  removeSource: (sourceId: string) => void;
  clear: () => void;
  toggleHidden: (meshKey: string) => void;
  setHover: (meshKey: string | null) => void;
  /** mode: replace (click), add (shift), toggle (ctrl). */
  select: (keys: readonly string[], mode?: 'replace' | 'add' | 'toggle') => void;
  requestFrame: (keys?: readonly string[]) => void;
}

function disposeSource(s: LoadedSource | undefined): void {
  if (s) disposeImported(s.meshes);
}

export const useSceneStore = create<SceneState>()((set, get) => ({
  sources: {},
  hidden: {},
  selection: EMPTY_ARR,
  hover: null,
  frameRequest: { id: 0, keys: EMPTY_ARR },

  setSource: (s) => {
    const prev = get().sources[s.sourceId];
    if (prev && prev.meshes !== s.meshes) disposeSource(prev);
    set((st) => ({ sources: { ...st.sources, [s.sourceId]: s } }));
  },
  removeSource: (sourceId) => {
    const prev = get().sources[sourceId];
    if (!prev) return;
    disposeSource(prev);
    const prefix = `${sourceId}:`;
    set((st) => {
      const { [sourceId]: _gone, ...rest } = st.sources;
      return {
        sources: rest,
        selection: st.selection.filter((k) => !k.startsWith(prefix)),
        hover: st.hover?.startsWith(prefix) ? null : st.hover,
      };
    });
  },
  clear: () => {
    for (const s of Object.values(get().sources)) disposeSource(s);
    set({ sources: {}, hidden: {}, selection: EMPTY_ARR, hover: null });
  },
  toggleHidden: (key) =>
    set((st) => {
      const hidden = { ...st.hidden };
      if (hidden[key]) delete hidden[key];
      else hidden[key] = true;
      return { hidden };
    }),
  setHover: (hover) => {
    if (get().hover !== hover) set({ hover });
  },
  select: (keys, mode = 'replace') =>
    set((st) => {
      if (mode === 'replace') return { selection: keys.length ? [...keys] : EMPTY_ARR };
      const current = new Set(st.selection);
      for (const k of keys) {
        if (mode === 'toggle' && current.has(k)) current.delete(k);
        else current.add(k);
      }
      return { selection: current.size ? [...current] : EMPTY_ARR };
    }),
  requestFrame: (keys = EMPTY_ARR) => set((st) => ({ frameRequest: { id: st.frameRequest.id + 1, keys } })),
}));

/** All loaded meshes, source order preserved. Pure helper for derived views (use with useMemo). */
export function allMeshes(sources: Record<string, LoadedSource>): ImportedMesh[] {
  return Object.values(sources).flatMap((s) => s.meshes);
}
