import { useEffect } from 'react';
import { TooltipProvider } from '@renderer/ui/components/Tooltip';
import { useSettingsSync } from './stores/settings';
import { useUiStore } from './stores/ui';
import { DockShell } from '@renderer/shell/DockShell';
import { ShellProvider, useShell } from '@renderer/shell/ShellContext';
import { StatusBar } from '@renderer/shell/StatusBar';
import { Toolbar } from '@renderer/shell/Toolbar';
import styles from './App.module.css';

/** App-lifetime subscriptions to the main process. */
function AppEffects() {
  useSettingsSync();
  const pushStatus = useUiStore((s) => s.pushStatus);
  useEffect(() => window.forge.on('status:message', ({ text, tone }) => pushStatus(text, tone, 8000)), [pushStatus]);
  return null;
}

function Chrome() {
  const { ready } = useShell();
  return (
    <div className={styles.app} data-testid={ready ? 'app-ready' : 'app-loading'}>
      <Toolbar />
      <DockShell />
      <StatusBar />
    </div>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <ShellProvider>
        <AppEffects />
        <Chrome />
      </ShellProvider>
    </TooltipProvider>
  );
}
