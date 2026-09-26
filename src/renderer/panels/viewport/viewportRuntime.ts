import { Color, GridHelper, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { resolveToken } from '@renderer/ui/tokens';
import { rlog } from '@renderer/diagnostics/logger';
import { onTestSignal } from '@renderer/app/testBus';
import { GuardedLoop } from './guardedLoop';
import { registerViewport } from './registry';

export type GlState = 'starting' | 'running' | 'lost' | 'unsupported';

const MAX_CONSECUTIVE_FRAME_ERRORS = 3;
const GRID_SIZE_M = 20;
const GRID_DIVISIONS = 20;

const logger = rlog('viewport');

/**
 * Owns the three.js renderer for one viewport panel: guarded render loop,
 * resize tracking and WebGL context-loss recovery. Placeholder scene (grid)
 * until the import pipeline lands.
 */
export class ViewportRuntime {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.05, 500);
  private readonly loop: GuardedLoop;
  private readonly resizeObserver: ResizeObserver;
  private readonly disposers: (() => void)[] = [];
  private injectedFrameErrors = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    host: HTMLElement,
    private readonly callbacks: { onState: (s: GlState) => void; onFatal: (e: Error) => void },
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene.background = new Color(resolveToken('bg-0'));
    this.scene.add(new GridHelper(GRID_SIZE_M, GRID_DIVISIONS, new Color(resolveToken('grid-major')), new Color(resolveToken('grid-minor'))));
    this.camera.position.set(6, 4, 8);
    this.camera.lookAt(0, 0, 0);

    this.loop = new GuardedLoop(() => this.frame(), {
      maxConsecutiveErrors: MAX_CONSECUTIVE_FRAME_ERRORS,
      onFrameError: (err, n) => logger.warn(`frame error ${n}/${MAX_CONSECUTIVE_FRAME_ERRORS}:`, err instanceof Error ? err.message : String(err)),
      onFatal: (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('render loop stopped after repeated frame errors:', error.message);
        callbacks.onFatal(error);
      },
    });

    const onLost = (e: Event) => {
      e.preventDefault(); // required for the browser to attempt a restore
      logger.warn('WebGL context lost; pausing render loop');
      this.loop.stop();
      callbacks.onState('lost');
    };
    const onRestored = () => {
      logger.info('WebGL context restored; resuming');
      this.loop.start();
      callbacks.onState('running');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    this.disposers.push(() => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    });

    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    });
    this.resizeObserver.observe(host);

    this.disposers.push(
      onTestSignal((signal) => {
        if (signal.type === 'gl-lose') this.renderer.forceContextLoss();
        else if (signal.type === 'gl-restore') this.renderer.forceContextRestore();
        else if (signal.type === 'gl-frame-errors') this.injectedFrameErrors = signal.count;
      }),
    );

    this.disposers.push(registerViewport({ capture: (w, h) => this.capture(w, h) }));

    this.loop.start();
    callbacks.onState('running');
  }

  /** Render a frame now and copy it, cover-cropped, into a w×h JPEG. */
  capture(width: number, height: number): string | null {
    const src = this.renderer.domElement;
    if (src.width === 0 || src.height === 0) return null;
    this.renderer.render(this.scene, this.camera); // drawing buffer is only valid right after a render
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const scale = Math.max(width / src.width, height / src.height);
    const sw = width / scale;
    const sh = height / scale;
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
    return out.toDataURL('image/jpeg', 0.85);
  }

  private frame(): void {
    if (this.injectedFrameErrors > 0) {
      this.injectedFrameErrors--;
      throw new Error('[harness-triggered] injected frame error');
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.loop.stop();
    this.resizeObserver.disconnect();
    for (const d of this.disposers) d();
    this.scene.traverse((obj) => {
      const o = obj as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.renderer.dispose();
    // Release the GL context now rather than at GC: Chromium caps live contexts
    // (~16) and evicts the oldest, which could be a live viewport's.
    this.renderer.forceContextLoss();
  }
}

let webglProbe: boolean | undefined;

/**
 * True if this environment can create a WebGL2 context at all. Probed once;
 * the probe context is released immediately so it never counts toward
 * Chromium's live-context limit.
 */
export function webglAvailable(): boolean {
  if (webglProbe !== undefined) return webglProbe;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    webglProbe = gl !== null;
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

export { MAX_CONSECUTIVE_FRAME_ERRORS };
