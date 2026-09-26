import { useEffect } from 'react';
import { TooltipProvider } from '@renderer/ui/components/Tooltip';
import { DockShell } from '@renderer/shell/DockShell';
import { ShellProvider, useShell } from '@renderer/shell/ShellContext';
import { StatusBar } from '@renderer/shell/StatusBar';
import { Toolbar } from '@renderer/shell/Toolbar';
import { HomeScreen } from '@renderer/home/HomeScreen';
import { DialogHost } from '@renderer/project/DialogHost';
import { runAppCommand } from '@renderer/project/appCommands';
import { call } from '@renderer/diagnostics/ipc';
import { useSettingsSync } from './stores/settings';
import { useUiStore } from './stores/ui';
import { isDirty, projectStore, useProjectStore } from './stores/project';
import styles from './App.module.css';

/** App-lifetime subscriptions to the main process and the project store. */
function AppEffects() {
  useSettingsSync();
  const pushStatus = useUiStore((s) => s.pushStatus);

  useEffect(() => window.forge.on('status:message', ({ text, tone }) => pushStatus(text, tone, 8000)), [pushStatus]);
  useEffect(() => window.forge.on('menu:command', ({ command }) => runAppCommand(command)), []);

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
    </TooltipProvider>
  );
}
