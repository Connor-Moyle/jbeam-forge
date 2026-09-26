import { DockviewReact, type DockviewTheme } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useShell } from './ShellContext';
import { DOCK_COMPONENTS } from './PanelFrame';
import './DockShell.css';

const FORGE_THEME: DockviewTheme = {
  name: 'forge',
  className: 'dockview-theme-forge',
  colorScheme: 'dark',
};

export function DockShell() {
  const { attach } = useShell();
  return (
    <div className="forge-dock" data-testid="dock">
      <DockviewReact theme={FORGE_THEME} components={DOCK_COMPONENTS} onReady={(e) => attach(e.api)} />
    </div>
  );
}
