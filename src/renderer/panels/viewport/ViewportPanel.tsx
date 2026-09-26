import { useEffect, useRef, useState } from 'react';
import { FileInput, MonitorX } from 'lucide-react';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { iconSize } from '@renderer/ui/tokens';
import { reportError } from '@renderer/diagnostics/globalHandlers';
import { allMeshes, useSceneStore } from '@renderer/app/stores/scene';
import { startImport } from '@renderer/import/importFlow';
import type { ImportedMesh } from '@renderer/import/normalize';
import { ViewportRuntime, webglAvailable, type GlState, type ViewState } from './viewportRuntime';
import styles from './ViewportPanel.module.css';

export function ViewportPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [glState, setGlState] = useState<GlState>(() => (webglAvailable() ? 'starting' : 'unsupported'));
  const [fatal, setFatal] = useState<Error | null>(null);
  const hasMeshes = useSceneStore((s) => Object.values(s.sources).some((src) => src.meshes.length > 0));

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host || glState === 'unsupported') return;
    let runtime: ViewportRuntime | null = null;
    const scene = useSceneStore;
    try {
      runtime = new ViewportRuntime(canvas, host, {
        onState: setGlState,
        onFatal: setFatal,
        onHover: (key) => scene.getState().setHover(key),
        onPick: (key, mods) => {
          if (!key) {
            if (!mods.shift && !mods.ctrl) scene.getState().select([]);
            return;
          }
          scene.getState().select([key], mods.ctrl ? 'toggle' : mods.shift ? 'add' : 'replace');
        },
        onDoublePick: (key) => runtime?.frame(key ? [key] : []),
      });
    } catch (err) {
      reportError('viewport init failed', err);
      // One-shot fallback when WebGL init throws; cannot cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGlState('unsupported');
      return;
    }
    const rt = runtime;

    // Scene store → runtime, outside React rendering (hundreds of meshes, per-frame hover).
    let meshesSource: unknown = null;
    let meshes: ImportedMesh[] = [];
    const push = () => {
      const s = scene.getState();
      if (s.sources !== meshesSource) {
        meshesSource = s.sources;
        meshes = allMeshes(s.sources);
      }
      const view: ViewState = { meshes, hidden: s.hidden, selection: s.selection, hover: s.hover };
      rt.sync(view);
    };
    push();
    if (meshes.length) rt.frame();
    let lastFrameRequest = scene.getState().frameRequest;
    const unsubscribe = scene.subscribe((s) => {
      push();
      if (s.frameRequest !== lastFrameRequest) {
        lastFrameRequest = s.frameRequest;
        rt.frame(s.frameRequest.keys);
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'f' || e.key === 'F') rt.frame(scene.getState().selection);
      else if (e.key === 'Home') rt.frame();
      else return;
      e.preventDefault();
    };
    host.addEventListener('keydown', onKey);

    return () => {
      unsubscribe();
      host.removeEventListener('keydown', onKey);
      rt.dispose();
    };
    // Runtime is created once per mount; state changes must not recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand repeated frame failures to the panel's error boundary.
  if (fatal) throw fatal;

  if (glState === 'unsupported') {
    return <EmptyState icon={MonitorX} message="WebGL 2 is unavailable, so the 3D viewport cannot start. Update your graphics driver, then use Help → Copy Diagnostic Info if it persists." />;
  }

  return (
    <div ref={hostRef} className={styles.host} data-testid="viewport" data-gl-state={glState} tabIndex={0}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {glState === 'lost' && (
        <div className={styles.pill} role="status">
          <MonitorX size={iconSize('size-icon-sm')} aria-hidden />
          Graphics context lost — recovering…
        </div>
      )}
      {!hasMeshes && glState !== 'lost' && (
        <button type="button" className={styles.pill} onClick={() => void startImport()} data-testid="viewport-import">
          <FileInput size={iconSize('size-icon-sm')} aria-hidden />
          Import a model to begin
        </button>
      )}
    </div>
  );
}
