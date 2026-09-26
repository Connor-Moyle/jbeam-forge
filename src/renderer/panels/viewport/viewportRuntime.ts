import {
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { BEAMNG_TO_VIEW_ROTATION_X } from '@shared/coords';
import { resolveToken } from '@renderer/ui/tokens';
import { rlog } from '@renderer/diagnostics/logger';
import { onTestSignal } from '@renderer/app/testBus';
import type { ImportedMesh } from '@renderer/import/normalize';
import type { GpuTextureCaps } from '@renderer/import/textures';
import { GuardedLoop } from './guardedLoop';
import { registerViewport } from './registry';

// three-mesh-bvh: BVH-accelerated raycasting for all point-picking (SPEC §2).
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export type GlState = 'starting' | 'running' | 'lost' | 'unsupported';

const MAX_CONSECUTIVE_FRAME_ERRORS = 3;
const GRID_SIZE_M = 20;
const GRID_DIVISIONS = 20;
const FRAME_PADDING = 1.25;
const CLICK_MAX_DRAG_PX = 4;

const logger = rlog('viewport');

export interface ViewState {
  meshes: readonly ImportedMesh[];
  hidden: Readonly<Record<string, true>>;
  selection: readonly string[];
  hover: string | null;
}

export interface ViewportCallbacks {
  onState: (s: GlState) => void;
  onFatal: (e: Error) => void;
  onHover: (meshKey: string | null) => void;
  onPick: (meshKey: string | null, mods: { shift: boolean; ctrl: boolean }) => void;
  onDoublePick: (meshKey: string | null) => void;
}

/**
 * Owns the three.js renderer for one viewport panel: guarded render loop,
 * resize, WebGL context-loss recovery, orbit camera, BVH picking and
 * selection/hover highlight. Imported meshes are shown in BeamNG space under
 * one root rotated into three's Y-up world (the only such conversion, via
 * src/shared/coords.ts). Mesh geometry/materials belong to the scene store and
 * are never disposed here.
 */
export class ViewportRuntime {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.05, 2000);
  private readonly controls: OrbitControls;
  private readonly modelRoot = new Group();
  private readonly overlayRoot = new Group();
  private readonly owned: Object3D[] = [];
  private readonly loop: GuardedLoop;
  private readonly resizeObserver: ResizeObserver;
  private readonly disposers: (() => void)[] = [];
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly meshObjects = new Map<string, Mesh>();
  private readonly overlays = new Map<string, Mesh>();
  private readonly selectMaterial: MeshBasicMaterial;
  private readonly hoverMaterial: MeshBasicMaterial;
  private view: ViewState = { meshes: [], hidden: {}, selection: [], hover: null };
  private pendingHover: { x: number; y: number } | null = null;
  private injectedFrameErrors = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    host: HTMLElement,
    private readonly callbacks: ViewportCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.raycaster.firstHitOnly = true;

    this.scene.background = new Color(resolveToken('bg-0'));
    const grid = new GridHelper(GRID_SIZE_M, GRID_DIVISIONS, new Color(resolveToken('grid-major')), new Color(resolveToken('grid-minor')));
    const hemi = new HemisphereLight(new Color(resolveToken('viewport-sky')), new Color(resolveToken('viewport-ground')), 2.2);
    const key = new DirectionalLight(new Color(resolveToken('viewport-key')), 2.4);
    key.position.set(4, 8, 6);
    const fill = new DirectionalLight(new Color(resolveToken('viewport-key')), 0.8);
    fill.position.set(-6, 3, -4);
    this.owned.push(grid, hemi, key, fill);
    this.scene.add(grid, hemi, key, fill, this.modelRoot, this.overlayRoot);
    // BeamNG space (Z up) → view space (Y up). Overlays share the same frame.
    this.modelRoot.rotation.x = BEAMNG_TO_VIEW_ROTATION_X;
    this.overlayRoot.rotation.x = BEAMNG_TO_VIEW_ROTATION_X;

    const accent = new Color(resolveToken('accent') || undefined);
    this.selectMaterial = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.hoverMaterial = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

    this.camera.position.set(5, 3, 7);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0.6, 0);
    this.controls.update();

    this.loop = new GuardedLoop(() => this.tick(), {
      maxConsecutiveErrors: MAX_CONSECUTIVE_FRAME_ERRORS,
      onFrameError: (err, n) => logger.warn(`frame error ${n}/${MAX_CONSECUTIVE_FRAME_ERRORS}:`, err instanceof Error ? err.message : String(err)),
      onFatal: (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('render loop stopped after repeated frame errors:', error.message);
        callbacks.onFatal(error);
      },
    });

    this.listen(canvas, 'webglcontextlost', (e) => {
      e.preventDefault(); // required for the browser to attempt a restore
      logger.warn('WebGL context lost; pausing render loop');
      this.loop.stop();
      callbacks.onState('lost');
    });
    this.listen(canvas, 'webglcontextrestored', () => {
      logger.info('WebGL context restored; resuming');
      this.loop.start();
      callbacks.onState('running');
    });
    this.installPointer(canvas);

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
    this.disposers.push(registerViewport({ capture: (w, h) => this.capture(w, h), textureCaps: () => this.textureCaps() }));

    this.loop.start();
    callbacks.onState('running');
  }

  private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void;
  private listen(el: HTMLElement, type: string, fn: (e: Event) => void): void;
  private listen(el: HTMLElement, type: string, fn: (e: Event) => void): void {
    el.addEventListener(type, fn);
    this.disposers.push(() => el.removeEventListener(type, fn));
  }

  private installPointer(canvas: HTMLCanvasElement): void {
    let down: { x: number; y: number } | null = null;
    this.listen(canvas, 'pointermove', (e) => {
      this.pendingHover = { x: e.clientX, y: e.clientY }; // raycast once per frame, not per event
    });
    this.listen(canvas, 'pointerleave', () => {
      this.pendingHover = null;
      this.callbacks.onHover(null);
    });
    this.listen(canvas, 'pointerdown', (e) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    });
    this.listen(canvas, 'pointerup', (e) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > CLICK_MAX_DRAG_PX) return; // an orbit drag, not a click
      this.callbacks.onPick(this.pick(e.clientX, e.clientY), { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    });
    this.listen(canvas, 'dblclick', (e) => this.callbacks.onDoublePick(this.pick(e.clientX, e.clientY)));
  }

  /** Mesh key under the given client point, or null. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const candidates: Mesh[] = [];
    for (const mesh of this.meshObjects.values()) {
      if (!mesh.visible) continue;
      const g = mesh.geometry;
      // Build each BVH lazily, only for meshes the ray can actually reach.
      if (!g.boundingSphere) g.computeBoundingSphere();
      const sphere = new Sphere().copy(g.boundingSphere!).applyMatrix4(mesh.matrixWorld);
      if (!this.raycaster.ray.intersectsSphere(sphere)) continue;
      if (!g.boundsTree) g.computeBoundsTree();
      candidates.push(mesh);
    }
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    return (hit?.object.userData.meshKey as string | undefined) ?? null;
  }

  /** Apply the scene store's state (diffed; geometry is shared, not copied). */
  sync(next: ViewState): void {
    const prev = this.view;
    this.view = next;
    if (next.meshes !== prev.meshes) {
      const wanted = new Set(next.meshes.map((m) => m.key));
      for (const [key, obj] of this.meshObjects) {
        if (!wanted.has(key) || obj.geometry !== next.meshes.find((m) => m.key === key)?.geometry) {
          this.modelRoot.remove(obj);
          this.meshObjects.delete(key);
        }
      }
      for (const m of next.meshes) {
        if (this.meshObjects.has(m.key)) continue;
        const obj = new Mesh(m.geometry, m.material);
        obj.name = m.name;
        obj.userData.meshKey = m.key;
        this.meshObjects.set(m.key, obj);
        this.modelRoot.add(obj);
      }
    }
    for (const [key, obj] of this.meshObjects) obj.visible = !next.hidden[key];
    this.syncOverlays();
  }

  private syncOverlays(): void {
    const { selection, hover } = this.view;
    const want = new Map<string, MeshBasicMaterial>();
    for (const k of selection) want.set(k, this.selectMaterial);
    if (hover && !want.has(hover)) want.set(hover, this.hoverMaterial);
    for (const [key, o] of this.overlays) {
      const src = this.meshObjects.get(key);
      if (!want.has(key) || !src || o.geometry !== src.geometry) {
        this.overlayRoot.remove(o);
        this.overlays.delete(key);
      }
    }
    for (const [key, mat] of want) {
      const src = this.meshObjects.get(key);
      if (!src) continue;
      let o = this.overlays.get(key);
      if (!o) {
        o = new Mesh(src.geometry, mat);
        o.renderOrder = 1;
        this.overlays.set(key, o);
        this.overlayRoot.add(o);
      }
      o.material = mat;
      o.visible = src.visible;
    }
  }

  /** Frame the given meshes (all visible meshes when empty). */
  frame(keys: readonly string[] = []): void {
    const box = new Box3();
    const targets = keys.length ? keys.map((k) => this.meshObjects.get(k)).filter((m): m is Mesh => !!m) : [...this.meshObjects.values()].filter((m) => m.visible);
    this.modelRoot.updateMatrixWorld(true);
    for (const m of targets) box.expandByObject(m);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = Math.max(0.5, (sphere.radius * FRAME_PADDING) / Math.sin(fov / 2));
    const dir = new Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    if (dir.lengthSq() === 0) dir.set(0.6, 0.35, 0.72).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    this.camera.near = Math.max(0.01, distance / 200);
    this.camera.far = distance * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  textureCaps(): GpuTextureCaps {
    const ext = this.renderer.extensions;
    const s3tc = ext.has('WEBGL_compressed_texture_s3tc');
    const rgtc = ext.has('EXT_texture_compression_rgtc');
    return { bc1: s3tc, bc2: s3tc, bc3: s3tc, bc4: rgtc, bc5: rgtc, bc7: ext.has('EXT_texture_compression_bptc') };
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

  private frameTick(): void {
    if (this.pendingHover) {
      const { x, y } = this.pendingHover;
      this.pendingHover = null;
      this.callbacks.onHover(this.pick(x, y));
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private tick(): void {
    if (this.injectedFrameErrors > 0) {
      this.injectedFrameErrors--;
      throw new Error('[harness-triggered] injected frame error');
    }
    this.frameTick();
  }

  dispose(): void {
    this.loop.stop();
    this.resizeObserver.disconnect();
    for (const d of this.disposers) d();
    this.controls.dispose();
    // Only what this viewport created: imported geometry/materials belong to the scene store
    // (the viewport remounts on every layout change while the meshes live on).
    for (const o of this.owned) {
      o.traverse((obj) => {
        const x = obj as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        x.geometry?.dispose();
        x.material?.dispose();
      });
    }
    this.selectMaterial.dispose();
    this.hoverMaterial.dispose();
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
