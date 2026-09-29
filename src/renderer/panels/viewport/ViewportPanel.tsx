import { useEffect, useRef, useState } from 'react';
import { FileInput, MonitorX } from 'lucide-react';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { iconSize } from '@renderer/ui/tokens';
import { reportError } from '@renderer/diagnostics/globalHandlers';
import { allMeshes, useSceneStore } from '@renderer/app/stores/scene';
import { startImport } from '@renderer/import/importFlow';
import type { ImportedMesh } from '@renderer/import/normalize';
import { ViewportRuntime, webglAvailable, type EditView, type GizmoMode, type GlState, type ToolState, type ViewState } from './viewportRuntime';
import { useEditStore } from '@renderer/structure/editStore';
import { massBalance } from '@shared/structure/balance';
import type { MaterialDef } from '@shared/materials/schema';
import type { Material } from 'three';
import { backMaterialFor, materialFor, useTextureVersion } from '@renderer/materials/runtime';
import { startPaintSync } from '@renderer/paint/sync';
import { startEngineOptionSync } from '@renderer/powertrain/commands';
import { onBrush, usePainter } from '@renderer/paint/painter';
import { SIDE_FRAMES, startVinylSync, useVinylUi, vinylKey, vinylPointer } from '@renderer/paint/vinyls';
import { facePointer, startFacePaintSync, useFaceOverlays } from '@renderer/paint/facePaint';
import { assignMaterial, MIME_MATERIAL } from '@renderer/materials/commands';
import { slotsOf } from '@renderer/materials/seed';
import { connectSelection, deleteSelection, invertSelection, mergeSelection, moveSelection, previewSelectionMove, selectAll, selectConnected, selectParts, splitSelectedBeams } from '@renderer/structure/editCommands';
import { EditToolbar } from '@renderer/structure/EditToolbar';
import { applySplitSelection, useSplitTool } from '@renderer/split/splitTool';
import { SplitToolbar } from '@renderer/split/SplitToolbar';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { DEFAULT_SETTINGS } from '@shared/settings-schema';
import { useUiStore } from '@renderer/app/stores/ui';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { structureData } from './structureOverlay';
import { dragNode, onSimFrame, useSim, type LiveFrame } from '@renderer/sim/simSession';
import { bindLiveMeshes, useLiveView } from '@renderer/sim/liveMeshes';
import { useHingeUi } from '@renderer/hinges/commands';
import { usePropUi } from '@renderer/props/commands';
import { useCameraUi } from '@renderer/cameras/commands';
import { propAmount } from '@shared/props/props';
import { useFeatureUi } from '@renderer/features/commands';
import { PLATE_SIZE } from '@shared/export/features';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { exitFocus, focusMesh, focusSelection, refreshFocus } from '@renderer/parts/focus';
import { Focus, Move, Rotate3d, Scaling, X } from 'lucide-react';
import { cx } from '@renderer/ui/cx';
import { useMeshMove } from '@renderer/scene/meshMove';
import { transformMeshes } from '@renderer/scene/meshCommands';
import splitStyles from '@renderer/split/SplitToolbar.module.css';
import styles from './ViewportPanel.module.css';

/** The viewport; anti-aliasing is fixed when the WebGL context is made, so changing it restarts the view. */
export function ViewportPanel() {
  const antialias = useSettingsStore((s) => s.settings?.antialias ?? true);
  return <ViewportCanvas key={antialias ? 'aa' : 'no-aa'} antialias={antialias} />;
}

function ViewportCanvas({ antialias }: { antialias: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [glState, setGlState] = useState<GlState>(() => (webglAvailable() ? 'starting' : 'unsupported'));
  const [fatal, setFatal] = useState<Error | null>(null);
  const [toolShape, setToolShape] = useState<number[] | null>(null);
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
        onDoublePick: (key) => focusMesh(key),
        onToolSelect: (tris, op) => useSplitTool.getState().select(tris, op),
        onToolShape: setToolShape,
        onBrush: (hit, phase) => {
          const tool = usePainter.getState().tool;
          if (tool === 'vinyl') vinylPointer(hit, phase);
          else if (tool === 'material') facePointer(hit, phase);
          else onBrush(hit, phase);
        },
        onSimDrag: (node, target) => dragNode(node, target),
        onEditPick: (node, beam, op) => {
          const edit = useEditStore.getState();
          if (!node && !beam) {
            if (op === 'replace') edit.clear();
            return;
          }
          edit.select(node ? [node] : [], beam ? [beam] : [], op);
        },
        onEditBox: (nodes, op) => useEditStore.getState().select(nodes, [], op),
        onEditDouble: (node) => {
          if (!node) return;
          useEditStore.getState().select([node], []);
          selectParts();
        },
        onMeshTransform: (t, done) => {
          const keys = useSceneStore.getState().selection;
          if (!done) {
            runtime?.previewMeshTransform(keys, t);
            return;
          }
          runtime?.previewMeshTransform(keys, null);
          const changed = Math.hypot(...t.translate) > 1e-6 || Math.abs(t.rotate[3]) < 0.999999 || t.scale.some((v) => Math.abs(v - 1) > 1e-6);
          if (changed) transformMeshes(keys, t);
        },
        onGizmoMove: (delta, done) => {
          if (!done) {
            previewSelectionMove(delta);
            return;
          }
          previewSelectionMove(null);
          if (Math.hypot(...delta) > 1e-6) moveSelection(delta);
        },
      }, { antialias });
    } catch (err) {
      reportError('viewport init failed', err);
      // One-shot fallback when WebGL init throws; cannot cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGlState('unsupported');
      return;
    }
    const rt = runtime;
    runtimeRef.current = rt;

    // Scene store → runtime, outside React rendering (hundreds of meshes, per-frame hover).
    let meshesSource: unknown = null;
    let meshes: ImportedMesh[] = [];
    let materialInputs: unknown[] = [];
    let materials: ReadonlyMap<string, Material | Material[]> | undefined;
    let backMaterials: ReadonlyMap<string, Material> | undefined;
    const push = () => {
      const s = scene.getState();
      if (s.sources !== meshesSource) {
        meshesSource = s.sources;
        meshes = allMeshes(s.sources);
      }
      const doc = projectStore.getState().doc;
      const inputs = [meshes, doc?.materials, doc?.materialSlots, useTextureVersion.getState().version];
      if (inputs.some((x, i) => x !== materialInputs[i])) {
        materialInputs = inputs;
        materials = doc ? projectMaterials(doc, meshes) : undefined;
        backMaterials = doc ? projectBackMaterials(doc, meshes) : undefined;
      }
      const view: ViewState = { meshes, hidden: s.hidden, selection: s.selection, hover: s.hover, focus: s.focus?.meshKeys ?? null, materials, backMaterials };
      rt.sync(view);
    };
    push();
    if (meshes.length) rt.frame();
    // Split tool state → runtime.
    const pushTool = () => {
      const t = useSplitTool.getState();
      const tool: ToolState | null = t.meshKey ? { meshKey: t.meshKey, mode: t.mode, selected: t.selected, angleDeg: t.angleDeg, radius: t.radius, plane: t.plane } : null;
      rt.setTool(tool);
    };
    pushTool();
    const unsubscribeTool = useSplitTool.subscribe(pushTool);
    const pushBrush = () => {
      const p = usePainter.getState();
      rt.setBrush(p.on);
      rt.setBrushMirror(p.mirror);
    };
    pushBrush();
    const unsubscribeBrush = usePainter.subscribe(pushBrush);

    // Generated structure + view toggles → runtime (rebuilt only when the structure changes).
    let lastStructure: unknown = null;
    const pushStructure = () => {
      const doc = projectStore.getState().doc;
      const focus = scene.getState().focus;
      const edit = useEditStore.getState();
      const key = doc ? [doc.nodes, doc.beams, doc.parts, focus, edit.preview, edit.active, edit.nodes, edit.beams] : null;
      if (!key || !lastStructure || (lastStructure as unknown[]).some((x, i) => x !== key[i])) {
        const structureChanged = !lastStructure || (lastStructure as unknown[]).slice(0, 5).some((x, i) => x !== key?.[i]);
        lastStructure = key;
        const only = focus?.partId ? new Set(focus.parts) : undefined;
        if (structureChanged) {
          rt.setStructure(doc && doc.nodes.length ? structureData(doc, (id) => currentTaxonomy().entry(id), only, edit.preview) : null);
          rt.setCog(doc ? (massBalance(doc.nodes)?.cog ?? null) : null);
        }
        rt.setEdit(doc && edit.active ? editView(doc, only, edit) : null);
      }
    };
    startPaintSync();
    startEngineOptionSync();
    startVinylSync();
    startFacePaintSync();
    rt.setFaceOverlays(useFaceOverlays.getState().map);
    const unsubscribeFaces = useFaceOverlays.subscribe((f) => rt.setFaceOverlays(f.map));
    const unsubscribeVinylView = useVinylUi.subscribe((ui, prev) => {
      if (ui.view && ui.view !== prev.view) rt.viewFrom(SIDE_FRAMES[ui.view.side].n);
    });
    pushStructure();
    rt.setView(useUiStore.getState().view);
    rt.setChannel(useUiStore.getState().channel);
    const unsubscribeStructure = projectStore.subscribe(() => {
      refreshFocus();
      pushStructure();
      push();
    });
    const unsubscribeTextures = useTextureVersion.subscribe(push);
    const ghost = () => {
      const st = useSettingsStore.getState().settings ?? DEFAULT_SETTINGS;
      rt.setGhostOpacity(st.focusGhostOpacity);
      rt.setGraphics({ renderScale: st.renderScale, maxFps: st.maxFps, showGrid: st.showGrid, reflections: st.reflections, background: st.viewportBackground, fov: st.cameraFov, orbitSpeed: st.orbitSpeed, zoomSpeed: st.zoomSpeed, invertZoom: st.invertZoom });
    };
    ghost();
    const unsubscribeSettings = useSettingsStore.subscribe(ghost);
    const unsubscribeView = useUiStore.subscribe((s) => {
      rt.setView(s.view);
      rt.setChannel(s.channel);
    });
    const unsubscribeEdit = useEditStore.subscribe(pushStructure);
    // Move gizmo on the selected meshes (Modelling), re-parked whenever they change.
    const pushMeshGizmo = () => {
      const move = useMeshMove.getState();
      const on = move.on && !useEditStore.getState().active && !useSplitTool.getState().meshKey;
      rt.setMeshGizmo(on ? scene.getState().selection : null, move.mode);
    };
    pushMeshGizmo();
    const unsubscribeMove = useMeshMove.subscribe(pushMeshGizmo);
    const unsubscribeMoveScene = scene.subscribe(pushMeshGizmo);
    const unsubscribeMoveEdit = useEditStore.subscribe(pushMeshGizmo);
    // Test Mode frames straight from the sim session (60 Hz, outside React).
    // Test Mode: the car's meshes bent by the physics (optionally just the selected part's).
    let latestFrame: LiveFrame | null = null;
    let liveKey: unknown[] | null = null;
    const pushLiveMeshes = () => {
      const lv = useLiveView.getState();
      const frame = latestFrame;
      if (!frame || !lv.showMesh) {
        if (liveKey) rt.setLiveMeshes(null);
        liveKey = null;
        return;
      }
      const sel = scene.getState().selection;
      const key = [frame.model, lv.isolate, lv.isolate ? sel : null];
      if (liveKey && key.every((x, i) => x === liveKey![i])) return;
      liveKey = key;
      const doc = projectStore.getState().doc;
      if (!doc) return;
      let only: Set<string> | undefined;
      if (lv.isolate) {
        // The selected meshes' parts, whole.
        const parts = new Set(sel.map((k) => doc.assignments[k]).filter(Boolean));
        only = new Set([...sel, ...Object.keys(doc.assignments).filter((k) => parts.has(doc.assignments[k]))]);
      }
      rt.setLiveMeshes(bindLiveMeshes(frame.model, doc, allMeshes(scene.getState().sources), only));
    };
    const unsubscribeSim = onSimFrame((frame) => {
      latestFrame = frame;
      rt.setLive(frame);
      pushLiveMeshes();
    });
    const unsubscribeLiveView = useLiveView.subscribe(pushLiveMeshes);
    // Hinge wizard preview: follows the hinge section's part and swing slider.
    const pushHinge = () => {
      const { partId, swing } = useHingeUi.getState();
      const doc = projectStore.getState().doc;
      // An animated part being tried in the Inspector: the same ghost, turned about its pivot.
      const pu = usePropUi.getState();
      const prop = pu.propId ? doc?.props?.find((p) => p.id === pu.propId) : undefined;
      if (prop && Math.hypot(...prop.axis) > 1e-9) {
        const end: [number, number, number] = [prop.pivot[0] + prop.axis[0], prop.pivot[1] + prop.axis[1], prop.pivot[2] + prop.axis[2]];
        return rt.setHingePreview({ axis: [prop.pivot, end], latch: null, handles: [], meshKeys: [prop.meshKey], angle: propAmount(prop, pu.value) });
      }
      const h = partId ? doc?.hinges.find((x) => x.partId === partId) : undefined;
      if (!doc || !h) return rt.setHingePreview(null);
      const meshKeys = Object.keys(doc.assignments).filter((k) => doc.assignments[k] === partId);
      rt.setHingePreview({ axis: h.axis, latch: h.latch, handles: h.handles.map((x) => x.pos), meshKeys, angle: swing * h.openAngle * h.direction });
    };
    pushHinge();
    const unsubscribeHinge = useHingeUi.subscribe(pushHinge);
    const unsubscribeProp = usePropUi.subscribe(pushHinge);
    // Interior cameras: look through one from the Extras panel.
    const unsubscribeLook = useCameraUi.subscribe((st, prev) => {
      if (st.look !== prev.look) rt.lookFrom(st.look);
    });
    // Extras preview: plates, tow ball and nitrous bottle where they'll go.
    const pushFeatures = () => {
      const f = projectStore.getState().doc?.features;
      if (!f || !useFeatureUi.getState().preview) return rt.setFeaturePreview(null);
      const plates = [f.plates.front && { pos: f.plates.front.pos, tilt: f.plates.front.tilt, turn: 0, size: PLATE_SIZE }, f.plates.rear && { pos: f.plates.rear.pos, tilt: f.plates.rear.tilt, turn: 180, size: PLATE_SIZE }].filter((p) => !!p);
      rt.setFeaturePreview({ plates, hitch: f.hitch?.pos ?? null, bottle: f.nitrous ? { pos: f.nitrous.pos, length: f.nitrous.bottle === '10lb' ? 0.5 : 0.7 } : null });
    };
    pushFeatures();
    const unsubscribeFeatures = useFeatureUi.subscribe(pushFeatures);
    const unsubscribeFeaturesDoc = projectStore.subscribe(pushFeatures);
    const unsubscribeHingeDoc = projectStore.subscribe(pushHinge);
    const unsubscribeLiveSel = scene.subscribe(() => useLiveView.getState().isolate && pushLiveMeshes());
    let lastFrameRequest = scene.getState().frameRequest;
    const unsubscribe = scene.subscribe((s) => {
      push();
      pushStructure();
      if (s.frameRequest !== lastFrameRequest) {
        lastFrameRequest = s.frameRequest;
        rt.frame(s.frameRequest.keys, s.frameRequest.glide);
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const splitting = useSplitTool.getState().meshKey !== null;
      const edit = useEditStore.getState();
      // Vinyl layers: move, turn, resize, delete, duplicate and group the selection from the keyboard.
      if (vinylKey(e)) {
        e.preventDefault();
        return;
      }
      // Painting: [ and ] size the brush, Esc puts it away.
      const painter = usePainter.getState();
      if (painter.on && (e.key === '[' || e.key === ']' || e.key === 'Escape')) {
        if (e.key === 'Escape') painter.set({ on: false });
        else painter.set({ size: Math.max(0.5, Math.min(100, Math.round(painter.size * (e.key === ']' ? 1.25 : 0.8) * 2) / 2)) });
        e.preventDefault();
        return;
      }
      // Painting: tool keys (B brush, E erase, F fill, P pattern, T stamp, I eyedropper; M mirror).
      const paintTool = ({ b: 'brush', e: 'erase', f: 'fill', p: 'pattern', t: 'stamp', i: 'picker', v: 'vinyl', a: 'material' } as const)[e.key.toLowerCase() as 'b'];
      if (painter.on && !e.ctrlKey && !e.altKey && !e.metaKey && (paintTool || e.key.toLowerCase() === 'm')) {
        painter.set(paintTool ? { tool: paintTool } : { mirror: !painter.mirror });
        e.preventDefault();
        return;
      }
      // Blender-style: G move, R rotate, S scale (M too, for move); Esc puts the gizmo away.
      const gizmoKey = { g: 'translate', m: 'translate', r: 'rotate', s: 'scale' }[e.key.toLowerCase()] as GizmoMode | undefined;
      if (!splitting && !edit.active && gizmoKey && !e.ctrlKey && !e.altKey && !e.metaKey && scene.getState().selection.length) {
        useMeshMove.getState().setMode(gizmoKey);
        e.preventDefault();
        return;
      }
      if (!splitting && !edit.active && e.key === 'Escape' && useMeshMove.getState().on) {
        useMeshMove.getState().set(false);
        e.preventDefault();
        return;
      }
      if (!splitting && e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
        edit.setActive(!edit.active);
        e.preventDefault();
        return;
      }
      if (edit.active && !splitting && editKey(e, rt)) {
        e.preventDefault();
        return;
      }
      if (splitting && e.key === 'Escape') useSplitTool.getState().cancel();
      else if (splitting && e.key === 'Enter') void applySplitSelection();
      else if (e.key === 'f' || e.key === 'F') {
        if (!focusSelection()) rt.frame(scene.getState().selection);
      } else if (e.key === 'Escape') {
        if (!exitFocus()) return;
      } else if (e.key === 'Home') rt.frame();
      else return;
      e.preventDefault();
    };
    host.addEventListener('keydown', onKey);

    // Drop a material from the Materials panel onto a mesh (onto the whole selection if it's part of it).
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(MIME_MATERIAL)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      scene.getState().setHover(rt.pick(e.clientX, e.clientY));
    };
    const onDrop = (e: DragEvent) => {
      const material = e.dataTransfer?.getData(MIME_MATERIAL);
      if (!material) return;
      e.preventDefault();
      const key = rt.pick(e.clientX, e.clientY);
      if (!key) return;
      const selection = scene.getState().selection;
      assignMaterial(material, selection.includes(key) ? selection : [key]);
    };
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('drop', onDrop);

    return () => {
      unsubscribe();
      unsubscribeTool();
      unsubscribeBrush();
      unsubscribeVinylView();
      unsubscribeFaces();
      unsubscribeStructure();
      unsubscribeSettings();
      unsubscribeView();
      unsubscribeEdit();
      unsubscribeMove();
      unsubscribeMoveScene();
      unsubscribeMoveEdit();
      unsubscribeTextures();
      unsubscribeSim();
      unsubscribeLiveView();
      unsubscribeHinge();
      unsubscribeProp();
      unsubscribeLook();
      unsubscribeHingeDoc();
      unsubscribeFeatures();
      unsubscribeFeaturesDoc();
      unsubscribeLiveSel();
      host.removeEventListener('keydown', onKey);
      host.removeEventListener('dragover', onDragOver);
      host.removeEventListener('drop', onDrop);
      rt.dispose();
      runtimeRef.current = null;
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
      <SplitToolbar />
      <EditToolbar />
      <FocusPill />
      <MovePill />
      <FpsCounter runtime={runtimeRef} />
      {toolShape && toolShape.length >= 4 && (
        <svg className={splitStyles.shape} aria-hidden>
          <polygon points={svgPoints(toolShape)} />
        </svg>
      )}
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

/** Settings → Show frame rate: the viewport's measured frames per second. */
function FpsCounter({ runtime }: { runtime: { current: ViewportRuntime | null } }) {
  const show = useSettingsStore((s) => s.settings?.showFps ?? false);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!show) return;
    const t = setInterval(() => setFps(runtime.current?.fps ?? 0), 500);
    return () => clearInterval(t);
  }, [show, runtime]);
  if (!show) return null;
  return (
    <div className={styles.fps} data-testid="viewport-fps" aria-live="off">
      {fps} fps
    </div>
  );
}

/** [x0, y0, x1, y1, …] → "x0,y0 x1,y1 …" for an SVG polygon. */
function svgPoints(flat: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(`${flat[i]},${flat[i + 1]}`);
  return out.join(' ');
}

/** Modelling: turn the move arrows on the selected meshes on and off (M). */
const GIZMO_TOOLS: { mode: GizmoMode; label: string; key: string; icon: typeof Move }[] = [
  { mode: 'translate', label: 'Move', key: 'G', icon: Move },
  { mode: 'rotate', label: 'Rotate', key: 'R', icon: Rotate3d },
  { mode: 'scale', label: 'Scale', key: 'S', icon: Scaling },
];

/** Modelling: move / rotate / scale the selected meshes with a gizmo (G, R, S like Blender; Esc to put it away). */
function MovePill() {
  const on = useMeshMove((s) => s.on);
  const mode = useMeshMove((s) => s.mode);
  const selected = useSceneStore((s) => s.selection.length);
  const editing = useEditStore((s) => s.active);
  const testing = useSim((s) => s.active);
  if (editing || testing || (!selected && !on)) return null;
  return (
    <div className={styles.gizmoTools} role="toolbar" aria-label="Transform the selected meshes">
      {GIZMO_TOOLS.map((t) => (
        <button
          key={t.mode}
          type="button"
          className={cx(styles.movePill, on && mode === t.mode && styles.movePillOn)}
          onClick={() => useMeshMove.getState().setMode(t.mode)}
          title={`${t.label} the selected meshes (${t.key})`}
          aria-pressed={on && mode === t.mode}
          data-testid={t.mode === 'translate' ? 'mesh-move-toggle' : `mesh-${t.mode}-toggle`}
        >
          <t.icon size={iconSize('size-icon-sm')} aria-hidden />
          {t.label}
          <kbd className={styles.kbd}>{t.key}</kbd>
        </button>
      ))}
    </div>
  );
}

/** "Focused on Hood" with a way out, while Focus Mode is on. */
function FocusPill() {
  const focus = useSceneStore((s) => s.focus);
  const name = useProjectStore((s) => (focus?.partId ? s.doc?.parts.find((p) => p.id === focus.partId)?.displayName : undefined));
  if (!focus) return null;
  const label = name ?? `${focus.meshKeys.length} mesh${focus.meshKeys.length === 1 ? '' : 'es'}`;
  return (
    <div className={styles.focusPill} role="status" data-testid="focus-pill">
      <Focus size={iconSize('size-icon-sm')} aria-hidden />
      <span>
        Focused on <strong>{label}</strong>
      </span>
      <span className={styles.focusHint}>Esc to leave</span>
      <button type="button" className={styles.focusClose} onClick={() => exitFocus()} aria-label="Leave focus mode" data-testid="focus-exit">
        <X size={iconSize('size-icon-sm')} aria-hidden />
      </button>
    </div>
  );
}

/** What edit mode can pick: the (focused) nodes at their previewed positions, and beams between them. */
function editView(doc: { nodes: readonly { id: string; partId: string; pos: [number, number, number] }[]; beams: readonly { id1: string; id2: string; partId: string }[] }, only: ReadonlySet<string> | undefined, edit: { preview: ReadonlyMap<string, [number, number, number]> | null; nodes: readonly string[]; beams: readonly string[] }): EditView {
  const nodes = doc.nodes.filter((n) => !only || only.has(n.partId)).map((n) => ({ id: n.id, pos: edit.preview?.get(n.id) ?? n.pos }));
  const ids = new Set(nodes.map((n) => n.id));
  const beams = doc.beams.filter((b) => ids.has(b.id1) && ids.has(b.id2)).map((b) => [b.id1, b.id2] as [string, string]);
  return { nodes, beams, selectedNodes: edit.nodes, selectedBeams: edit.beams };
}

/** Edit-mode keys. Returns true when the key was handled. */
function editKey(e: KeyboardEvent, rt: ViewportRuntime): boolean {
  const edit = useEditStore.getState();
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
  else if (ctrl && (e.key === 'a' || e.key === 'A')) selectAll();
  else if (!ctrl && (e.key === 'i' || e.key === 'I')) invertSelection();
  else if (!ctrl && (e.key === 'l' || e.key === 'L')) selectConnected();
  else if (!ctrl && (e.key === 'b' || e.key === 'B')) connectSelection();
  else if (!ctrl && (e.key === 'm' || e.key === 'M')) mergeSelection();
  else if (!ctrl && (e.key === 'd' || e.key === 'D')) splitSelectedBeams();
  else if (e.key === 'Escape' && (edit.nodes.length || edit.beams.length)) edit.clear();
  else if (e.key.startsWith('Arrow') && edit.nodes.length) {
    // 5 mm steps; Shift for 25 mm, Alt for 1 mm. Left/right and up/down follow the screen, snapped to the nearest axis.
    const step = e.shiftKey ? 0.025 : e.altKey ? 0.001 : 0.005;
    const { right, up } = rt.nudgeAxes();
    const dir = e.key === 'ArrowRight' ? right : e.key === 'ArrowLeft' ? right.map((v) => -v) : e.key === 'ArrowUp' ? up : up.map((v) => -v);
    moveSelection([dir[0]! * step, dir[1]! * step, dir[2]! * step], 'Nudge nodes');
  } else return false;
  return true;
}

/** Two-sided materials: the back material of each mesh whose (first) material has one. */
function projectBackMaterials(doc: { materials: readonly MaterialDef[]; materialSlots: Readonly<Record<string, readonly string[]>> }, meshes: readonly ImportedMesh[]): Map<string, Material> {
  const defs = new Map(doc.materials.map((d) => [d.id, d]));
  const out = new Map<string, Material>();
  for (const m of meshes) {
    const front = slotsOf(doc, m.key)?.map((id) => defs.get(id)).find((d) => d?.backMaterialId);
    const back = front?.backMaterialId ? defs.get(front.backMaterialId) : undefined;
    if (back) out.set(m.key, backMaterialFor(back));
  }
  return out;
}

/** Each mesh's project materials (split pieces use their base mesh's). */
function projectMaterials(doc: { materials: readonly MaterialDef[]; materialSlots: Readonly<Record<string, readonly string[]>> }, meshes: readonly ImportedMesh[]): Map<string, Material | Material[]> {
  const defs = new Map(doc.materials.map((d) => [d.id, d]));
  const out = new Map<string, Material | Material[]>();
  for (const m of meshes) {
    const ids = slotsOf(doc, m.key);
    if (!ids?.length) continue;
    const imported = Array.isArray(m.material) ? m.material : [m.material];
    const mats = ids.map((id, i) => {
      const def = defs.get(id);
      return def ? materialFor(def) : (imported[i] ?? imported[0]!);
    });
    out.set(m.key, mats.length === 1 ? mats[0]! : mats);
  }
  return out;
}
