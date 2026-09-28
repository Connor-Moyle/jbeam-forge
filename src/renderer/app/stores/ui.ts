import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Channel } from '@renderer/panels/viewport/channels';

/**
 * UI-only state. See docs/zustand-rules.md: selectors must return stable
 * references (use EMPTY_* fallbacks, useShallow for derived objects) and the
 * store is never written during render.
 */

export type StatusTone = 'info' | 'success' | 'warning' | 'danger';

export interface StatusMessage {
  id: number;
  text: string;
  tone: StatusTone;
}

export interface ViewToggles {
  /** Imported meshes visible. */
  mesh: boolean;
  /** Generated nodes and beams drawn over the model. */
  structure: boolean;
  /** X-ray: every mesh see-through (same look and opacity as focus mode's ghost). */
  xray: boolean;
}

interface UiState {
  /** Remembered open/closed state of CollapsibleSections, by section id. */
  collapsed: Record<string, boolean>;
  view: ViewToggles;
  /** Material channel the viewport shows (roughness, normals, UV checker…). */
  channel: Channel;
  setChannel: (channel: Channel) => void;
  toggleView: (key: keyof ViewToggles) => void;
  status: StatusMessage | null;
  setCollapsed: (id: string, collapsed: boolean) => void;
  pushStatus: (text: string, tone?: StatusTone, ttlMs?: number) => void;
  clearStatus: (id: number) => void;
}

const DEFAULT_STATUS_TTL_MS = 4000;
let nextStatusId = 1;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      collapsed: {},
      view: { mesh: true, structure: true, xray: false },
      channel: 'shaded',
      setChannel: (channel) => set({ channel }),
      toggleView: (key) => set((s) => ({ view: { ...s.view, [key]: !s.view[key] } })),
      status: null,
      setCollapsed: (id, collapsed) => {
        if (get().collapsed[id] === collapsed) return;
        set((s) => ({ collapsed: { ...s.collapsed, [id]: collapsed } }));
      },
      pushStatus: (text, tone = 'info', ttlMs = DEFAULT_STATUS_TTL_MS) => {
        const id = nextStatusId++;
        set({ status: { id, text, tone } });
        if (statusTimer) clearTimeout(statusTimer);
        statusTimer = setTimeout(() => get().clearStatus(id), ttlMs);
      },
      clearStatus: (id) => {
        if (get().status?.id === id) set({ status: null });
      },
    }),
    {
      name: 'jbforge.ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ collapsed: s.collapsed, view: s.view }),
      // Older saved views lack newer toggles: fill them from the defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<UiState, 'collapsed' | 'view'>>;
        return { ...current, ...p, view: { ...current.view, ...p.view } };
      },
    },
  ),
);
