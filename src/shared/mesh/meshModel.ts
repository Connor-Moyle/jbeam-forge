import type { MeshModel } from '@shared/project/schema';

/**
 * Modelling (fork): reshaping a mesh in the app, Blender-style. A mesh's
 * corners (three per triangle) are welded by position into points; edits
 * move points, add new ones, turn or delete triangles and add new ones.
 * Deleted triangles stay in the list, empty, so every other triangle keeps
 * its number (painted faces, material groups and splits refer to them).
 *
 * Pure maths on plain arrays: the renderer builds geometry from it
 * (src/renderer/modelling/build.ts) and the viewport draws and picks with it.
 */

export type V3 = [number, number, number];

/** A mesh's corners welded into points. */
export interface Topology {
  /** Corner → point. */
  pointOf: Int32Array;
  /** Point positions, xyz. */
  points: Float32Array;
  pointCount: number;
  triCount: number;
}

/** Corners closer than this (metres) are one point. */
const WELD = 1e-5;

/** Weld a triangle soup (xyz per corner, three corners per triangle). Points are numbered in the order they first appear. */
export function weld(positions: ArrayLike<number>): Topology {
  const corners = Math.floor(positions.length / 3);
  const pointOf = new Int32Array(corners);
  const ids = new Map<string, number>();
  const pts: number[] = [];
  for (let c = 0; c < corners; c++) {
    const x = positions[c * 3]!;
    const y = positions[c * 3 + 1]!;
    const z = positions[c * 3 + 2]!;
    const k = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = pts.length / 3;
      ids.set(k, id);
      pts.push(x, y, z);
    }
    pointOf[c] = id;
  }
  return { pointOf, points: Float32Array.from(pts), pointCount: pts.length / 3, triCount: Math.floor(corners / 3) };
}

export function emptyModel(topo: Topology): MeshModel {
  return { base: { tris: topo.triCount, points: topo.pointCount }, moved: {}, points: [], rewire: {}, removed: [], flipped: [], added: [] };
}

/** Do the edits still fit the mesh (same triangles and points as when they were made)? */
export function modelFits(topo: Topology, model: MeshModel): boolean {
  return model.base.tris === topo.triCount && model.base.points === topo.pointCount;
}

/** A mesh with its edits applied, as points and triangles. */
export interface Shape {
  /** Every point (the file's, then new ones), xyz, edits applied. */
  points: Float32Array;
  /** Corner → point, for every triangle (the file's, then added ones), turned triangles already turned. */
  corners: Int32Array;
  /** Triangles deleted (still in the list). */
  removed: Uint8Array;
  triCount: number;
  /** Triangles in the file (added ones come after). */
  baseTris: number;
  /** Triangles turned round (their corners 1 and 2 swapped). */
  flipped: Uint8Array;
}

export function shapeOf(topo: Topology, model: MeshModel | undefined): Shape {
  const m = model && modelFits(topo, model) ? model : null;
  const extra = m?.points.length ?? 0;
  const points = new Float32Array((topo.pointCount + extra) * 3);
  points.set(topo.points);
  if (m) {
    m.points.forEach((p, i) => points.set(p, (topo.pointCount + i) * 3));
    for (const [id, p] of Object.entries(m.moved)) {
      const i = Number(id);
      if (i < topo.pointCount + extra) points.set(p, i * 3);
    }
  }
  const added = m?.added ?? [];
  const triCount = topo.triCount + added.length;
  const corners = new Int32Array(triCount * 3);
  corners.set(topo.pointOf.subarray(0, topo.triCount * 3));
  added.forEach((t, i) => corners.set(t.p, (topo.triCount + i) * 3));
  if (m) for (const [c, p] of Object.entries(m.rewire)) if (Number(c) < corners.length) corners[Number(c)] = p;
  const removed = new Uint8Array(triCount);
  const flipped = new Uint8Array(triCount);
  for (const t of m?.removed ?? []) if (t < triCount) removed[t] = 1;
  for (const t of m?.flipped ?? []) {
    if (t >= triCount) continue;
    flipped[t] = flipped[t]! ^ 1;
  }
  for (let t = 0; t < triCount; t++) {
    if (!flipped[t]) continue;
    const a = corners[t * 3 + 1]!;
    corners[t * 3 + 1] = corners[t * 3 + 2]!;
    corners[t * 3 + 2] = a;
  }
  return { points, corners, removed, triCount, baseTris: topo.triCount, flipped };
}

export const pointAt = (s: Shape, p: number): V3 => [s.points[p * 3]!, s.points[p * 3 + 1]!, s.points[p * 3 + 2]!];

/** Edges of the live triangles, each once, as [low, high] point pairs. */
export function edgesOf(s: Shape): Int32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  const n = s.points.length / 3;
  for (let t = 0; t < s.triCount; t++) {
    if (s.removed[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = s.corners[t * 3 + k]!;
      const b = s.corners[t * 3 + ((k + 1) % 3)]!;
      if (a === b) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * n + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(lo, hi);
    }
  }
  return Int32Array.from(out);
}

/** Points used by live triangles. */
export function livePoints(s: Shape): Uint8Array {
  const live = new Uint8Array(s.points.length / 3);
  for (let t = 0; t < s.triCount; t++) if (!s.removed[t]) for (let k = 0; k < 3; k++) live[s.corners[t * 3 + k]!] = 1;
  return live;
}

/** Points of these triangles. */
export function pointsOfFaces(s: Shape, faces: Iterable<number>): number[] {
  const out = new Set<number>();
  for (const t of faces) for (let k = 0; k < 3; k++) out.add(s.corners[t * 3 + k]!);
  return [...out];
}

/** Live triangles whose every corner is in `points` (what a vertex/edge selection covers). */
export function facesWithin(s: Shape, points: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let t = 0; t < s.triCount; t++) {
    if (s.removed[t]) continue;
    if (points.has(s.corners[t * 3]!) && points.has(s.corners[t * 3 + 1]!) && points.has(s.corners[t * 3 + 2]!)) out.push(t);
  }
  return out;
}

/** Live triangles touching any of `points`. */
export function facesTouching(s: Shape, points: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let t = 0; t < s.triCount; t++) {
    if (s.removed[t]) continue;
    if (points.has(s.corners[t * 3]!) || points.has(s.corners[t * 3 + 1]!) || points.has(s.corners[t * 3 + 2]!)) out.push(t);
  }
  return out;
}

/** Everything joined to the starting triangles through shared points (Blender's Select Linked). */
export function linkedFaces(s: Shape, start: Iterable<number>): number[] {
  const byPoint = new Map<number, number[]>();
  for (let t = 0; t < s.triCount; t++) {
    if (s.removed[t]) continue;
    for (let k = 0; k < 3; k++) {
      const p = s.corners[t * 3 + k]!;
      let list = byPoint.get(p);
      if (!list) byPoint.set(p, (list = []));
      list.push(t);
    }
  }
  const seen = new Set<number>();
  const stack = [...start].filter((t) => !s.removed[t]);
  for (const t of stack) seen.add(t);
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++)
      for (const n of byPoint.get(s.corners[t * 3 + k]!) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
  }
  return [...seen].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ edits (each returns a new model)

const copy = (m: MeshModel): MeshModel => ({ base: { ...m.base }, moved: { ...m.moved }, points: m.points.map((p) => [...p] as V3), rewire: { ...m.rewire }, removed: [...m.removed], flipped: [...m.flipped], added: m.added.map((a) => ({ p: [...a.p] as V3, like: a.like })) });

/** Put points at new places (model space). */
export function movePoints(model: MeshModel, moves: ReadonlyMap<number, V3>): MeshModel {
  const m = copy(model);
  for (const [p, pos] of moves) {
    if (p >= m.base.points) m.points[p - m.base.points] = [...pos];
    else m.moved[String(p)] = [...pos];
  }
  return m;
}

export function removeFaces(model: MeshModel, faces: Iterable<number>): MeshModel {
  const m = copy(model);
  const set = new Set(m.removed);
  for (const t of faces) set.add(t);
  m.removed = [...set].sort((a, b) => a - b);
  return m;
}

/** Turn triangles to face the other way (again = back). */
export function flipFaces(model: MeshModel, faces: Iterable<number>): MeshModel {
  const m = copy(model);
  const set = new Set(m.flipped);
  for (const t of faces) {
    if (set.has(t)) set.delete(t);
    else set.add(t);
  }
  m.flipped = [...set].sort((a, b) => a - b);
  return m;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

export function faceNormal(s: Shape, t: number): V3 {
  const a = pointAt(s, s.corners[t * 3]!);
  const n = cross(sub(pointAt(s, s.corners[t * 3 + 1]!), a), sub(pointAt(s, s.corners[t * 3 + 2]!), a));
  const l = len(n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** The middle of the live mesh's points (to turn new faces outwards). */
function middle(s: Shape): V3 {
  const live = livePoints(s);
  const c: V3 = [0, 0, 0];
  let n = 0;
  for (let p = 0; p < live.length; p++) {
    if (!live[p]) continue;
    c[0] += s.points[p * 3]!;
    c[1] += s.points[p * 3 + 1]!;
    c[2] += s.points[p * 3 + 2]!;
    n++;
  }
  return n ? [c[0] / n, c[1] / n, c[2] / n] : c;
}

/** The live triangle nearest these points, for a new face's material. */
function neighbour(s: Shape, points: readonly number[]): number {
  const want = new Set(points);
  let best = 0;
  let score = -1;
  for (let t = 0; t < s.triCount; t++) {
    if (s.removed[t]) continue;
    let k = 0;
    for (let j = 0; j < 3; j++) if (want.has(s.corners[t * 3 + j]!)) k++;
    if (k > score) {
      score = k;
      best = t;
    }
    if (k === 3) break;
  }
  return best;
}

/**
 * Fill (Blender's F): a face through 3 or 4 points (4 go round their middle
 * in order), turned to face away from the middle of the mesh. Returns the
 * new model and the new triangles' numbers.
 */
export function fill(model: MeshModel, s: Shape, picked: readonly number[]): { model: MeshModel; faces: number[] } | null {
  const pts = [...new Set(picked)];
  if (pts.length < 3 || pts.length > 4) return null;
  const pos = pts.map((p) => pointAt(s, p));
  const c: V3 = [0, 0, 0];
  for (const p of pos) for (let k = 0; k < 3; k++) c[k] = c[k]! + p[k]! / pos.length;
  // The plane's normal, then order the points round it.
  let n = cross(sub(pos[1]!, pos[0]!), sub(pos[2]!, pos[0]!));
  if (pos.length === 4) {
    const n2 = cross(sub(pos[2]!, pos[0]!), sub(pos[3]!, pos[0]!));
    if (len(n2) > len(n)) n = n2;
  }
  if (len(n) < 1e-12) return null;
  const u = sub(pos[0]!, c);
  const w = cross(n, u);
  const order = pts.map((p, i) => ({ p, a: Math.atan2(dot(sub(pos[i]!, c), w), dot(sub(pos[i]!, c), u)) })).sort((a, b) => a.a - b.a).map((x) => x.p);
  // Outwards: away from the mesh's middle.
  const out = dot(n, sub(c, middle(s))) >= 0;
  const ring = out ? order : [...order].reverse();
  const like = neighbour(s, ring);
  const m = copy(model);
  const first = s.triCount;
  m.added.push({ p: [ring[0]!, ring[1]!, ring[2]!], like });
  if (ring.length === 4) m.added.push({ p: [ring[0]!, ring[2]!, ring[3]!], like });
  return { model: m, faces: ring.length === 4 ? [first, first + 1] : [first] };
}

/**
 * Extrude (Blender's E). Faces: the picked triangles are lifted onto new
 * points (a little along their normal) with walls joining them to where
 * they were. Edges (no faces): each edge gets a new face along it, its new
 * side on top of the old one, ready to be moved. Returns the new model and
 * what to select after (the new points, and the moved faces).
 */
export function extrude(model: MeshModel, s: Shape, sel: { faces?: readonly number[]; edges?: readonly (readonly [number, number])[] }, lift = 0.02): { model: MeshModel; points: number[]; faces: number[] } | null {
  const m = copy(model);
  const next = () => m.base.points + m.points.length;
  const faces = (sel.faces ?? []).filter((t) => t < s.triCount && !s.removed[t]);
  if (faces.length) {
    // Walls go on the edges only one picked face uses.
    const count = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const t of faces) for (let k = 0; k < 3; k++) count.set(key(s.corners[t * 3 + k]!, s.corners[t * 3 + ((k + 1) % 3)]!), (count.get(key(s.corners[t * 3 + k]!, s.corners[t * 3 + ((k + 1) % 3)]!)) ?? 0) + 1);
    const avg: V3 = [0, 0, 0];
    for (const t of faces) {
      const n = faceNormal(s, t);
      for (let k = 0; k < 3; k++) avg[k] = avg[k]! + n[k]!;
    }
    const l = len(avg) || 1;
    const dir: V3 = [(avg[0] / l) * lift, (avg[1] / l) * lift, (avg[2] / l) * lift];
    const twin = new Map<number, number>();
    const twinOf = (p: number) => {
      let q = twin.get(p);
      if (q === undefined) {
        const at = pointAt(s, p);
        q = next();
        m.points.push([at[0] + dir[0], at[1] + dir[1], at[2] + dir[2]]);
        twin.set(p, q);
      }
      return q;
    };
    for (const t of faces) {
      for (let k = 0; k < 3; k++) {
        const a = s.corners[t * 3 + k]!;
        const b = s.corners[t * 3 + ((k + 1) % 3)]!;
        if (count.get(key(a, b)) === 1) {
          const a2 = twinOf(a);
          const b2 = twinOf(b);
          m.added.push({ p: [a, b, b2], like: t }, { p: [a, b2, a2], like: t });
        }
      }
    }
    // Move the picked faces onto the new points (corners are stored before any turn, so undo a turn's swap).
    for (const t of faces) {
      const flipped = s.flipped[t] === 1;
      for (let k = 0; k < 3; k++) {
        const stored = flipped && k > 0 ? 3 - k : k;
        const p = twinOf(s.corners[t * 3 + k]!);
        if (t >= s.baseTris) m.added[t - s.baseTris]!.p[stored] = p;
        else m.rewire[String(t * 3 + stored)] = p;
      }
    }
    return { model: m, points: [...twin.values()], faces };
  }
  const edges = sel.edges ?? [];
  if (!edges.length) return null;
  const twin = new Map<number, number>();
  const twinOf = (p: number) => {
    let q = twin.get(p);
    if (q === undefined) {
      q = next();
      m.points.push(pointAt(s, p));
      twin.set(p, q);
    }
    return q;
  };
  const made: number[] = [];
  for (const [a0, b0] of edges) {
    // Follow the way the edge runs in its triangle, so the new face faces the same way.
    let a = a0;
    let b = b0;
    let like = 0;
    for (let t = 0; t < s.triCount; t++) {
      if (s.removed[t]) continue;
      for (let k = 0; k < 3; k++) {
        const x = s.corners[t * 3 + k]!;
        const y = s.corners[t * 3 + ((k + 1) % 3)]!;
        if ((x === a0 && y === b0) || (x === b0 && y === a0)) {
          a = x;
          b = y;
          like = t;
        }
      }
    }
    const a2 = twinOf(a);
    const b2 = twinOf(b);
    made.push(s.triCount + m.added.length - model.added.length, s.triCount + m.added.length - model.added.length + 1);
    m.added.push({ p: [b, a, a2], like }, { p: [b, a2, b2], like });
  }
  return { model: m, points: [...twin.values()], faces: made };
}

/** Is the model any different from the file? */
export function modelIsEmpty(m: MeshModel): boolean {
  return !Object.keys(m.moved).length && !m.points.length && !Object.keys(m.rewire).length && !m.removed.length && !m.flipped.length && !m.added.length;
}
