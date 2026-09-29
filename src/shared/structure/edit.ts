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

// ---------------------------------------------------------------- topology

/** A free node id: `base` plus the lowest number not taken ("dr" → dr12). */
export function uniqueNodeId(doc: Pick<Project, 'nodes'>, base: string): string {
  const taken = new Set(doc.nodes.map((n) => n.id));
  const stem = base.replace(/\d+[a-z]?$/i, '') || 'n';
  for (let i = 1; ; i++) if (!taken.has(`${stem}${i}`)) return `${stem}${i}`;
}

/**
 * Connect nodes with beams in the order given (a chain: a-b, b-c…). Beams
 * between two parts become attachment beams owned by the first node's part.
 * Existing beams are left alone. Returns how many were added.
 */
export function connectNodes(doc: Pick<Project, 'nodes' | 'beams'>, ids: readonly string[]): number {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const have = new Set(doc.beams.map((b) => beamKey(b.id1, b.id2)));
  let added = 0;
  for (let i = 0; i + 1 < ids.length; i++) {
    const a = byId.get(ids[i]!);
    const b = byId.get(ids[i + 1]!);
    if (!a || !b || a.id === b.id || have.has(beamKey(a.id, b.id))) continue;
    doc.beams.push({ id1: a.id, id2: b.id, partId: a.partId, kind: a.partId === b.partId ? 'edge' : 'attach' });
    have.add(beamKey(a.id, b.id));
    added++;
  }
  return added;
}

/** Split beams at their midpoints: a new node in the middle, the beam becomes two. Returns the new node ids. */
export function splitBeams(doc: Pick<Project, 'nodes' | 'beams'>, keys: readonly string[]): string[] {
  const want = new Set(keys);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const created: string[] = [];
  const next: typeof doc.beams = [];
  const done = new Set<string>();
  for (const b of doc.beams) {
    const key = beamKey(b.id1, b.id2);
    const a = byId.get(b.id1);
    const c = byId.get(b.id2);
    if (!want.has(key) || !a || !c) {
      next.push(b);
      continue;
    }
    if (done.has(key)) continue; // a duplicate beam on a pair already split
    done.add(key);
    const owner = a.partId === b.partId ? a : c;
    const id = uniqueNodeId(doc, owner.id);
    const node = { id, partId: b.partId, pos: [round((a.pos[0] + c.pos[0]) / 2), round((a.pos[1] + c.pos[1]) / 2), round((a.pos[2] + c.pos[2]) / 2)] as Vec3, weight: round((a.weight + c.weight) / 2), manual: true };
    doc.nodes.push(node);
    byId.set(id, node);
    created.push(id);
    next.push({ ...b, id2: id }, { ...b, id1: id });
  }
  doc.beams = next;
  return created;
}

/**
 * Merge nodes into the first one: it moves to their centre and takes their
 * combined weight; every beam and triangle follows, and beams or triangles
 * that collapse (both ends on the kept node, or repeats) are dropped.
 */
export function mergeNodes(doc: Doc, ids: readonly string[]): string | null {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const group = ids.map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
  if (group.length < 2) return null;
  const keep = group[0]!;
  const gone = new Set(group.slice(1).map((n) => n.id));
  const c = centroid(group);
  keep.pos = [round(c[0]), round(c[1]), round(c[2])];
  keep.weight = round(group.reduce((m, n) => m + n.weight, 0));
  keep.manual = true;
  const to = (id: string) => (gone.has(id) ? keep.id : id);
  doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
  const seen = new Set<string>();
  doc.beams = doc.beams
    .map((b) => ({ ...b, id1: to(b.id1), id2: to(b.id2) }))
    .filter((b) => {
      const key = `${beamKey(b.id1, b.id2)}|${b.kind}`;
      if (b.id1 === b.id2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  doc.tris = doc.tris.map((t) => ({ ...t, ids: t.ids.map(to) as typeof t.ids })).filter((t) => new Set(t.ids).size === 3);
  const ref = doc.proxy.refNodes;
  if (ref) for (const k of Object.keys(ref) as (keyof typeof ref)[]) ref[k] = to(ref[k]);
  return keep.id;
}

// ---------------------------------------------------------------- regeneration

/** How far a hand-moved node may be from a regenerated one and still take its place (m). */
export const ADOPT_REACH = 0.15;

/**
 * Regenerating a part keeps the nodes you moved by hand: each one replaces the
 * freshly generated node with the same id, or else the nearest one within
 * reach, and inherits its beams and triangles. Mutates `derived`. Returns how
 * many were reconnected and how many were left standing on their own.
 */
export function adoptManualNodes(derived: { nodes: StructNode[]; beams: { id1: string; id2: string }[]; tris: { ids: [string, string, string] }[] }, manual: readonly StructNode[], reach = ADOPT_REACH): { kept: number; loose: number } {
  const rename = new Map<string, string>();
  const replaced = new Set<string>();
  let loose = 0;
  for (const m of manual) {
    let target = derived.nodes.find((n) => n.id === m.id && !replaced.has(n.id));
    if (!target) {
      let bestD = reach;
      for (const n of derived.nodes) {
        if (replaced.has(n.id) || manual.some((o) => o.id === n.id)) continue;
        const d = Math.hypot(n.pos[0] - m.pos[0], n.pos[1] - m.pos[1], n.pos[2] - m.pos[2]);
        if (d <= bestD) {
          bestD = d;
          target = n;
        }
      }
    }
    if (!target) {
      loose++;
      continue;
    }
    replaced.add(target.id);
    if (target.id !== m.id) rename.set(target.id, m.id);
  }
  derived.nodes = derived.nodes.filter((n) => !replaced.has(n.id));
  const to = (id: string) => rename.get(id) ?? id;
  for (const b of derived.beams) {
    b.id1 = to(b.id1);
    b.id2 = to(b.id2);
  }
  for (const t of derived.tris) t.ids = t.ids.map(to) as [string, string, string];
  return { kept: manual.length - loose, loose };
}

/** The mirror-side name of a node: BeamNG's l/r ending swapped ("f3l" → "f3r"), else "…m". */
export function mirrorName(id: string): string {
  if (/l$/i.test(id)) return id.replace(/l$/, 'r').replace(/L$/, 'R');
  if (/r$/i.test(id)) return id.replace(/r$/, 'l').replace(/R$/, 'L');
  return `${id}m`;
}

/**
 * Copy nodes to the other side of the car (X mirrored), with the beams
 * between them. Nodes on the centre line, and ones that already have a
 * partner there, are skipped. Returns the new node ids.
 */
export function mirrorNodes(doc: Pick<Project, 'nodes' | 'beams'>, ids: readonly string[]): string[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const partners = mirrorPartners(doc.nodes);
  const map = new Map<string, string>();
  const created: string[] = [];
  const taken = new Set(doc.nodes.map((n) => n.id));
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (Math.abs(n.pos[0]) < MIRROR_TOL) {
      map.set(id, id);
      continue;
    }
    const partner = partners.get(id);
    if (partner) {
      map.set(id, partner);
      continue;
    }
    let name = mirrorName(id);
    if (taken.has(name)) name = uniqueNodeId({ nodes: [...taken].map((t) => ({ id: t }) as StructNode) }, name);
    taken.add(name);
    const copy: StructNode = { ...n, id: name, pos: [round(-n.pos[0]), n.pos[1], n.pos[2]], manual: true };
    doc.nodes.push(copy);
    map.set(id, name);
    created.push(name);
  }
  const have = new Set(doc.beams.map((b) => beamKey(b.id1, b.id2)));
  for (const b of [...doc.beams]) {
    const a = map.get(b.id1);
    const c = map.get(b.id2);
    if (!a || !c || (a === b.id1 && c === b.id2)) continue;
    const key = beamKey(a, c);
    if (have.has(key) || a === c) continue;
    doc.beams.push({ ...b, id1: a, id2: c });
    have.add(key);
  }
  return created;
}

/** A new node for a part at a position (named after the part's nodes); returns its id. */
export function addNode(doc: Pick<Project, 'nodes'>, partId: string, pos: Vec3, weight?: number): string {
  const same = doc.nodes.filter((n) => n.partId === partId);
  const stem = same[0]?.id.replace(/\d+[a-z]?$/i, '') || 'n';
  const id = uniqueNodeId(doc, stem);
  const w = weight ?? (same.length ? same.reduce((s, n) => s + n.weight, 0) / same.length : 1);
  doc.nodes.push({ id, partId, pos: [round(pos[0]), round(pos[1]), round(pos[2])], weight: w, manual: true });
  return id;
}
