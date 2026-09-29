import { useEffect } from 'react';
import { create } from 'zustand';
import type { Settings } from '@shared/settings-schema';
import { call } from '@renderer/diagnostics/ipc';
import { clearTokenCache } from '@renderer/ui/tokens';

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
  setSettings: (settings) => {
    applyInterface(settings);
    set({ settings });
  },
}));

/** Settings → Interface on the page: theme, accent, density, text size, corners, animations, tooltips. */
export function applyInterface(s: Settings): void {
  const root = document.documentElement;
  const set = (name: string, value: string | null) => (value === null ? root.removeAttribute(name) : root.setAttribute(name, value));
  const before = `${root.getAttribute('data-theme')}|${root.getAttribute('data-accent')}|${root.getAttribute('data-density')}|${root.getAttribute('data-font')}`;
  set('data-theme', s.theme === 'dark' ? null : s.theme);
  set('data-accent', s.accent === 'blue' ? null : s.accent);
  set('data-density', s.density === 'normal' ? null : s.density);
  set('data-font', s.fontSize === 'normal' ? null : s.fontSize);
  set('data-corners', s.squareCorners ? 'square' : null);
  set('data-motion', s.animations ? null : 'off');
  set('data-tooltips', s.showTooltips ? null : 'off');
  set('data-statusbar', s.showStatusBar ? null : 'off');
  const after = `${root.getAttribute('data-theme')}|${root.getAttribute('data-accent')}|${root.getAttribute('data-density')}|${root.getAttribute('data-font')}`;
  if (before !== after) {
    clearTokenCache();
    useThemeVersion.setState((v) => ({ version: v.version + 1 }));
  }
}

/** Bumped when the theme's colours or sizes change (the viewport remakes its colours). */
export const useThemeVersion = create<{ version: number }>()(() => ({ version: 0 }));

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
