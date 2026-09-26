import { TooltipProvider } from '@renderer/ui/components/Tooltip';
import { DockShell } from '@renderer/shell/DockShell';
import { ShellProvider, useShell } from '@renderer/shell/ShellContext';
import { StatusBar } from '@renderer/shell/StatusBar';
import { Toolbar } from '@renderer/shell/Toolbar';
import styles from './App.module.css';

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
        <Chrome />
      </ShellProvider>
    </TooltipProvider>
  );
}
