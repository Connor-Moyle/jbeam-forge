import { create } from 'zustand';
import { BUILT_IN_TEMPLATES } from '@shared/lua/library';
import type { ScriptTemplate } from '@shared/lua/templates';

/**
 * Script templates the app knows: the built-in ones plus any extensions add
 * (Extensions can register their own vehicle functions).
 */
export const useTemplates = create<{ extra: ScriptTemplate[]; register: (t: ScriptTemplate) => void; unregister: (id: string) => void }>()((set) => ({
  extra: [],
  register: (t) => set((s) => ({ extra: [...s.extra.filter((x) => x.id !== t.id), t] })),
  unregister: (id) => set((s) => ({ extra: s.extra.filter((x) => x.id !== id) })),
}));

export function allTemplates(): ScriptTemplate[] {
  const extra = useTemplates.getState().extra.filter((t) => !BUILT_IN_TEMPLATES.some((b) => b.id === t.id));
  return [...BUILT_IN_TEMPLATES, ...extra];
}

export function templateById(id: string): ScriptTemplate | undefined {
  return allTemplates().find((t) => t.id === id);
}
