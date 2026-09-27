import { create } from 'zustand';

/** Modelling: the move gizmo on the selected meshes (M or the viewport's Move button). */
export const useMeshMove = create<{ on: boolean; toggle: () => void; set: (on: boolean) => void }>()((set) => ({
  on: false,
  toggle: () => set((s) => ({ on: !s.on })),
  set: (on) => set({ on }),
}));
