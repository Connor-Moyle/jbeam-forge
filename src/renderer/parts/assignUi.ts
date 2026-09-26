import { create } from 'zustand';

/** Which assignment dialogs are open, and for which meshes. */
interface AssignUiState {
  /** Meshes being assigned (null = assign dialog closed). */
  meshKeys: readonly string[] | null;
  /** Add Custom Part dialog; `thenAssign` returns to the assign dialog with the new kind. */
  custom: { thenAssign: boolean } | null;
  /** Kind just created in the custom dialog, preselected when the assign dialog resumes. */
  preselectKind: string | null;
  openAssign: (meshKeys: readonly string[]) => void;
  closeAssign: () => void;
  openCustom: (thenAssign: boolean) => void;
  closeCustom: (createdKind?: string) => void;
}

export const useAssignUi = create<AssignUiState>()((set) => ({
  meshKeys: null,
  custom: null,
  preselectKind: null,
  openAssign: (meshKeys) => set({ meshKeys: meshKeys.length ? meshKeys : null, preselectKind: null }),
  closeAssign: () => set({ meshKeys: null, preselectKind: null }),
  openCustom: (thenAssign) => set({ custom: { thenAssign } }),
  closeCustom: (createdKind) => set((s) => ({ custom: null, preselectKind: s.custom?.thenAssign && createdKind ? createdKind : null })),
}));
