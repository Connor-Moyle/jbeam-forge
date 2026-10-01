import { useEffect, useState, type ComponentType } from 'react';
import { PanelErrorBoundary } from '@renderer/diagnostics/ErrorBoundary';
import { HARNESS_CRASH_MARKER, onTestSignal } from '@renderer/app/testBus';
import { useShell } from './ShellContext';
import { PANELS, type PanelId } from './panelRegistry';
import styles from './PanelFrame.module.css';

/** Throws on demand so the harness can prove per-panel isolation. */
function CrashProbe({ panelId }: { panelId: string }) {
  const [crash, setCrash] = useState(false);
  useEffect(
    () =>
      onTestSignal((s) => {
        if (s.type === 'crash-panel' && s.panelId === panelId) setCrash(true);
      }),
    [panelId],
  );
  if (crash) throw new Error(`${HARNESS_CRASH_MARKER} deliberate crash in panel "${panelId}"`);
  return null;
}

/** A panel's content with its own error boundary, so one panel failing leaves the rest working. */
export function PanelFrame({ id }: { id: PanelId }) {
  const { resetLayout, devMode } = useShell();
  const def = PANELS[id];
  const Content: ComponentType = def.component;
  return (
    <div className={styles.frame} data-panel={id}>
      <PanelErrorBoundary panelId={id} title={def.title} onResetLayout={resetLayout}>
        {devMode && <CrashProbe panelId={id} />}
        <Content />
      </PanelErrorBoundary>
    </div>
  );
}
