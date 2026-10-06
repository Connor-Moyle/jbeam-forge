import { create } from 'zustand';
import type { PresetId } from '@shared/layout-schema';

/**
 * Switching workspace from outside the shell (the Help centre starting a lesson): the editor
 * registers its switcher here while it's mounted.
 */
export const useWorkspaceBridge = create<{ switchTo: ((preset: PresetId) => void) | null; set: (fn: ((preset: PresetId) => void) | null) => void }>()((set) => ({
  switchTo: null,
  set: (fn) => set({ switchTo: fn }),
}));

/** Switch workspace if the editor is open; false when it isn't. */
export function switchWorkspace(preset: PresetId): boolean {
  const fn = useWorkspaceBridge.getState().switchTo;
  if (!fn) return false;
  fn(preset);
  return true;
}
