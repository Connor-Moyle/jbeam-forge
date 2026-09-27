import { create } from 'zustand';
import type { Project } from '@shared/project/schema';
import type { SimModel } from '@shared/sim/solver';
import { bindVertices, type SkinBinding } from '@shared/sim/skin';
import type { ImportedMesh } from '@renderer/import/normalize';

/**
 * Test Mode's view of the car's visual meshes: shown bent and moved by the
 * physics (tied to the nodes of their part), and optionally just the selected
 * part's, to watch how one piece behaves.
 */
export const useLiveView = create<{ showMesh: boolean; isolate: boolean; set: (p: Partial<{ showMesh: boolean; isolate: boolean }>) => void }>()((set) => ({
  showMesh: false,
  isolate: false,
  set: (p) => set(p),
}));

export interface LiveMeshBinding {
  key: string;
  binding: SkinBinding;
}

/** The part whose nodes a mesh follows: its own, else the nearest ancestor that has nodes in the sim. */
function nodePart(doc: Pick<Project, 'parts'>, partId: string, withNodes: ReadonlySet<string>): string | null {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  for (let cur = byId.get(partId), guard = 0; cur && guard < 64; cur = cur.parentPartId ? byId.get(cur.parentPartId) : undefined, guard++) {
    if (withNodes.has(cur.id)) return cur.id;
  }
  return null;
}

/** Tie every assigned, visible mesh to its part's nodes (once per Test Mode model). */
export function bindLiveMeshes(model: SimModel, doc: Pick<Project, 'parts' | 'nodes' | 'assignments' | 'ignoredMeshes'>, meshes: readonly ImportedMesh[], only?: ReadonlySet<string>): LiveMeshBinding[] {
  const index = new Map(model.nodeIds.map((id, i) => [id, i]));
  const byPart = new Map<string, number[]>();
  for (const n of doc.nodes) {
    const i = index.get(n.id);
    if (i === undefined) continue;
    const list = byPart.get(n.partId) ?? [];
    list.push(i);
    byPart.set(n.partId, list);
  }
  const withNodes = new Set(byPart.keys());
  const out: LiveMeshBinding[] = [];
  for (const m of meshes) {
    if (only && !only.has(m.key)) continue;
    const partId = doc.assignments[m.key];
    if (!partId || doc.ignoredMeshes.includes(m.key)) continue;
    const owner = nodePart(doc, partId, withNodes);
    const candidates = owner ? byPart.get(owner) : undefined;
    const pos = m.geometry.getAttribute('position');
    if (!candidates?.length || !pos) continue;
    out.push({ key: m.key, binding: bindVertices(pos.array, model.pos, candidates) });
  }
  return out;
}
