import type { KeymapId } from '@shared/keymap';
import { inField, isKey } from '@renderer/app/keys';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { openExport } from '@renderer/export/exportFlow';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { LAYOUT_VERSION, PresetIdSchema, type PresetId, type StoredLayout } from '@shared/layout-schema';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { reportError } from '@renderer/diagnostics/globalHandlers';
import { runSmokeWorker } from '@renderer/diagnostics/workerRelay';
import { registerTestHooks } from '@renderer/app/testHooks';
import { useUiStore } from '@renderer/app/stores/ui';
import { emitTestSignal } from '@renderer/app/testBus';
import { DEFAULT_PRESET, PRESET_LABELS, applyPreset as buildPreset, showPanel as show, togglePanel as toggle } from './presets';
import { PANELS, isPanelId, type PanelId } from './panelRegistry';

const logger = rlog('shell');
const SAVE_DEBOUNCE_MS = 500;

export interface ShellApi {
  ready: boolean;
  preset: PresetId;
  /** Dev tools (Component Kit panel, crash probes) are available. */
  devMode: boolean;
  attach: (api: DockviewApi) => void;
  applyPreset: (preset: PresetId) => void;
  resetLayout: () => void;
  togglePanel: (id: PanelId) => void;
  /** Open or focus a panel (never closes). */
  showPanel: (id: PanelId) => void;
}

const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>');
  return ctx;
}

/** The shell when there is one (panels rendered on their own, e.g. in tests, get null). */
export function useOptionalShell(): ShellApi | null {
  return useContext(ShellContext);
}

/** A stored layout is usable only if every panel is one we can render here. */
export function isRestorable(layout: StoredLayout, devMode: boolean): boolean {
  const panels = Object.values(layout.dockview.panels);
  if (panels.length === 0) return false; // an empty layout (e.g. captured mid-teardown) is never useful
  return panels.every((p) => {
    const component = p.contentComponent ?? p.id;
    return isPanelId(component) && (devMode || !('devOnly' in PANELS[component]));
  });
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const devMode = window.forge.isDev || window.forge.harness;
  const apiRef = useRef<DockviewApi | null>(null);
  const presetRef = useRef<PresetId>(DEFAULT_PRESET);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [ready, setReady] = useState(false);
  const pushStatus = useUiStore((s) => s.pushStatus);

  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const api = apiRef.current;
    if (!api) return;
    const layout: StoredLayout = {
      version: LAYOUT_VERSION,
      preset: presetRef.current,
      dockview: api.toJSON() as unknown as StoredLayout['dockview'],
    };
    call('layout:save', layout).catch(() => undefined); // failure already logged by call()
  }, []);

  const scheduleSave = useCallback(() => {
    if (!apiRef.current) return; // detached (editor closing): ignore teardown layout events
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }, [saveNow]);

  const applyPreset = useCallback(
    (next: PresetId) => {
      const api = apiRef.current;
      if (!api) return;
      presetRef.current = next;
      setPreset(next);
      buildPreset(api, next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const resetLayout = useCallback(() => {
    applyPreset(DEFAULT_PRESET);
    pushStatus(`Layout reset to ${PRESET_LABELS[DEFAULT_PRESET]}`, 'info');
  }, [applyPreset, pushStatus]);

  const togglePanel = useCallback((id: PanelId) => {
    if (apiRef.current) toggle(apiRef.current, id);
  }, []);
  const showPanel = useCallback((id: PanelId) => {
    if (apiRef.current) show(apiRef.current, id);
  }, []);

  const attach = useCallback(
    (api: DockviewApi) => {
      apiRef.current = api;
      api.onDidLayoutChange(scheduleSave);
      void call('layout:load')
        .catch(() => null)
        .then((stored) => {
          if (stored && isRestorable(stored, devMode)) {
            try {
              api.fromJSON(stored.dockview as unknown as SerializedDockview);
              presetRef.current = stored.preset;
              setPreset(stored.preset);
              logger.info('restored layout, preset =', stored.preset);
              return;
            } catch (err) {
              reportError('stored layout could not be applied; using default', err);
            }
          } else if (stored) {
            logger.warn('stored layout references unknown panels; using default');
          }
          buildPreset(api, presetRef.current);
        })
        .finally(() => setReady(true));
    },
    [devMode, scheduleSave],
  );

  // Native menu → shell commands.
  useEffect(() => {
    const offReset = window.forge.on('menu:resetLayout', resetLayout);
    const offPreset = window.forge.on('menu:applyPreset', ({ preset: p }) => {
      const parsed = PresetIdSchema.safeParse(p);
      if (parsed.success) applyPreset(parsed.data);
    });
    return () => {
      offReset();
      offPreset();
    };
  }, [applyPreset, resetLayout]);

  // App-wide keys that aren't menu items (Settings → Keymap): layouts, views, export, configurations, help.
  useEffect(() => {
    const layouts: [KeymapId, PresetId][] = [
      ['layout1', 'modelling'],
      ['layout2', 'materials'],
      ['layout3', 'jbeam' as PresetId],
      ['layout4', 'moving' as PresetId],
      ['layout5', 'triggers' as PresetId],
      ['layout6', 'scripts'],
      ['layout7', 'testing'],
    ];
    const onKey = (e: KeyboardEvent) => {
      if (inField(e) || e.defaultPrevented) return;
      const layout = layouts.find(([id]) => isKey(e, id));
      let handled = true;
      if (layout && PresetIdSchema.safeParse(layout[1]).success) applyPreset(layout[1]);
      else if (isKey(e, 'viewMesh')) useUiStore.getState().toggleView('mesh');
      else if (isKey(e, 'viewStructure')) useUiStore.getState().toggleView('structure');
      else if (isKey(e, 'viewXray')) useUiStore.getState().toggleView('xray');
      else if (isKey(e, 'export')) void openExport();
      else if (isKey(e, 'configs')) useDialogStore.getState().setConfigsOpen(true);
      else if (isKey(e, 'help')) useDialogStore.getState().setHelpOpen(true);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyPreset]);

  // Flush a pending save when the window closes.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current !== undefined) saveNow();
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      // Editor closing (project closed): flush while dockview is still alive, then detach so
      // layout events fired during teardown can't schedule a save of a half-disposed layout.
      try {
        flush();
      } catch {
        /* dockview already disposed; the last completed save stands */
      }
      apiRef.current = null;
    };
  }, [saveNow]);

  // run-desktop harness hooks for the dock shell (app-level hooks live in App.tsx).
  useEffect(
    () =>
      registerTestHooks({
        crashPanel: (panelId: string) => emitTestSignal({ type: 'crash-panel', panelId }),
        loseGlContext: () => emitTestSignal({ type: 'gl-lose' }),
        restoreGlContext: () => emitTestSignal({ type: 'gl-restore' }),
        injectFrameErrors: (count: number) => emitTestSignal({ type: 'gl-frame-errors', count }),
        applyPreset: (p: PresetId) => applyPreset(p),
        resetLayout,
        togglePanel: (id: PanelId) => togglePanel(id),
        maximizePanel: (id: PanelId) => apiRef.current?.getPanel(id)?.api.maximize(),
        exitMaximized: () => apiRef.current?.exitMaximizedGroup(),
        openPanels: () => apiRef.current?.panels.map((p) => p.id) ?? [],
        preset: () => presetRef.current,
        flushLayout: () => saveNow(),
        spawnSmokeWorker: () => runSmokeWorker(),
      }),
    [applyPreset, resetLayout, togglePanel, saveNow],
  );

  const value = useMemo<ShellApi>(
    () => ({ ready, preset, devMode, attach, applyPreset, resetLayout, togglePanel, showPanel }),
    [ready, preset, devMode, attach, applyPreset, resetLayout, togglePanel, showPanel],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
