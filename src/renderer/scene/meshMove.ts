import { create } from 'zustand';
import type { GizmoMode } from '@renderer/panels/viewport/viewportRuntime';

/**
 * Editing: the gizmo on the selected meshes and what it does (move, rotate,
 * scale), like Blender's G / R / S. Esc or the same key again turns it off.
 */
export const useMeshMove = create<{ on: boolean; mode: GizmoMode; toggle: () => void; set: (on: boolean) => void; setMode: (mode: GizmoMode) => void }>()((set) => ({
  on: false,
  mode: 'translate',
  toggle: () => set((s) => ({ on: !s.on })),
  set: (on) => set({ on }),
  // Picking a mode turns the gizmo on; picking the active one again turns it off.
  setMode: (mode) => set((s) => (s.on && s.mode === mode ? { on: false } : { on: true, mode })),
}));
