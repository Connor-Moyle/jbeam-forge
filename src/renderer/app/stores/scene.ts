import { create } from 'zustand';
import type { Placement } from '@shared/project/schema';
import type { ImportedMesh } from '@renderer/import/normalize';
import type { TextureReport } from '@renderer/import/textures';
import { disposeGeometries, disposeImported } from '@renderer/import/dispose';
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
  /** Placement the loaded geometry currently has (moved in place when the document's changes). */
  placement?: Placement;
  /** Settings/texture-folder fingerprint the meshes were built with. */
  fingerprint: string;
  fileName: string;
  /** Meshes exactly as loaded (owned: geometry, materials, textures). */
  raw: ImportedMesh[];
  /** What's shown: `raw` with the document's splits applied (split geometries share raw attributes). */
  meshes: ImportedMesh[];
  /** Fingerprint of the splits `meshes` was derived with. */
  splitsKey: string;
  textures: TextureReport | null;
  error: string | null;
  stats: { triangles: number; totalMs: number } | null;
}

interface SceneState {
  sources: Record<string, LoadedSource>;
  hidden: Record<string, true>;
  selection: readonly string[];
  hover: string | null;
  /** Part picked in the tree (Inspector subject); cleared by plain mesh selection. */
  activePart: string | null;
  /** Changed to ask the viewport to frame meshes (empty keys = everything); glide animates the camera. */
  /** Frame these meshes, or (no meshes) a box in BeamNG space. */
  frameRequest: { id: number; keys: readonly string[]; glide?: boolean; box?: readonly [[number, number, number], [number, number, number]] };
  /** Focus mode: these meshes stay solid, everything else is ghosted. null = off. */
  focus: FocusState | null;

  setSource: (s: LoadedSource) => void;
  removeSource: (sourceId: string) => void;
  clear: () => void;
  toggleHidden: (meshKey: string) => void;
  setHover: (meshKey: string | null) => void;
  /** mode: replace (click), add (shift), toggle (ctrl). */
  select: (keys: readonly string[], mode?: 'replace' | 'add' | 'toggle') => void;
  /** Select a part: its meshes become the selection and it becomes the active part. */
  selectPart: (partId: string | null, meshKeys: readonly string[]) => void;
  setHidden: (meshKeys: readonly string[], hidden: boolean) => void;
  requestFrame: (keys?: readonly string[], glide?: boolean, box?: readonly [[number, number, number], [number, number, number]]) => void;
  setFocus: (focus: FocusState | null) => void;
}

export interface FocusState {
  /** The focused part (null when focusing loose meshes). */
  partId: string | null;
  /** The part and everything attached to it. */
  parts: readonly string[];
  meshKeys: readonly string[];
}

function disposeSource(s: LoadedSource | undefined): void {
  if (s) disposeImported([...s.raw, ...s.meshes]);
}

/** Free what `next` no longer uses from `prev`: everything if the raw import changed, else stale split geometries. */
function releaseReplaced(prev: LoadedSource, next: LoadedSource): void {
  if (prev.raw !== next.raw) {
    disposeSource(prev);
    return;
  }
  if (prev.meshes === next.meshes) return;
  const keep = new Set<unknown>([...next.raw, ...next.meshes].map((m) => m.geometry));
  disposeGeometries(prev.meshes, keep);
}

export const useSceneStore = create<SceneState>()((set, get) => ({
  sources: {},
  hidden: {},
  selection: EMPTY_ARR,
  hover: null,
  activePart: null,
  frameRequest: { id: 0, keys: EMPTY_ARR },
  focus: null,

  setSource: (s) => {
    const prev = get().sources[s.sourceId];
    if (prev) releaseReplaced(prev, s);
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
    set({ sources: {}, hidden: {}, selection: EMPTY_ARR, hover: null, activePart: null, focus: null });
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
  setHidden: (keys, hide) =>
    set((st) => {
      const hidden = { ...st.hidden };
      for (const k of keys) {
        if (hide) hidden[k] = true;
        else delete hidden[k];
      }
      return { hidden };
    }),
  selectPart: (partId, keys) => set({ activePart: partId, selection: keys.length ? [...keys] : EMPTY_ARR }),
  select: (keys, mode = 'replace') =>
    set((st) => {
      if (mode === 'replace') return { selection: keys.length ? [...keys] : EMPTY_ARR, activePart: null };
      const current = new Set(st.selection);
      for (const k of keys) {
        if (mode === 'toggle' && current.has(k)) current.delete(k);
        else current.add(k);
      }
      return { selection: current.size ? [...current] : EMPTY_ARR, activePart: null };
    }),
  requestFrame: (keys = EMPTY_ARR, glide = false, box) => set((st) => ({ frameRequest: { id: st.frameRequest.id + 1, keys, glide, box } })),
  setFocus: (focus) => set({ focus }),
}));

/** All loaded meshes, source order preserved. Pure helper for derived views (use with useMemo). */
export function allMeshes(sources: Record<string, LoadedSource>): ImportedMesh[] {
  return Object.values(sources).flatMap((s) => s.meshes);
}
