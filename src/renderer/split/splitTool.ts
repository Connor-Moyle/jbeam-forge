import { create } from 'zustand';
import type { BufferGeometry } from 'three';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { useAssignUi } from '@renderer/parts/assignUi';
import type { ImportedMesh } from '@renderer/import/normalize';
import { connectedComponents, planeSide, type Index } from '@shared/mesh/split';
import { addSplit, removeSplit, splitProducing, splitResultKey, uniqueMeshName } from '@shared/mesh/splitOps';
import { EMPTY_ARR } from '@shared/empty';

/**
 * Mesh splitting UI state and commands (SPEC §4.2). The face-selection tool
 * works on one mesh at a time; the viewport reads this store to route pointer
 * input (box / lasso / paint / fill) and draw the selected triangles.
 */

export const SPLIT_MODES = ['box', 'lasso', 'paint', 'fill', 'plane'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];
export type SelectOp = 'replace' | 'add' | 'subtract';
export type PlaneAxis = 'x' | 'y' | 'z';

export interface PlaneState {
  axis: PlaneAxis;
  /** Position along the axis (BeamNG space, metres). */
  offset: number;
  flip: boolean;
}

interface SplitToolState {
  meshKey: string | null;
  mode: SplitMode;
  /** Selected triangle indices of the target mesh (sorted). */
  selected: readonly number[];
  angleDeg: number;
  /** Paint brush radius (metres). */
  radius: number;
  plane: PlaneState;
  start: (meshKey: string) => void;
  cancel: () => void;
  setMode: (mode: SplitMode) => void;
  setAngle: (deg: number) => void;
  setRadius: (r: number) => void;
  setPlane: (p: Partial<PlaneState>) => void;
  select: (triangles: readonly number[], op: SelectOp) => void;
}

export const useSplitTool = create<SplitToolState>()((set, get) => ({
  meshKey: null,
  mode: 'fill',
  selected: EMPTY_ARR,
  angleDeg: 30,
  radius: 0.15,
  plane: { axis: 'x', offset: 0, flip: false },
  start: (meshKey) => {
    const mesh = findMesh(meshKey);
    const center = mesh ? boundsCenter(mesh.geometry) : [0, 0, 0];
    set({ meshKey, selected: EMPTY_ARR, plane: { ...get().plane, offset: center[axisIndex(get().plane.axis)]! } });
    useSceneStore.getState().select([meshKey]);
  },
  cancel: () => set({ meshKey: null, selected: EMPTY_ARR }),
  setMode: (mode) => {
    set({ mode });
    if (mode === 'plane') get().setPlane({});
  },
  setAngle: (angleDeg) => set({ angleDeg }),
  setRadius: (radius) => set({ radius }),
  setPlane: (p) => {
    const plane = { ...get().plane, ...p };
    const { meshKey } = get();
    const mesh = meshKey ? findMesh(meshKey) : undefined;
    if (p.axis && mesh) plane.offset = boundsCenter(mesh.geometry)[axisIndex(p.axis)]!;
    set({ plane });
    if (get().mode === 'plane' && mesh) set({ selected: planeSelection(mesh.geometry, plane) });
  },
  select: (triangles, op) =>
    set((s) => {
      if (op === 'replace') return { selected: [...new Set(triangles)].sort((a, b) => a - b) };
      const cur = new Set(s.selected);
      for (const t of triangles) {
        if (op === 'add') cur.add(t);
        else cur.delete(t);
      }
      return { selected: [...cur].sort((a, b) => a - b) };
    }),
}));

// The tool's triangle numbers belong to one geometry: if the mesh goes away (undo,
// project closed) the tool closes; if it is re-derived (another split), the selection clears.
let toolGeometry: BufferGeometry | null = null;
useSceneStore.subscribe(() => {
  const { meshKey, selected } = useSplitTool.getState();
  if (!meshKey) {
    toolGeometry = null;
    return;
  }
  const mesh = findMesh(meshKey);
  if (!mesh) {
    useSplitTool.getState().cancel();
    return;
  }
  if (toolGeometry && toolGeometry !== mesh.geometry && selected.length) useSplitTool.setState({ selected: EMPTY_ARR });
  toolGeometry = mesh.geometry;
});

export function axisIndex(axis: PlaneAxis): number {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

export function boundsCenter(g: BufferGeometry): [number, number, number] {
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox!;
  return [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
}

export function boundsRange(g: BufferGeometry, axis: PlaneAxis): [number, number] {
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox!;
  const k = axisIndex(axis);
  return [b.min.getComponent(k), b.max.getComponent(k)];
}

export function geometryArrays(g: BufferGeometry): { positions: ArrayLike<number>; index: Index } {
  const positions = g.getAttribute('position').array;
  if (g.index) return { positions, index: g.index.array };
  const n = g.getAttribute('position').count;
  const index = new Uint32Array(n - (n % 3));
  for (let i = 0; i < index.length; i++) index[i] = i;
  return { positions, index };
}

function planeSelection(g: BufferGeometry, plane: PlaneState): number[] {
  const { positions, index } = geometryArrays(g);
  const normal: [number, number, number] = [0, 0, 0];
  normal[axisIndex(plane.axis)] = plane.flip ? -1 : 1;
  const point: [number, number, number] = [0, 0, 0];
  point[axisIndex(plane.axis)] = plane.offset;
  return planeSide(positions, index, point, normal);
}

export function findMesh(meshKey: string): ImportedMesh | undefined {
  for (const s of Object.values(useSceneStore.getState().sources)) {
    const m = s.meshes.find((x) => x.key === meshKey);
    if (m) return m;
  }
  return undefined;
}

function meshNames(): string[] {
  return Object.values(useSceneStore.getState().sources).flatMap((s) => s.meshes.map((m) => m.name));
}

// ---------------------------------------------------------------- commands

/** Split the selected triangles off the tool's mesh into a new mesh, then offer to assign it. */
export function applySplitSelection(): string | null {
  const { meshKey, selected } = useSplitTool.getState();
  const mesh = meshKey ? findMesh(meshKey) : undefined;
  if (!mesh || selected.length === 0) return null;
  if (selected.length >= mesh.triangles) {
    useUiStore.getState().pushStatus('That selects the whole mesh — nothing to split off.', 'warning');
    return null;
  }
  let key: string | null = null;
  projectStore.getState().execute({
    label: `Split ${selected.length} triangles off ${mesh.name}`,
    apply: (d) => {
      const s = addSplit(d, { meshKey: mesh.key, name: uniqueMeshName(`${mesh.name}_split`, meshNames()), triangles: selected });
      key = splitResultKey(s);
    },
  });
  useSplitTool.getState().cancel();
  if (key) {
    useSceneStore.getState().select([key]);
    useAssignUi.getState().openAssign([key]); // split results flow straight into assignment
  }
  return key;
}

/** One-click split into connected pieces; the largest piece stays as the original mesh. Returns new keys. */
export function splitConnected(meshKey: string): string[] {
  const mesh = findMesh(meshKey);
  if (!mesh) return [];
  const started = performance.now();
  const { positions, index } = geometryArrays(mesh.geometry);
  const pieces = connectedComponents(positions, index);
  if (pieces.length < 2) {
    useUiStore.getState().pushStatus(`${mesh.name} is already a single connected piece.`, 'info');
    return [];
  }
  const keys: string[] = [];
  const names = meshNames();
  projectStore.getState().execute({
    label: `Split ${mesh.name} into ${pieces.length} pieces`,
    apply: (d) => {
      const renumber = sequentialRenumber(mesh.triangles);
      pieces.slice(1).forEach((tris, i) => {
        const name = uniqueMeshName(`${mesh.name}_piece${i + 2}`, names);
        names.push(name);
        keys.push(splitResultKey(addSplit(d, { meshKey: mesh.key, name, triangles: renumber(tris) })));
      });
    },
  });
  useSceneStore.getState().select(keys);
  useUiStore.getState().pushStatus(`Split ${mesh.name} into ${pieces.length} pieces in ${Math.round(performance.now() - started)} ms. Assign the new pieces from the Scene tree.`, 'success');
  return keys;
}

/**
 * Splits of one mesh apply in order, each numbering triangles within what the
 * previous ones left. Given original triangle ids of successive pieces, this
 * returns their ids in the remainder at that point (Fenwick tree, O(n log n)).
 */
export function sequentialRenumber(total: number): (original: readonly number[]) => number[] {
  const tree = new Uint32Array(total + 1);
  const add = (i: number) => {
    for (let x = i + 1; x <= total; x += x & -x) tree[x]!++;
  };
  const removedBefore = (i: number) => {
    let sum = 0;
    for (let x = i; x > 0; x -= x & -x) sum += tree[x]!;
    return sum;
  };
  return (original) => {
    const mapped = original.map((t) => t - removedBefore(t));
    for (const t of original) add(t);
    return mapped;
  };
}

/** Merge a split result back into the mesh it came from (and any splits made from it). */
export function unsplit(meshKey: string): boolean {
  const doc = projectStore.getState().doc;
  const split = doc && splitProducing(doc, meshKey);
  if (!split) return false;
  projectStore.getState().execute({ label: `Merge ${split.name} back`, apply: (d) => void removeSplit(d, split.id) });
  return true;
}

export function isSplitResult(meshKey: string): boolean {
  const doc = projectStore.getState().doc;
  return !!doc && !!splitProducing(doc, meshKey);
}
