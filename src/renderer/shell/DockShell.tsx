import type { FunctionComponent } from 'react';
import { DockviewReact, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useShell } from './ShellContext';
import { PanelFrame } from './PanelFrame';
import { PANELS, type PanelId } from './panelRegistry';
import './DockShell.css';

/** Stable dockview component map: one wrapper per registered panel. */
const DOCK_COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = Object.fromEntries(
  (Object.keys(PANELS) as PanelId[]).map((id) => {
    const Wrapped = () => <PanelFrame id={id} />;
    Wrapped.displayName = `Panel(${id})`;
    return [id, Wrapped];
  }),
);

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
