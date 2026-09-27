import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { EMPTY_ARR } from '@shared/empty';

/**
 * Structure edit mode: which nodes/beams are selected, the move options, and
 * the live preview of a drag in progress. UI state only; every actual change
 * goes through an undoable document command (structure/editCommands.ts).
 */

export type Vec3 = [number, number, number];

interface EditState {
  /** Edit mode on: clicks pick nodes and beams instead of meshes. */
  active: boolean;
  nodes: readonly string[];
  /** Beam keys (see beamKey). */
  beams: readonly string[];
  symmetry: boolean;
  soft: boolean;
  softRadius: number;
  /** Positions of nodes being dragged, before the move is committed. */
  preview: ReadonlyMap<string, Vec3> | null;

  setActive: (on: boolean) => void;
  select: (nodes: readonly string[], beams: readonly string[], mode?: 'replace' | 'add' | 'subtract') => void;
  clear: () => void;
  setOptions: (o: Partial<Pick<EditState, 'symmetry' | 'soft' | 'softRadius'>>) => void;
  setPreview: (p: ReadonlyMap<string, Vec3> | null) => void;
}

const merge = (cur: readonly string[], add: readonly string[], mode: 'replace' | 'add' | 'subtract'): readonly string[] => {
  if (mode === 'replace') return add.length ? [...new Set(add)] : EMPTY_ARR;
  const set = new Set(cur);
  for (const k of add) {
    if (mode === 'add') set.add(k);
    else set.delete(k);
  }
  return set.size ? [...set] : EMPTY_ARR;
};

export const useEditStore = create<EditState>()(
  persist(
    (set) => ({
      active: false,
      nodes: EMPTY_ARR,
      beams: EMPTY_ARR,
      symmetry: true,
      soft: false,
      softRadius: 0.3,
      preview: null,

      setActive: (active) => set(active ? { active } : { active, nodes: EMPTY_ARR, beams: EMPTY_ARR, preview: null }),
      select: (nodes, beams, mode = 'replace') => set((s) => ({ nodes: merge(s.nodes, nodes, mode), beams: merge(s.beams, beams, mode) })),
      clear: () => set({ nodes: EMPTY_ARR, beams: EMPTY_ARR }),
      setOptions: (o) => set(o),
      setPreview: (preview) => set({ preview }),
    }),
    {
      name: 'jbforge.edit',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ symmetry: s.symmetry, soft: s.soft, softRadius: s.softRadius }),
    },
  ),
);
