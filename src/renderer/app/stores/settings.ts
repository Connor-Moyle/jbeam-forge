import { useEffect } from 'react';
import { create } from 'zustand';
import type { Settings } from '@shared/settings-schema';
import { call } from '@renderer/diagnostics/ipc';

/**
 * Renderer mirror of the main-process settings. Main is the source of truth;
 * this store only reflects `settings:get` and `settings:changed`.
 */
interface SettingsState {
  settings: Settings | null;
  setSettings: (s: Settings) => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: null,
  setSettings: (settings) => set({ settings }),
}));

/** Mount once near the app root. */
export function useSettingsSync(): void {
  const setSettings = useSettingsStore((s) => s.setSettings);
  useEffect(() => {
    let alive = true;
    call('settings:get')
      .then((s) => {
        if (alive) setSettings(s);
      })
      .catch(() => undefined); // logged by call()
    const off = window.forge.on('settings:changed', setSettings);
    return () => {
      alive = false;
      off();
    };
  }, [setSettings]);
}
