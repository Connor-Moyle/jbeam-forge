import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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

interface UiState {
  /** Remembered open/closed state of CollapsibleSections, by section id. */
  collapsed: Record<string, boolean>;
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
      partialize: (s) => ({ collapsed: s.collapsed }),
    },
  ),
);
