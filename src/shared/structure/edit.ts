import { NODE_ID, type Project, type StructNode } from '../project/schema';

/**
 * Hand-editing of generated structure (Phase 7): moving nodes with symmetry
 * and soft falloff, deleting, renaming and re-weighting. Pure functions over
 * the document so they run inside undoable commands and in tests alike.
 */

type Vec3 = [number, number, number];
type Doc = Pick<Project, 'nodes' | 'beams' | 'tris' | 'proxy'>;

/** Two nodes closer than this count as the same point (mirror pairs, centre-line nodes). */
const MIRROR_TOL = 0.002;

/** A beam's identity in a selection: its endpoints, order-independent. */
export function beamKey(id1: string, id2: string): string {
  return id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`;
}

/**
 * Left/right partners: nodes at mirrored X (BeamNG's X is left-positive)
 * with the same Y and Z. Matched by position, not by name, so it works for
 * any naming scheme; the l/r suffix convention just makes it quick to read.
 */
export function mirrorPartners(nodes: readonly Pick<StructNode, 'id' | 'pos'>[]): Map<string, string> {
  const cell = (v: number) => Math.round(v / MIRROR_TOL);
  const grid = new Map<string, string[]>();
  const keyOf = (x: number, y: number, z: number) => `${cell(x)},${cell(y)},${cell(z)}`;
  const byId = new Map(nodes.map((n) => [n.id, n.pos]));
  for (const n of nodes) {
    const k = keyOf(n.pos[0], n.pos[1], n.pos[2]);
    const list = grid.get(k);
    if (list) list.push(n.id);
    else grid.set(k, [n.id]);
  }
  const out = new Map<string, string>();
  for (const n of nodes) {
    if (Math.abs(n.pos[0]) < MIRROR_TOL || out.has(n.id)) continue;
    const [x, y, z] = n.pos;
    let best: string | null = null;
    let bestD = MIRROR_TOL;
    // The mirrored point can straddle a cell boundary: look in the neighbouring cells too.
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cell(-x) + dx},${cell(y) + dy},${cell(z) + dz}`);
          for (const id of list ?? []) {
            if (id === n.id || out.has(id)) continue;
            const p = byId.get(id)!;
            const d = Math.hypot(p[0] + x, p[1] - y, p[2] - z);
            if (d <= bestD) {
              bestD = d;
              best = id;
            }
          }
        }
    if (best) {
      out.set(n.id, best);
      out.set(best, n.id);
    }
  }
  return out;
}

export interface MoveOptions {
  /** Move each node's mirror partner by the mirrored delta; centre-line nodes stay on the centre line. */
  symmetry: boolean;
  /** Soft-move radius (m); 0 = off. Nearby nodes follow with a smooth falloff. */
  softRadius: number;
  /** Soft-move only drags nodes of these parts (usually the parts being edited). */
  softParts?: ReadonlySet<string>;
}

/** Smooth 1 → 0 falloff over the radius (cosine, flat at both ends). */
export function softWeight(distance: number, radius: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * distance) / radius));
}

/**
 * Per-node displacement for moving `selected` by `delta`, including soft-move
 * followers and mirror partners. Selected nodes always move the full delta.
 */
export function planMove(nodes: readonly Pick<StructNode, 'id' | 'pos' | 'partId'>[], selected: readonly string[], delta: Vec3, opts: MoveOptions, partners?: ReadonlyMap<string, string>): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  const sel = new Set(selected);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of sel) if (byId.has(id)) out.set(id, [...delta]);

  if (opts.softRadius > 0) {
    const anchors = [...sel].map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
    for (const n of nodes) {
      if (sel.has(n.id) || (opts.softParts && !opts.softParts.has(n.partId))) continue;
      let d = Infinity;
      for (const a of anchors) d = Math.min(d, Math.hypot(n.pos[0] - a.pos[0], n.pos[1] - a.pos[1], n.pos[2] - a.pos[2]));
      const w = softWeight(d, opts.softRadius);
      if (w > 1e-4) out.set(n.id, [delta[0] * w, delta[1] * w, delta[2] * w]);
    }
  }

  if (opts.symmetry) {
    const pairs = partners ?? mirrorPartners(nodes);
    for (const [id, d] of [...out]) {
      const n = byId.get(id)!;
      if (Math.abs(n.pos[0]) < MIRROR_TOL) {
        d[0] = 0; // centre-line nodes stay on the centre line
        continue;
      }
      const twin = pairs.get(id);
      if (!twin) continue;
      const mine = out.get(twin);
      // Both sides already moving (both selected, or both inside the falloff): keep the stronger, mirrored.
      if (mine && (sel.has(twin) || Math.hypot(...mine) >= Math.hypot(...d))) continue;
      out.set(twin, [-d[0], d[1], d[2]]);
    }
  }
  return out;
}

/** Apply displacements; moved nodes are marked manual so regeneration keeps them. */
export function applyMove(doc: Pick<Project, 'nodes'>, moves: ReadonlyMap<string, Vec3>): void {
  for (const n of doc.nodes) {
    const d = moves.get(n.id);
    if (!d || (d[0] === 0 && d[1] === 0 && d[2] === 0)) continue;
    n.pos = [round(n.pos[0] + d[0]), round(n.pos[1] + d[1]), round(n.pos[2] + d[2])];
    n.manual = true;
  }
}

/** Positions after a planned move, for live preview without touching the document. */
export function movedPositions(nodes: readonly Pick<StructNode, 'id' | 'pos'>[], moves: ReadonlyMap<string, Vec3>): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const n of nodes) {
    const d = moves.get(n.id);
    if (d) out.set(n.id, [n.pos[0] + d[0], n.pos[1] + d[1], n.pos[2] + d[2]]);
  }
  return out;
}

/** Delete nodes and everything that uses them (beams, triangles). Returns how many beams/tris went with them. */
export function deleteNodes(doc: Doc, ids: readonly string[]): { nodes: number; beams: number; tris: number } {
  const gone = new Set(ids);
  const n0 = doc.nodes.length;
  const b0 = doc.beams.length;
  const t0 = doc.tris.length;
  doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
  doc.beams = doc.beams.filter((b) => !gone.has(b.id1) && !gone.has(b.id2));
  doc.tris = doc.tris.filter((t) => !t.ids.some((id) => gone.has(id)));
  return { nodes: n0 - doc.nodes.length, beams: b0 - doc.beams.length, tris: t0 - doc.tris.length };
}

/** Delete beams by key (every beam between those two nodes goes). */
export function deleteBeams(doc: Pick<Project, 'beams'>, keys: readonly string[]): number {
  const gone = new Set(keys);
  const before = doc.beams.length;
  doc.beams = doc.beams.filter((b) => !gone.has(beamKey(b.id1, b.id2)));
  return before - doc.beams.length;
}

/** Why a node id can't be used, or null when it's fine. */
export function nodeIdProblem(doc: Pick<Project, 'nodes'>, oldId: string, newId: string): string | null {
  if (!NODE_ID.test(newId)) return 'Node ids start with a letter and use only letters, digits and _.';
  if (newId !== oldId && doc.nodes.some((n) => n.id === newId)) return `There's already a node called ${newId}.`;
  return null;
}

/** Rename a node and every reference to it: beams, triangles and the reference nodes. */
export function renameNode(doc: Doc, oldId: string, newId: string): void {
  const problem = nodeIdProblem(doc, oldId, newId);
  if (problem) throw new Error(problem);
  if (oldId === newId) return;
  for (const n of doc.nodes) if (n.id === oldId) n.id = newId;
  for (const b of doc.beams) {
    if (b.id1 === oldId) b.id1 = newId;
    if (b.id2 === oldId) b.id2 = newId;
  }
  for (const t of doc.tris) t.ids = t.ids.map((id) => (id === oldId ? newId : id)) as typeof t.ids;
  const ref = doc.proxy.refNodes;
  if (ref) for (const k of Object.keys(ref) as (keyof typeof ref)[]) if (ref[k] === oldId) ref[k] = newId;
}

export function setNodeWeights(doc: Pick<Project, 'nodes'>, ids: readonly string[], weight: number): void {
  const set = new Set(ids);
  for (const n of doc.nodes) if (set.has(n.id)) n.weight = weight;
}

/** Set one axis of each node's position (typing an exact coordinate for a selection). */
export function setNodeAxis(doc: Pick<Project, 'nodes'>, ids: readonly string[], axis: 0 | 1 | 2, value: number): void {
  const set = new Set(ids);
  for (const n of doc.nodes) {
    if (!set.has(n.id) || n.pos[axis] === value) continue;
    const pos: Vec3 = [...n.pos];
    pos[axis] = round(value);
    n.pos = pos;
    n.manual = true;
  }
}

export function centroid(nodes: readonly Pick<StructNode, 'pos'>[]): Vec3 {
  if (!nodes.length) return [0, 0, 0];
  const c: Vec3 = [0, 0, 0];
  for (const n of nodes) for (let i = 0; i < 3; i++) c[i]! += n.pos[i]!;
  return [c[0] / nodes.length, c[1] / nodes.length, c[2] / nodes.length];
}

/** Millimetre-ish precision keeps saved files tidy and diffs readable. */
function round(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}
