import type { Part } from '../project/schema';

/** Scene tree model (SPEC §4.3): part hierarchy with meshes, then unassigned, then ignored. */

export interface MeshInfo {
  key: string;
  name: string;
  triangles: number;
}

export interface PartNode {
  part: Part;
  depth: number;
  children: PartNode[];
  /** Meshes assigned to this part (filtered by the query unless the part itself matches). */
  meshes: MeshInfo[];
  /** Meshes in this part's whole subtree (unfiltered). */
  total: number;
}

export interface SceneTree {
  roots: PartNode[];
  unassigned: MeshInfo[];
  ignored: MeshInfo[];
  /** partId → its own mesh keys (unfiltered), for selection and visibility. */
  partMeshes: Map<string, string[]>;
  /** Parts to auto-expand: ancestors of query hits. */
  hitPath: Set<string>;
}

function matches(q: string, ...texts: string[]): boolean {
  return texts.some((t) => t.toLowerCase().includes(q));
}

export function buildSceneTree(
  parts: readonly Part[],
  assignments: Readonly<Record<string, string>>,
  ignoredMeshes: readonly string[],
  meshes: readonly MeshInfo[],
  query = '',
): SceneTree {
  const q = query.trim().toLowerCase();
  const byId = new Map(parts.map((p) => [p.id, p]));
  const ignored = new Set(ignoredMeshes);
  const partMeshes = new Map<string, string[]>();
  const meshesOf = new Map<string, MeshInfo[]>();
  const unassigned: MeshInfo[] = [];
  const ignoredList: MeshInfo[] = [];
  for (const m of meshes) {
    const pid = assignments[m.key];
    if (ignored.has(m.key)) ignoredList.push(m);
    else if (pid && byId.has(pid)) {
      meshesOf.set(pid, [...(meshesOf.get(pid) ?? []), m]);
      partMeshes.set(pid, [...(partMeshes.get(pid) ?? []), m.key]);
    } else unassigned.push(m);
  }

  const childrenOf = new Map<string | null, Part[]>();
  for (const p of parts) {
    const parent = p.parentPartId && byId.has(p.parentPartId) && p.parentPartId !== p.id ? p.parentPartId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), p]);
  }
  // Siblings: alphabetical by their base's name, each base followed by its variants.
  const sortKey = (p: Part) => {
    const base = p.variantOf ? byId.get(p.variantOf) : undefined;
    return `${(base ?? p).displayName.toLowerCase()}\u0000${p.variantOf ? 1 : 0}\u0000${p.displayName.toLowerCase()}`;
  };
  for (const list of childrenOf.values()) list.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  const hitPath = new Set<string>();
  const visited = new Set<string>();
  const build = (p: Part, depth: number, ancestors: string[]): PartNode | null => {
    visited.add(p.id);
    const own = meshesOf.get(p.id) ?? [];
    const selfHit = !q || matches(q, p.displayName, p.name, p.taxonomyId);
    const children: PartNode[] = [];
    let total = own.length;
    for (const c of childrenOf.get(p.id) ?? []) {
      if (visited.has(c.id)) continue; // defensive: never loop on bad data
      const node = build(c, depth + 1, [...ancestors, p.id]);
      if (node) {
        children.push(node);
        total += node.total;
      } else total += countSubtree(c);
    }
    const shownMeshes = selfHit ? own : own.filter((m) => matches(q, m.name));
    if (q && !selfHit && shownMeshes.length === 0 && children.length === 0) return null;
    if (q && (shownMeshes.length > 0 || children.length > 0 || selfHit)) for (const a of ancestors) hitPath.add(a);
    if (q && !selfHit && shownMeshes.length > 0) hitPath.add(p.id);
    return { part: p, depth, children, meshes: shownMeshes, total };
  };
  const countSubtree = (p: Part): number => {
    let n = meshesOf.get(p.id)?.length ?? 0;
    for (const c of childrenOf.get(p.id) ?? []) if (c.id !== p.id) n += countSubtree(c);
    return n;
  };

  const roots: PartNode[] = [];
  for (const p of childrenOf.get(null) ?? []) {
    const node = build(p, 0, []);
    if (node) roots.push(node);
  }
  // Parts stuck in a parent cycle (bad data) still show, at the root.
  for (const p of parts) {
    if (visited.has(p.id)) continue;
    const node = build(p, 0, []);
    if (node) roots.push(node);
  }

  const filterMeshes = (list: MeshInfo[]) => (q ? list.filter((m) => matches(q, m.name)) : list);
  return { roots, unassigned: filterMeshes(unassigned), ignored: filterMeshes(ignoredList), partMeshes, hitPath };
}

/** Ids of a part and everything below it. */
export function subtreeIds(parts: readonly Part[], rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const p of parts) if (p.parentPartId === id) stack.push(p.id);
  }
  return out;
}

/** Ancestor chain of a part, nearest first. */
export function ancestorIds(parts: readonly Part[], partId: string): string[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out: string[] = [];
  for (let cur = byId.get(partId)?.parentPartId ?? null; cur && !out.includes(cur); cur = byId.get(cur)?.parentPartId ?? null) out.push(cur);
  return out;
}
