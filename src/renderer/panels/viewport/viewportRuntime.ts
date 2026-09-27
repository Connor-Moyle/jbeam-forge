import {
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  DoubleSide,
  HemisphereLight,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
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
import { subsetGeometry } from '@renderer/import/applySplits';
import { disposeSharingGeometry } from '@renderer/import/dispose';
import { floodFill, rectPolygon, triangleAdjacency, triangleCentroids, trianglesInPolygon, weldMap } from '@shared/mesh/split';
import { GuardedLoop } from './guardedLoop';
import { LiveOverlay, StructureOverlay, type StructureData } from './structureOverlay';
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

/** Face-selection split tool, as the viewport needs it (see src/renderer/split/splitTool.ts). */
export interface ToolState {
  meshKey: string;
  mode: 'box' | 'lasso' | 'paint' | 'fill' | 'plane';
  selected: readonly number[];
  angleDeg: number;
  radius: number;
  plane: { axis: 'x' | 'y' | 'z'; offset: number; flip: boolean };
}

export type ToolOp = 'replace' | 'add' | 'subtract';

export interface ViewportCallbacks {
  onState: (s: GlState) => void;
  onFatal: (e: Error) => void;
  onHover: (meshKey: string | null) => void;
  onPick: (meshKey: string | null, mods: { shift: boolean; ctrl: boolean }) => void;
  onDoublePick: (meshKey: string | null) => void;
  /** Split tool: triangles picked by a box/lasso/paint/fill gesture. */
  onToolSelect?: (triangles: number[], op: ToolOp) => void;
  /** Split tool: the box/lasso outline being drawn (canvas px, x/y pairs), or null when done. */
  onToolShape?: (points: number[] | null) => void;
  /** Test Mode: a node is being dragged towards `target` (BeamNG space); null = released. */
  onSimDrag?: (node: number | null, target: [number, number, number]) => void;
}

/** What the live physics view needs from a frame. */
export interface LiveView {
  model: { beamA: Uint32Array; beamB: Uint32Array; mass: Float64Array };
  positions: Float32Array;
  stress: Float32Array;
  obstacles?: { kind: 'pole' | 'wall'; x: number; y: number; radius?: number; nx?: number; ny?: number; halfWidth?: number }[];
}

const toolCaches = new WeakMap<BufferGeometry, { adjacency?: ReturnType<typeof triangleAdjacency>; centroids?: Float32Array }>();

function geometryArrays(g: BufferGeometry): { positions: ArrayLike<number>; index: ArrayLike<number> } {
  const positions = g.getAttribute('position').array;
  if (g.index) return { positions, index: g.index.array };
  const n = g.getAttribute('position').count;
  const index = new Uint32Array(n - (n % 3));
  for (let i = 0; i < index.length; i++) index[i] = i;
  return { positions, index };
}

function toolCache(g: BufferGeometry) {
  let c = toolCaches.get(g);
  if (!c) {
    c = {};
    toolCaches.set(g, c);
  }
  return c;
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
  private tool: ToolState | null = null;
  private toolOverlay: Mesh | null = null;
  private toolOverlayFor: { geometry: BufferGeometry; selected: readonly number[] } | null = null;
  private readonly toolMaterial: MeshBasicMaterial;
  private readonly planeMaterial: MeshBasicMaterial;
  private planeMesh: Mesh | null = null;
  private pendingPaint: { x: number; y: number; op: ToolOp } | null = null;
  private readonly structure = new StructureOverlay();
  private readonly reference = new StructureOverlay();
  private readonly live = new LiveOverlay();
  private liveView: LiveView | null = null;
  private liveFramedFor: unknown = null;
  private viewToggles = { mesh: true, structure: true };
  private simDrag: { node: number; depth: number } | null = null;
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
    this.structure.root.rotation.x = BEAMNG_TO_VIEW_ROTATION_X;
    this.reference.root.rotation.x = BEAMNG_TO_VIEW_ROTATION_X;
    this.live.root.rotation.x = BEAMNG_TO_VIEW_ROTATION_X;
    this.scene.add(this.structure.root, this.reference.root, this.live.root);

    const accent = new Color(resolveToken('accent') || undefined);
    this.selectMaterial = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.toolMaterial = new MeshBasicMaterial({ color: new Color(resolveToken('warning') || undefined), transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.planeMaterial = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide });
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
        else if (signal.type === 'reference-structure') this.setReference(signal.nodes, signal.beams);
        else if (signal.type === 'view-from') {
          this.camera.position.copy(this.controls.target).add(new Vector3(...signal.dir));
          this.frame();
        }
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
    let drag: { mode: 'box' | 'lasso' | 'paint'; op: ToolOp; points: number[] } | null = null;
    const local = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const opOf = (e: PointerEvent | MouseEvent): ToolOp => (e.ctrlKey || e.metaKey ? 'subtract' : e.shiftKey ? 'add' : 'replace');

    // Test Mode: grab the nearest node with the left button and pull it around.
    this.listen(canvas, 'pointerdown', (e) => {
      const view = this.liveView;
      if (!view || e.button !== 0 || this.tool) return;
      this.live.root.updateMatrixWorld(true);
      const [x, y] = local(e);
      const node = this.live.pickNode((a, b, c) => this.projectLive(a, b, c), view.positions, x, y);
      if (node === null) return;
      const p = view.positions;
      const depth = new Vector3(p[node * 3], p[node * 3 + 1], p[node * 3 + 2]).applyMatrix4(this.live.root.matrixWorld).project(this.camera).z;
      this.simDrag = { node, depth };
      this.controls.enabled = false;
      canvas.setPointerCapture?.(e.pointerId);
      this.callbacks.onSimDrag?.(node, this.dragTarget(e.clientX, e.clientY, depth));
    });
    this.listen(canvas, 'pointermove', (e) => {
      if (this.simDrag) this.callbacks.onSimDrag?.(this.simDrag.node, this.dragTarget(e.clientX, e.clientY, this.simDrag.depth));
    });
    this.listen(canvas, 'pointerup', () => {
      if (!this.simDrag) return;
      this.simDrag = null;
      this.controls.enabled = true;
      this.callbacks.onSimDrag?.(null, [0, 0, 0]);
    });

    // Split tool gestures take the left button (orbit moves to the right button meanwhile).
    this.listen(canvas, 'pointerdown', (e) => {
      const t = this.tool;
      if (!t || e.button !== 0 || (t.mode !== 'box' && t.mode !== 'lasso' && t.mode !== 'paint')) return;
      const [x, y] = local(e);
      drag = { mode: t.mode, op: t.mode === 'paint' ? (e.ctrlKey || e.metaKey ? 'subtract' : 'add') : opOf(e), points: [x, y] };
      canvas.setPointerCapture?.(e.pointerId);
      if (t.mode === 'paint') this.pendingPaint = { x: e.clientX, y: e.clientY, op: drag.op };
    });
    this.listen(canvas, 'pointermove', (e) => {
      if (drag) {
        const [x, y] = local(e);
        if (drag.mode === 'box') {
          drag.points = [drag.points[0]!, drag.points[1]!, x, y];
          this.callbacks.onToolShape?.(rectPolygon(drag.points[0]!, drag.points[1]!, x, y));
        } else if (drag.mode === 'lasso') {
          const n = drag.points.length;
          if (Math.hypot(x - drag.points[n - 2]!, y - drag.points[n - 1]!) > 3) drag.points.push(x, y);
          this.callbacks.onToolShape?.(drag.points);
        } else this.pendingPaint = { x: e.clientX, y: e.clientY, op: drag.op };
        return;
      }
      if (!this.tool) this.pendingHover = { x: e.clientX, y: e.clientY }; // raycast once per frame, not per event
    });
    this.listen(canvas, 'pointerup', (e) => {
      if (!drag || e.button !== 0) return;
      const d = drag;
      drag = null;
      this.callbacks.onToolShape?.(null);
      if (d.mode === 'paint') return;
      const polygon = d.mode === 'box' ? (d.points.length === 4 ? rectPolygon(d.points[0]!, d.points[1]!, d.points[2]!, d.points[3]!) : []) : d.points;
      if (polygon.length >= 6) this.callbacks.onToolSelect?.(this.trianglesInScreenPolygon(polygon), d.op);
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
      if (this.tool) {
        if (this.tool.mode === 'fill') {
          const face = this.pickToolFace(e.clientX, e.clientY);
          if (face !== null) this.callbacks.onToolSelect?.(this.flood([face], { maxAngleDeg: this.tool.angleDeg }), opOf(e));
        }
        return; // clicks never change the mesh selection while splitting
      }
      this.callbacks.onPick(this.pick(e.clientX, e.clientY), { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    });
    this.listen(canvas, 'dblclick', (e) => {
      if (!this.tool) this.callbacks.onDoublePick(this.pick(e.clientX, e.clientY));
    });
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
      // indirect: never reorder the index — stored splits refer to triangle numbers.
      if (!g.boundsTree) g.computeBoundsTree({ indirect: true });
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
    if (this.tool) {
      this.syncToolOverlay();
      this.syncPlane();
    }
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

  // ---------------------------------------------------------------- structure + view toggles

  /** Generated nodes/beams (BeamNG space), or null to clear. */
  setStructure(data: StructureData | null): void {
    let radius = 0.012;
    if (data && data.nodePositions.length) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < data.nodePositions.length; i += 3) {
        lo = Math.min(lo, data.nodePositions[i]!);
        hi = Math.max(hi, data.nodePositions[i]!);
      }
      radius = Math.min(0.03, Math.max(0.006, (hi - lo) * 0.0035)); // scale with vehicle length
    }
    this.structure.set(data, radius);
  }

  /** Harness-only comparison overlay in a neutral colour. */
  private setReference(nodes: { id: string; pos: [number, number, number] }[] | null, beams: [string, string][]): void {
    if (!nodes) {
      this.reference.set(null, 0);
      return;
    }
    const c = new Color(resolveToken('text-0') || undefined);
    const byId = new Map(nodes.map((n) => [n.id, n.pos]));
    const bp: number[] = [];
    for (const [a, b] of beams) {
      const pa = byId.get(a);
      const pb = byId.get(b);
      if (pa && pb) bp.push(...pa, ...pb);
    }
    const data: StructureData = {
      nodePositions: new Float32Array(nodes.flatMap((n) => n.pos)),
      nodeColors: new Float32Array(nodes.flatMap(() => [c.r, c.g, c.b])),
      beamPositions: new Float32Array(bp),
      beamColors: new Float32Array((bp.length / 3) * 3).fill(0.85),
    };
    this.reference.set(data, 0.012);
  }

  setView(view: { mesh: boolean; structure: boolean }): void {
    this.viewToggles = view;
    this.applyVisibility();
  }

  /** Test Mode draws the solver's structure; the static mesh/structure step aside (the sim doesn't bend them). */
  private applyVisibility(): void {
    const live = !!this.liveView;
    this.modelRoot.visible = this.viewToggles.mesh && !live;
    this.overlayRoot.visible = this.viewToggles.mesh && !live;
    this.structure.root.visible = this.viewToggles.structure && !live;
    this.live.root.visible = live;
  }

  /** Live physics frame, or null to leave Test Mode. */
  setLive(view: LiveView | null): void {
    const wasLive = !!this.liveView;
    this.liveView = view;
    this.live.update(view?.model ?? null, view?.positions ?? null, view?.stress ?? null, this.structureRadius(view?.positions));
    this.live.setObstacles(view?.obstacles, 1.6);
    if (!!view !== wasLive) this.applyVisibility();
    if (view && this.liveFramedFor !== view.model) {
      this.liveFramedFor = view.model;
      this.frameLive();
    }
    if (!view) this.liveFramedFor = null;
  }

  private structureRadius(positions: Float32Array | undefined): number {
    if (!positions || positions.length < 6) return 0.012;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      lo = Math.min(lo, positions[i]!);
      hi = Math.max(hi, positions[i]!);
    }
    return Math.min(0.03, Math.max(0.006, (hi - lo) * 0.0035));
  }

  private frameLive(): void {
    this.live.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.live.root);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = Math.max(0.5, (sphere.radius * FRAME_PADDING) / Math.sin(fov / 2));
    const dir = new Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    this.controls.update();
  }

  /** Canvas-pixel projection of a BeamNG-space point (null when behind the camera). */
  private projectLive(x: number, y: number, z: number): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    const v = new Vector3(x, y, z).applyMatrix4(this.live.root.matrixWorld).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height];
  }

  /** The point under the cursor at the grabbed node's depth, in BeamNG space. */
  private dragTarget(clientX: number, clientY: number, depth: number): [number, number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, depth);
    const world = ndc.unproject(this.camera);
    const local = this.live.root.worldToLocal(world);
    return [local.x, local.y, local.z];
  }

  // ---------------------------------------------------------------- split tool

  /** Enter/leave/update the face-selection tool. */
  setTool(tool: ToolState | null): void {
    const prev = this.tool;
    this.tool = tool;
    if (!!prev !== !!tool || prev?.mode !== tool?.mode) {
      const gesture = !!tool && (tool.mode === 'box' || tool.mode === 'lasso' || tool.mode === 'paint');
      this.controls.mouseButtons = gesture ? { LEFT: -1 as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE } : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    }
    if (tool && !prev) this.callbacks.onHover(null);
    this.syncToolOverlay();
    this.syncPlane();
  }

  private toolMesh(): Mesh | undefined {
    return this.tool ? this.meshObjects.get(this.tool.meshKey) : undefined;
  }

  private pickToolFace(clientX: number, clientY: number): number | null {
    const mesh = this.toolMesh();
    if (!mesh) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!mesh.geometry.boundsTree) mesh.geometry.computeBoundsTree({ indirect: true });
    const hit = this.raycaster.intersectObject(mesh, false)[0];
    return hit?.faceIndex ?? null;
  }

  private flood(seeds: number[], opts: { maxAngleDeg?: number; radius?: number }): number[] {
    const mesh = this.toolMesh();
    if (!mesh) return [];
    const g = mesh.geometry;
    const { positions, index } = geometryArrays(g);
    const cache = toolCache(g);
    cache.adjacency ??= triangleAdjacency(index, weldMap(positions));
    return floodFill(positions, index, seeds, opts, cache.adjacency);
  }

  /** Triangles of the tool mesh whose centroid projects inside a canvas-space polygon (selects through the mesh). */
  private trianglesInScreenPolygon(polygon: number[]): number[] {
    const mesh = this.toolMesh();
    if (!mesh) return [];
    const g = mesh.geometry;
    const cache = toolCache(g);
    if (!cache.centroids) {
      const { positions, index } = geometryArrays(g);
      cache.centroids = triangleCentroids(positions, index);
    }
    const c = cache.centroids;
    const rect = this.canvas.getBoundingClientRect();
    this.modelRoot.updateMatrixWorld(true);
    const projected = new Float32Array((c.length / 3) * 2);
    const v = new Vector3();
    for (let t = 0; t < c.length / 3; t++) {
      v.set(c[t * 3]!, c[t * 3 + 1]!, c[t * 3 + 2]).applyMatrix4(mesh.matrixWorld).project(this.camera);
      const behind = v.z > 1 || v.z < -1;
      projected[t * 2] = behind ? Number.NaN : ((v.x + 1) / 2) * rect.width;
      projected[t * 2 + 1] = behind ? Number.NaN : ((1 - v.y) / 2) * rect.height;
    }
    return trianglesInPolygon(projected, polygon);
  }

  private syncToolOverlay(): void {
    const mesh = this.toolMesh();
    const want = mesh && this.tool && this.tool.selected.length ? { geometry: mesh.geometry, selected: this.tool.selected } : null;
    const cur = this.toolOverlayFor;
    if (want && cur && cur.geometry === want.geometry && cur.selected === want.selected) return;
    if (this.toolOverlay) {
      this.overlayRoot.remove(this.toolOverlay);
      disposeSharingGeometry(this.toolOverlay.geometry);
      this.toolOverlay = null;
    }
    this.toolOverlayFor = want;
    if (!want) return;
    this.toolOverlay = new Mesh(subsetGeometry(want.geometry, want.selected), this.toolMaterial);
    this.toolOverlay.renderOrder = 2;
    this.overlayRoot.add(this.toolOverlay);
  }

  private syncPlane(): void {
    const mesh = this.toolMesh();
    const tool = this.tool;
    if (!mesh || !tool || tool.mode !== 'plane') {
      if (this.planeMesh) {
        this.overlayRoot.remove(this.planeMesh);
        this.planeMesh.geometry.dispose();
        this.planeMesh = null;
      }
      return;
    }
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new Vector3());
    const center = g.boundingBox!.getCenter(new Vector3());
    const span = Math.max(size.x, size.y, size.z) * 1.2 || 1;
    if (!this.planeMesh) {
      this.planeMesh = new Mesh(new PlaneGeometry(1, 1), this.planeMaterial);
      this.overlayRoot.add(this.planeMesh);
    }
    const p = this.planeMesh;
    p.scale.set(span, span, 1);
    p.rotation.set(0, 0, 0);
    if (tool.plane.axis === 'x') p.rotation.y = Math.PI / 2;
    else if (tool.plane.axis === 'y') p.rotation.x = Math.PI / 2;
    p.position.copy(center);
    p.position.setComponent(tool.plane.axis === 'x' ? 0 : tool.plane.axis === 'y' ? 1 : 2, tool.plane.offset);
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
    if (this.pendingPaint && this.tool?.mode === 'paint') {
      const { x, y, op } = this.pendingPaint;
      this.pendingPaint = null;
      const face = this.pickToolFace(x, y);
      if (face !== null) this.callbacks.onToolSelect?.(this.flood([face], { radius: this.tool.radius }), op);
    }
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
    this.setTool(null);
    this.structure.dispose();
    this.reference.dispose();
    this.live.dispose();
    this.selectMaterial.dispose();
    this.hoverMaterial.dispose();
    this.toolMaterial.dispose();
    this.planeMaterial.dispose();
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
