import { useEffect } from 'react';
import { TooltipProvider } from '@renderer/ui/components/Tooltip';
import { DockShell } from '@renderer/shell/DockShell';
import { ShellProvider, useShell } from '@renderer/shell/ShellContext';
import { StatusBar } from '@renderer/shell/StatusBar';
import { Toolbar } from '@renderer/shell/Toolbar';
import { HomeScreen } from '@renderer/home/HomeScreen';
import { DialogHost } from '@renderer/project/DialogHost';
import { ImportHost } from '@renderer/import/ImportHost';
import { useSourceSync } from '@renderer/import/importFlow';
import { runAppCommand } from '@renderer/project/appCommands';
import { call } from '@renderer/diagnostics/ipc';
import { useSettingsSync } from './stores/settings';
import { useUiStore } from './stores/ui';
import { isDirty, projectStore, useProjectStore } from './stores/project';
import { useSceneStore } from './stores/scene';
import { registerTestHooks } from './testHooks';
import { loadUserTaxonomy } from '@renderer/parts/taxonomy';
import { offerAutoClassify } from '@renderer/parts/commands';
import type { AppCommand } from '@shared/ipc-contract';
import styles from './App.module.css';

/** App-lifetime subscriptions to the main process and the project store. */
function AppEffects() {
  useSettingsSync();
  const pushStatus = useUiStore((s) => s.pushStatus);

  useEffect(() => window.forge.on('status:message', ({ text, tone }) => pushStatus(text, tone, 8000)), [pushStatus]);
  useEffect(() => window.forge.on('menu:command', ({ command }) => runAppCommand(command)), []);
  useEffect(() => void loadUserTaxonomy(), []);

  // run-desktop harness hooks available on every screen (home and editor).
  useEffect(
    () =>
      registerTestHooks({
        renameProject: (name: string) => projectStore.getState().execute({ label: 'Rename project', apply: (d) => void (d.meta.name = name) }),
        projectState: () => {
          const s = projectStore.getState();
          return { name: s.doc?.meta.name ?? null, dirty: isDirty(s), filePath: s.filePath, undo: s.undoStack.length, redo: s.redoStack.length };
        },
        runCommand: (command: AppCommand) => runAppCommand(command),
        queueDialog: (answers: (string | null)[]) => call('harness:queueDialog', { answers }),
        partsState: () => {
          const d = projectStore.getState().doc;
          return {
            parts: (d?.parts ?? []).map((p) => ({ id: p.id, taxonomyId: p.taxonomyId, name: p.name, displayName: p.displayName, position: p.position, parentPartId: p.parentPartId, variantOf: p.variantOf })),
            assigned: Object.keys(d?.assignments ?? {}).length,
            ignored: d?.ignoredMeshes.length ?? 0,
            activePart: useSceneStore.getState().activePart,
          };
        },
        offerAutoClassify: () => {
          const meshes = Object.values(useSceneStore.getState().sources).flatMap((s) => s.meshes);
          offerAutoClassify('harness', meshes);
        },
        sceneStats: () => {
          const s = useSceneStore.getState();
          const sources = Object.values(s.sources);
          return {
            sources: sources.map((src) => ({ status: src.status, fileName: src.fileName, meshes: src.meshes.length, error: src.error, textures: src.textures, stats: src.stats })),
            meshes: sources.reduce((n, src) => n + src.meshes.length, 0),
            selection: s.selection,
          };
        },
        measureFps: (ms: number) =>
          new Promise<number>((resolve) => {
            let frames = 0;
            const start = performance.now();
            const tick = () => {
              frames++;
              if (performance.now() - start < ms) requestAnimationFrame(tick);
              else resolve((frames * 1000) / (performance.now() - start));
            };
            requestAnimationFrame(tick);
          }),
      }),
    [],
  );

  // Window title + unsaved-changes flag for main's close guard.
  useEffect(() => {
    let lastDirty: boolean | null = null;
    const sync = () => {
      const s = projectStore.getState();
      const dirty = isDirty(s);
      document.title = s.doc ? `${s.doc.meta.name}${dirty ? ' •' : ''} — JBeam Forge` : 'JBeam Forge';
      if (dirty !== lastDirty) {
        lastDirty = dirty;
        call('window:setDirty', { dirty }).catch(() => undefined);
      }
    };
    sync();
    return projectStore.subscribe(sync);
  }, []);

  return null;
}

function Editor() {
  const { ready } = useShell();
  useSourceSync();
  return (
    <div className={styles.app} data-testid={ready ? 'app-ready' : 'app-loading'} data-view="editor">
      <Toolbar />
      <DockShell />
      <StatusBar />
    </div>
  );
}

function Root() {
  const hasProject = useProjectStore((s) => s.doc !== null);
  if (!hasProject) return <HomeScreen />;
  return (
    <ShellProvider>
      <Editor />
    </ShellProvider>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <AppEffects />
      <Root />
      <DialogHost />
      <ImportHost />
    </TooltipProvider>
  );
}
