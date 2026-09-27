import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import * as edit from '@shared/structure/edit';
import { useEditStore, type Vec3 } from './editStore';

/** Undoable structure edits (each is one history entry) driven by edit mode. */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Parts whose nodes soft-move may drag: the selected nodes' own parts. */
function softParts(ids: readonly string[]): Set<string> {
  const doc = projectStore.getState().doc;
  const want = new Set(ids);
  return new Set((doc?.nodes ?? []).filter((n) => want.has(n.id)).map((n) => n.partId));
}

/** The full displacement a move of the selection by `delta` causes (symmetry and soft-move included). */
export function planSelectionMove(delta: Vec3): Map<string, Vec3> {
  const doc = projectStore.getState().doc;
  const e = useEditStore.getState();
  if (!doc || !e.nodes.length) return new Map();
  return edit.planMove(doc.nodes, e.nodes, delta, { symmetry: e.symmetry, softRadius: e.soft ? e.softRadius : 0, softParts: softParts(e.nodes) });
}

export function moveSelection(delta: Vec3, label = 'Move nodes'): void {
  const moves = planSelectionMove(delta);
  if (!moves.size) return;
  projectStore.getState().execute({ label: `${label} (${plural(moves.size, 'node')})`, apply: (d) => edit.applyMove(d, moves) });
}

/** Live drag preview: where every affected node would be. */
export function previewSelectionMove(delta: Vec3 | null): void {
  const doc = projectStore.getState().doc;
  if (!doc || !delta) {
    useEditStore.getState().setPreview(null);
    return;
  }
  useEditStore.getState().setPreview(edit.movedPositions(doc.nodes, planSelectionMove(delta)));
}

export function deleteSelection(): void {
  const e = useEditStore.getState();
  if (!e.nodes.length && !e.beams.length) return;
  let result = { nodes: 0, beams: 0, tris: 0 };
  projectStore.getState().execute({
    label: e.nodes.length ? `Delete ${plural(e.nodes.length, 'node')}` : `Delete ${plural(e.beams.length, 'beam')}`,
    apply: (d) => {
      const beams = edit.deleteBeams(d, e.beams);
      result = edit.deleteNodes(d, e.nodes);
      result.beams += beams;
    },
  });
  e.clear();
  const extra = [result.beams && plural(result.beams, 'beam'), result.tris && plural(result.tris, 'triangle')].filter(Boolean).join(' and ');
  useUiStore.getState().pushStatus(`Deleted ${result.nodes ? plural(result.nodes, 'node') : ''}${result.nodes && extra ? ', with ' : ''}${extra}`.trim());
}

export function renameNode(oldId: string, newId: string): string | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const problem = edit.nodeIdProblem(doc, oldId, newId);
  if (problem) return problem;
  projectStore.getState().execute({ label: `Rename node ${oldId} → ${newId}`, apply: (d) => edit.renameNode(d, oldId, newId) });
  const e = useEditStore.getState();
  e.select(e.nodes.map((id) => (id === oldId ? newId : id)), e.beams);
  return null;
}

export function setWeight(ids: readonly string[], weight: number): void {
  projectStore.getState().execute({ label: `Set weight of ${plural(ids.length, 'node')}`, apply: (d) => edit.setNodeWeights(d, ids, weight) });
}

/** Type an exact coordinate: one node goes there; several move together so their centre does. */
export function setAxis(ids: readonly string[], axis: 0 | 1 | 2, value: number): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  if (ids.length === 1) {
    projectStore.getState().execute({ label: `Move node ${ids[0]}`, apply: (d) => edit.setNodeAxis(d, ids, axis, value) });
    return;
  }
  const want = new Set(ids);
  const c = edit.centroid(doc.nodes.filter((n) => want.has(n.id)));
  const delta: Vec3 = [0, 0, 0];
  delta[axis] = value - c[axis];
  moveSelection(delta);
}

/** Every node that's currently editable: the focused parts' nodes in focus mode, else all. */
export function editableNodeIds(): string[] {
  const doc = projectStore.getState().doc;
  const focus = useSceneStore.getState().focus;
  const only = focus?.partId ? new Set(focus.parts) : null;
  return (doc?.nodes ?? []).filter((n) => !only || only.has(n.partId)).map((n) => n.id);
}

export function selectAll(): void {
  useEditStore.getState().select(editableNodeIds(), []);
}

/** Select every node of the parts the current selection touches. */
export function selectParts(): void {
  const doc = projectStore.getState().doc;
  const parts = softParts(useEditStore.getState().nodes);
  useEditStore.getState().select((doc?.nodes ?? []).filter((n) => parts.has(n.partId)).map((n) => n.id), []);
}

/** Grow the selection to every node connected to it by beams (within its parts). */
export function selectConnected(): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const parts = softParts(useEditStore.getState().nodes);
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const b of doc.beams) {
    if (!parts.has(b.partId) || b.kind === 'attach') continue;
    link(b.id1, b.id2);
    link(b.id2, b.id1);
  }
  const seen = new Set(useEditStore.getState().nodes);
  const stack = [...seen];
  while (stack.length) {
    for (const n of adj.get(stack.pop()!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  useEditStore.getState().select([...seen], []);
}

export function invertSelection(): void {
  const cur = new Set(useEditStore.getState().nodes);
  useEditStore.getState().select(editableNodeIds().filter((id) => !cur.has(id)), []);
}

/** B: beams between the selected nodes, in the order they were picked. */
export function connectSelection(): void {
  const ids = useEditStore.getState().nodes;
  if (ids.length < 2) return;
  let added = 0;
  projectStore.getState().execute({
    label: 'Add beams',
    apply: (d) => {
      added = edit.connectNodes(d, ids);
    },
  });
  useUiStore.getState().pushStatus(added ? `Added ${plural(added, 'beam')}` : 'Those nodes are already connected');
}

/** M: merge the selected nodes into the first one picked. */
export function mergeSelection(): void {
  const ids = useEditStore.getState().nodes;
  if (ids.length < 2) return;
  let kept: string | null = null;
  projectStore.getState().execute({
    label: `Merge ${plural(ids.length, 'node')}`,
    apply: (d) => {
      kept = edit.mergeNodes(d, ids);
    },
  });
  if (kept) useEditStore.getState().select([kept], []);
}

/** D: split the selected beams at their midpoints and select the new nodes. */
export function splitSelectedBeams(): void {
  const keys = useEditStore.getState().beams;
  if (!keys.length) return;
  let created: string[] = [];
  projectStore.getState().execute({
    label: `Split ${plural(keys.length, 'beam')}`,
    apply: (d) => {
      created = edit.splitBeams(d, keys);
    },
  });
  useEditStore.getState().select(created, []);
}
