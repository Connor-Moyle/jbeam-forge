import { create } from 'zustand';
import { Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { MeshModel } from '@shared/project/schema';
import { edgesOf, emptyModel, extrude, facesTouching, facesWithin, fill, flipFaces, linkedFaces, livePoints, modelFits, modelIsEmpty, movePoints, pointsOfFaces, removeFaces, shapeOf, type Shape, type Topology, type V3 } from '@shared/mesh/meshModel';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { topologyOf } from './build';

/**
 * Modelling workspace (fork): reshape one mesh at a time, Blender-style.
 * Pick points, edges or faces; move, turn or resize them with the gizmo;
 * delete, fill, extrude and flip. Every change is one undo step and is kept
 * in the project (doc.meshModels), never in the model file.
 */

export type SelectMode = 'vertex' | 'edge' | 'face';
export type ModelGizmo = 'translate' | 'rotate' | 'scale';

interface ModelUi {
  /** The mesh being reshaped (null: none; clicks pick meshes as usual). */
  key: string | null;
  mode: SelectMode;
  points: number[];
  edges: [number, number][];
  faces: number[];
  gizmo: ModelGizmo;
  set: (patch: Partial<Omit<ModelUi, 'set'>>) => void;
}

export const useModelUi = create<ModelUi>()((set) => ({
  key: null,
  mode: 'vertex',
  points: [],
  edges: [],
  faces: [],
  gizmo: 'translate',
  set: (patch) => set(patch),
}));

const EMPTY_SEL = { points: [], edges: [], faces: [] };

/** Meshes this big are slow to reshape point by point. */
export const MODEL_WARN_TRIS = 150_000;

/** The scene mesh by key. */
export function sceneMesh(key: string) {
  const sourceId = key.slice(0, key.indexOf(':'));
  return useSceneStore.getState().sources[sourceId]?.meshes.find((m) => m.key === key) ?? null;
}

/** Why this mesh can't be reshaped (null: it can). */
export function cannotModel(key: string): string | null {
  if (key.startsWith('copy:')) return 'This is a copy of another mesh: reshape the original and the copy follows.';
  const mesh = sceneMesh(key);
  if (!mesh) return 'That mesh isn’t loaded.';
  return null;
}

/** Everything the viewport and the tools need about the mesh being reshaped. */
export interface ModelState {
  key: string;
  topo: Topology;
  model: MeshModel;
  shape: Shape;
  /** Mesh space → what the viewport shows (its move/turn/resize); null = the same. */
  matrix: Matrix4 | null;
  /** Every point where the viewport shows it (BeamNG space). */
  shown: Float32Array;
}

export function modelState(key: string | null = useModelUi.getState().key): ModelState | null {
  if (!key) return null;
  const mesh = sceneMesh(key);
  if (!mesh) return null;
  const base = (mesh.geometry.userData.modelBase as BufferGeometry | undefined) ?? mesh.geometry;
  const topo = topologyOf(base);
  const stored = projectStore.getState().doc?.meshModels?.[key];
  const model = stored && modelFits(topo, stored) ? stored : emptyModel(topo);
  const shape = shapeOf(topo, model);
  const m = mesh.geometry.userData.editMatrix as number[] | null | undefined;
  const matrix = m ? new Matrix4().fromArray(m) : null;
  const shown = new Float32Array(shape.points);
  if (matrix) {
    const v = new Vector3();
    for (let i = 0; i < shown.length; i += 3) {
      v.set(shown[i]!, shown[i + 1]!, shown[i + 2]).applyMatrix4(matrix);
      shown[i] = v.x;
      shown[i + 1] = v.y;
      shown[i + 2] = v.z;
    }
  }
  return { key, topo, model, shape, matrix, shown };
}

/** Start reshaping a mesh (null = stop). */
export function enterModelling(key: string | null): void {
  if (key) {
    const why = cannotModel(key);
    if (why) {
      useUiStore.getState().pushStatus(why, 'warning');
      return;
    }
    const tris = sceneMesh(key)?.triangles ?? 0;
    if (tris > MODEL_WARN_TRIS) useUiStore.getState().pushStatus(`${tris.toLocaleString()} triangles: picking and moving may be slow on a mesh this dense`, 'warning');
    // The mesh's selection tint would hide what is picked on it.
    useSceneStore.getState().select([]);
  }
  const was = useModelUi.getState().key;
  useModelUi.getState().set({ key, ...EMPTY_SEL });
  if (!key && was) useSceneStore.getState().select([was]);
}

/** The points the selection covers, whatever the mode. */
export function selectedPoints(st: ModelState | null = modelState()): number[] {
  const ui = useModelUi.getState();
  if (!st) return [];
  if (ui.mode === 'vertex') return ui.points;
  if (ui.mode === 'edge') return [...new Set(ui.edges.flat())];
  return pointsOfFaces(st.shape, ui.faces);
}

/** The faces the selection covers: picked faces, or those every corner of which is picked. */
export function selectedFaces(st: ModelState | null = modelState()): number[] {
  const ui = useModelUi.getState();
  if (!st) return [];
  if (ui.mode === 'face') return ui.faces;
  return facesWithin(st.shape, new Set(selectedPoints(st)));
}

/** Switch between point, edge and face picking, keeping what is picked where it can. */
export function setSelectMode(mode: SelectMode): void {
  const ui = useModelUi.getState();
  if (ui.mode === mode) return;
  const st = modelState();
  if (!st) {
    ui.set({ mode });
    return;
  }
  const pts = new Set(selectedPoints(st));
  const faces = ui.mode === 'face' ? ui.faces : facesWithin(st.shape, pts);
  const edges: [number, number][] = [];
  const e = edgesOf(st.shape);
  for (let i = 0; i < e.length; i += 2) if (pts.has(e[i]!) && pts.has(e[i + 1]!)) edges.push([e[i]!, e[i + 1]!]);
  ui.set({ mode, points: [...pts], edges, faces });
}

const sq = (a: V3, b: V3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const shownAt = (st: ModelState, p: number): V3 => [st.shown[p * 3]!, st.shown[p * 3 + 1]!, st.shown[p * 3 + 2]!];

/** A click on the mesh: `face` is the triangle hit and `point` where (BeamNG space); null = empty space. */
export function pickElement(hit: { face: number; point: V3 } | null, mods: { shift: boolean; ctrl: boolean }): void {
  const ui = useModelUi.getState();
  const st = modelState();
  if (!st) return;
  if (!hit) {
    if (!mods.shift && !mods.ctrl) ui.set(EMPTY_SEL);
    return;
  }
  const t = hit.face;
  if (t >= st.shape.triCount || st.shape.removed[t]) return;
  const corners = [st.shape.corners[t * 3]!, st.shape.corners[t * 3 + 1]!, st.shape.corners[t * 3 + 2]!];
  const toggle = <T>(list: readonly T[], item: T, same: (a: T, b: T) => boolean): T[] => {
    if (!mods.shift && !mods.ctrl) return [item];
    const has = list.some((x) => same(x, item));
    if (has) return mods.shift && !mods.ctrl ? [...list.filter((x) => !same(x, item)), item] : list.filter((x) => !same(x, item));
    return [...list, item];
  };
  if (ui.mode === 'vertex') {
    const p = corners.reduce((a, b) => (sq(shownAt(st, b), hit.point) < sq(shownAt(st, a), hit.point) ? b : a));
    ui.set({ points: toggle(ui.points, p, (a, b) => a === b) });
  } else if (ui.mode === 'edge') {
    // The triangle's edge nearest the click.
    let best: [number, number] = [corners[0]!, corners[1]!];
    let bestD = Infinity;
    for (let k = 0; k < 3; k++) {
      const a = corners[k]!;
      const b = corners[(k + 1) % 3]!;
      const d = segDist(hit.point, shownAt(st, a), shownAt(st, b));
      if (d < bestD) {
        bestD = d;
        best = a < b ? [a, b] : [b, a];
      }
    }
    ui.set({ edges: toggle(ui.edges, best, (x, y) => x[0] === y[0] && x[1] === y[1]) });
  } else ui.set({ faces: toggle(ui.faces, t, (a, b) => a === b) });
}

function segDist(p: V3, a: V3, b: V3): number {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l));
  return sq(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

/** Pick everything (A), or nothing when everything is already picked. */
export function selectAll(): void {
  const st = modelState();
  const ui = useModelUi.getState();
  if (!st) return;
  const live = livePoints(st.shape);
  const all: number[] = [];
  for (let p = 0; p < live.length; p++) if (live[p]) all.push(p);
  const faces: number[] = [];
  for (let t = 0; t < st.shape.triCount; t++) if (!st.shape.removed[t]) faces.push(t);
  const edges: [number, number][] = [];
  const e = edgesOf(st.shape);
  for (let i = 0; i < e.length; i += 2) edges.push([e[i]!, e[i + 1]!]);
  const everything = ui.mode === 'vertex' ? ui.points.length === all.length : ui.mode === 'edge' ? ui.edges.length === edges.length : ui.faces.length === faces.length;
  ui.set(everything ? EMPTY_SEL : { points: all, edges, faces });
}

/** Everything joined to what is picked (L). */
export function selectLinked(): void {
  const st = modelState();
  if (!st) return;
  const start = useModelUi.getState().mode === 'face' ? useModelUi.getState().faces : facesTouching(st.shape, new Set(selectedPoints(st)));
  const faces = linkedFaces(st.shape, start);
  selectFaces(st, faces);
}

function selectFaces(st: ModelState, faces: readonly number[], points?: readonly number[]): void {
  const pts = new Set(points ?? pointsOfFaces(st.shape, faces));
  const edges: [number, number][] = [];
  const e = edgesOf(st.shape);
  for (let i = 0; i < e.length; i += 2) if (pts.has(e[i]!) && pts.has(e[i + 1]!)) edges.push([e[i]!, e[i + 1]!]);
  useModelUi.getState().set({ points: [...pts], edges, faces: [...faces] });
}

function save(key: string, model: MeshModel, label: string): void {
  projectStore.getState().execute({
    label,
    apply: (d) => {
      d.meshModels ??= {};
      if (modelIsEmpty(model)) delete d.meshModels[key];
      else d.meshModels[key] = model;
    },
  });
}

/** The gizmo's drag as a matrix in BeamNG space. */
export function gizmoMatrix(t: { pivot: V3; translate: V3; rotate: [number, number, number, number]; scale: V3 }): Matrix4 {
  const p = new Vector3(...t.pivot);
  return new Matrix4()
    .makeTranslation(p.x + t.translate[0], p.y + t.translate[1], p.z + t.translate[2])
    .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion(...t.rotate)))
    .multiply(new Matrix4().makeScale(...t.scale))
    .multiply(new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}

/** Where the picked points go under the drag, in the mesh's own space. */
export function movedPoints(st: ModelState, pts: readonly number[], m: Matrix4): Map<number, V3> {
  const inv = st.matrix ? st.matrix.clone().invert() : null;
  const out = new Map<number, V3>();
  const v = new Vector3();
  for (const p of pts) {
    v.set(st.shown[p * 3]!, st.shown[p * 3 + 1]!, st.shown[p * 3 + 2]).applyMatrix4(m);
    if (inv) v.applyMatrix4(inv);
    out.set(p, [v.x, v.y, v.z]);
  }
  return out;
}

/** The gizmo was let go: move the picked points for good. */
export function commitTransform(m: Matrix4): void {
  const st = modelState();
  const pts = selectedPoints(st);
  if (!st || !pts.length) return;
  const verb = useModelUi.getState().gizmo === 'rotate' ? 'Turn' : useModelUi.getState().gizmo === 'scale' ? 'Resize' : 'Move';
  save(st.key, movePoints(st.model, movedPoints(st, pts, m)), `${verb} ${pts.length} point${pts.length === 1 ? '' : 's'}`);
}

/** Delete (X): picked faces, or the faces touching picked points/edges. */
export function deleteSelection(): void {
  const st = modelState();
  if (!st) return;
  const ui = useModelUi.getState();
  const faces = ui.mode === 'face' ? ui.faces : ui.mode === 'edge' ? facesWithinEdges(st, ui.edges) : facesTouching(st.shape, new Set(ui.points));
  if (!faces.length) return;
  save(st.key, removeFaces(st.model, faces), `Delete ${faces.length} face${faces.length === 1 ? '' : 's'}`);
  ui.set(EMPTY_SEL);
}

function facesWithinEdges(st: ModelState, edges: readonly (readonly [number, number])[]): number[] {
  const want = new Set(edges.map(([a, b]) => `${a}|${b}`));
  const out: number[] = [];
  for (let t = 0; t < st.shape.triCount; t++) {
    if (st.shape.removed[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = st.shape.corners[t * 3 + k]!;
      const b = st.shape.corners[t * 3 + ((k + 1) % 3)]!;
      if (want.has(a < b ? `${a}|${b}` : `${b}|${a}`)) {
        out.push(t);
        break;
      }
    }
  }
  return out;
}

/** Flip normals: the picked faces face the other way. */
export function flipSelection(): void {
  const st = modelState();
  const faces = selectedFaces(st);
  if (!st || !faces.length) {
    useUiStore.getState().pushStatus('Pick the faces to flip first (or every corner of them)', 'warning');
    return;
  }
  save(st.key, flipFaces(st.model, faces), `Flip ${faces.length} face${faces.length === 1 ? '' : 's'}`);
}

/** Fill (F): a face through 3 or 4 picked points. */
export function fillSelection(): void {
  const st = modelState();
  if (!st) return;
  const pts = selectedPoints(st);
  const r = pts.length >= 3 && pts.length <= 4 ? fill(st.model, st.shape, pts) : null;
  if (!r) {
    useUiStore.getState().pushStatus('Fill makes a face from 3 or 4 picked points (or 2 edges)', 'warning');
    return;
  }
  save(st.key, r.model, 'Fill a face');
}

/** Extrude (E): picked faces are pulled out with walls; picked edges grow a new face. */
export function extrudeSelection(): void {
  const st = modelState();
  if (!st) return;
  const ui = useModelUi.getState();
  const faces = selectedFaces(st);
  const r = faces.length ? extrude(st.model, st.shape, { faces }) : ui.mode === 'edge' && ui.edges.length ? extrude(st.model, st.shape, { edges: ui.edges }) : null;
  if (!r) {
    useUiStore.getState().pushStatus('Extrude needs faces, or edges in edge mode', 'warning');
    return;
  }
  save(st.key, r.model, 'Extrude');
  // Carry on with the new part picked, ready to move.
  const after = modelState();
  if (after) selectFaces(after, r.faces, r.points);
  useModelUi.getState().set({ gizmo: 'translate' });
}

/** Put the mesh back the way the file has it. */
export function resetMesh(): void {
  const key = useModelUi.getState().key;
  if (!key || !projectStore.getState().doc?.meshModels?.[key]) return;
  projectStore.getState().execute({
    label: 'Undo all reshaping',
    apply: (d) => {
      if (d.meshModels) delete d.meshModels[key];
    },
  });
  useModelUi.getState().set(EMPTY_SEL);
}

/** Meshes of a source reshaped in the app. */
export function modelledMeshes(sourceId: string): string[] {
  return Object.keys(projectStore.getState().doc?.meshModels ?? {}).filter((k) => k.startsWith(`${sourceId}:`));
}

/** "Use the file's version": drop the in-app reshaping of a source's meshes (one undo step). */
export function dropModels(sourceId: string): void {
  const keys = modelledMeshes(sourceId);
  if (!keys.length) return;
  projectStore.getState().execute({
    label: 'Use the file’s version of the reshaped meshes',
    apply: (d) => {
      for (const k of keys) delete d.meshModels?.[k];
    },
  });
}

/**
 * Blender's keys while reshaping (the viewport's key handler asks first):
 * 1/2/3 points/edges/faces, A all, L linked, G/R/S move/turn/resize,
 * E extrude, F fill, X or Delete delete, Alt+N flip, Esc drops the pick
 * (then leaves), Tab leaves. True when the key was used.
 */
export function modelKey(e: KeyboardEvent): boolean {
  const ui = useModelUi.getState();
  if (!ui.key || e.ctrlKey || e.metaKey) return false;
  const k = e.key.toLowerCase();
  if (e.altKey) {
    if (k === 'n') {
      flipSelection();
      return true;
    }
    return false;
  }
  const modes: Record<string, SelectMode> = { '1': 'vertex', '2': 'edge', '3': 'face' };
  const gizmos: Record<string, ModelGizmo> = { g: 'translate', r: 'rotate', s: 'scale' };
  if (modes[k]) setSelectMode(modes[k]);
  else if (gizmos[k]) ui.set({ gizmo: gizmos[k] });
  else if (k === 'a') selectAll();
  else if (k === 'l') selectLinked();
  else if (k === 'x' || k === 'delete') deleteSelection();
  else if (k === 'e') extrudeSelection();
  else if (k === 'f') fillSelection();
  else if (k === 'tab') enterModelling(null);
  else if (k === 'escape') {
    if (ui.points.length || ui.edges.length || ui.faces.length) ui.set(EMPTY_SEL);
    else enterModelling(null);
  } else return false;
  return true;
}
