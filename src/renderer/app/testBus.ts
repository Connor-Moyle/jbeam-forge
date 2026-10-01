/**
 * In-process signal bus for run-desktop harness hooks (crash a panel, drop
 * the WebGL context, …). Only wired to `window.__jbforgeTest` when the app
 * runs under the harness or in dev; production builds never expose it.
 */
export type TestSignal =
  | { type: 'crash-panel'; panelId: string }
  | { type: 'gl-lose' }
  | { type: 'gl-restore' }
  | { type: 'gl-frame-errors'; count: number }
  /** Point the camera from this direction (view space, Y up) and frame everything. */
  | { type: 'view-from'; dir: [number, number, number]; only?: string }
  /** Draw a reference structure (e.g. an official vehicle's nodes/beams) for visual comparison; null clears. */
  | { type: 'reference-structure'; nodes: { id: string; pos: [number, number, number] }[] | null; beams: [string, string][] };

type Listener = (signal: TestSignal) => void;
const listeners = new Set<Listener>();

export function emitTestSignal(signal: TestSignal): void {
  for (const l of listeners) l(signal);
}

export function onTestSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Error message marker the harness uses to tell deliberate crashes from real ones. */
export const HARNESS_CRASH_MARKER = '[harness-triggered]';
