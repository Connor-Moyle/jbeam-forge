import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@renderer/ui/tokens.css';
import '@renderer/ui/base.css';
import { App } from '@renderer/app/App';
import { RootErrorBoundary } from '@renderer/diagnostics/ErrorBoundary';
import { installGlobalHandlers } from '@renderer/diagnostics/globalHandlers';
import { configureRendererLogging } from '@renderer/diagnostics/logger';
import { createGameForge, type GameBridge } from './platform';
import { runSelftest } from './selftest';

/**
 * JBeam Forge inside BeamNG.drive: the desktop app's screens, mounted into the game's own UI by
 * ui/ui-vue/mods/jbeamForge/JBeamForge.vue, with the game answering for Electron.
 * Returns how to take it down again (F10, or leaving the screen).
 */
export function mountForge(host: HTMLElement, bridge: GameBridge): () => void {
  const forge = createGameForge(bridge);
  Object.defineProperty(window, 'forge', { value: forge, configurable: true, writable: false });
  configureRendererLogging(false);
  installGlobalHandlers();
  host.classList.add('jbeam-forge-root');
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </StrictMode>,
  );
  // Tell the game the screen is up (its self-test reads this; otherwise it's ignored).
  void bridge.call('selftest:report', { mounted: true, userAgent: navigator.userAgent, size: [window.innerWidth, window.innerHeight] }).catch(() => undefined);
  setTimeout(() => void runSelftest(bridge).catch(() => undefined), 1500);
  return () => {
    root.unmount();
    host.classList.remove('jbeam-forge-root');
  };
}
