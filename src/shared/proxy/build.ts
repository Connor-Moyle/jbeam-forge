import { faceCount, vertexCount, weldGraph, type ProxyMesh } from './mesh';
import { collapseShortEdges, mergeClose, orientOutward, removeDegenerate, subdivideLongEdges } from './quality';
import { convexHull, decimate, fitBox, fitCylinder, principalAxes } from './shapes';
import { isMirrorSymmetric, leftHalf, mirrorGraph, mirrorHalf } from './symmetry';
import { remeshSurface } from './remesh';

export const PROXY_MODES = ['surface', 'decimate', 'hull', 'box', 'cylinder'] as const;
export type ProxyMode = (typeof PROXY_MODES)[number];

export interface ProxyBuildSettings {
  mode: ProxyMode;
  targetVertices: number;
  /** Mirror a left half (decimate mode, centred parts only). */
  symmetry: boolean;
  /** Edges longer than this are subdivided (m). */
  maxEdge: number;
  /** Edges shorter than this are collapsed (m) — the minimum feature size. */
  minEdge: number;
  /** Move the shell inward along vertex normals (m), so nodes sit inside the visual skin. */
  inset: number;
  /** Hard vertex cap (e.g. from the part's mass): subdivision never exceeds it. */
  maxVertices?: number;
}

export interface ProxyBuildResult {
  mesh: ProxyMesh;
  mirrored: boolean;
  stats: { inputTriangles: number; vertices: number; triangles: number; ms: number };
}

/** Area-weighted vertex normals. */
function vertexNormals(m: ProxyMesh): Float32Array {
  const p = m.positions;
  const n = new Float32Array(p.length);
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t]!;
    const b = m.index[t + 1]!;
    const c = m.index[t + 2]!;
    const ux = p[b * 3]! - p[a * 3]!;
    const uy = p[b * 3 + 1]! - p[a * 3 + 1]!;
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!;
    const vy = p[c * 3 + 1]! - p[a * 3 + 1]!;
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v * 3]! += fx;
      n[v * 3 + 1]! += fy;
      n[v * 3 + 2]! += fz;
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!);
    if (l > 0) {
      n[v]! /= l;
      n[v + 1]! /= l;
      n[v + 2]! /= l;
    }
  }
  return n;
}

export function insetShell(m: ProxyMesh, distance: number): ProxyMesh {
  if (distance <= 0) return m;
  const n = vertexNormals(m);
  const p = Float32Array.from(m.positions);
  for (let i = 0; i < p.length; i++) p[i]! -= n[i]! * distance;
  return { positions: p, index: m.index, extraEdges: m.extraEdges };
}

function shape(input: ProxyMesh, s: ProxyBuildSettings, target: number): ProxyMesh {
  switch (s.mode) {
    case 'surface':
      return remeshSurface(input, { targetVertices: target });
    case 'decimate':
      // Leave ~40% of the budget for long-edge subdivision: evener spacing than decimating straight to budget.
      return decimate(input, s.maxEdge > 0 ? Math.max(4, Math.round(target * 0.6)) : target);
    case 'hull':
      // Part of the budget is kept for splitting long edges, so the part ends at its budget, not past it.
      return convexHull(input, s.maxEdge > 0 ? Math.max(4, Math.round(target * 0.7)) : target);
    case 'box':
      return fitBox(input);
    case 'cylinder':
      return fitCylinder(input, Math.max(4, Math.min(12, Math.round(target / 2))));
  }
}

/**
 * Quality pass. Subdivision stops at the budget: remaining long beams are reported, not hidden in a
 * blown budget. (It used to run to 1.5× the budget, and nearly every panel got there: a door came
 * out at 43 nodes where the game's doors have 15.)
 */
function clean(m: ProxyMesh, s: ProxyBuildSettings, target: number, hardCap: number): ProxyMesh {
  let out = removeDegenerate(m);
  if (s.minEdge > 0) out = mergeClose(collapseShortEdges(out, s.minEdge), s.minEdge);
  if (s.maxEdge > 0) out = subdivideLongEdges(out, s.maxEdge, Math.max(vertexCount(out), Math.min(hardCap, target)));
  // Splitting two faces of a thin part puts a new vertex on each, one over the other: merged again.
  if (s.minEdge > 0 && s.maxEdge > 0) out = mergeClose(out, s.minEdge);
  return out;
}

/**
 * The left half of a centred part as points for a hull: its vertices at x ≥ 0 and the points where
 * its edges cross the centre plane, so the half's hull is cut flat exactly on the plane.
 */
function leftHalfPoints(input: ProxyMesh): ProxyMesh {
  const p = input.positions;
  const out: number[] = [];
  for (let v = 0; v < p.length; v += 3) if (p[v]! >= 0) out.push(p[v]!, p[v + 1]!, p[v + 2]!);
  for (let t = 0; t < input.index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = input.index[t + k]! * 3;
      const b = input.index[t + ((k + 1) % 3)]! * 3;
      if (p[a]! * p[b]! >= 0) continue;
      const f = p[a]! / (p[a]! - p[b]!);
      out.push(0, p[a + 1]! + (p[b + 1]! - p[a + 1]!) * f, p[a + 2]! + (p[b + 2]! - p[a + 2]!) * f);
    }
  }
  return { positions: new Float32Array(out), index: new Uint32Array(0) };
}

/**
 * A centred part's hull as two exact halves: the left half is wrapped, brought to half the budget
 * and mirrored, so every node off the centre line has its twin (the game's panels are all built
 * that way; a hull cut down as one piece came out different on each side). Null when the halves
 * wouldn't meet on the centre line, and the part is wrapped whole instead.
 */
function mirroredHull(input: ProxyMesh, s: ProxyBuildSettings): ProxyMesh | null {
  const target = Math.ceil(s.targetVertices / 2);
  // Moved in under the skin as a half, so both sides move alike (done after mirroring, a thin panel's
  // one layer of faces has no inside to go by, and left and right came out a few millimetres different).
  const half = insetShell(orientOutward(clean(shape(leftHalfPoints(input), s, target), s, target, Math.ceil((s.maxVertices ?? Infinity) / 2))), s.inset);
  const seam = Math.max(s.minEdge / 2, 0.02);
  const pos = Float32Array.from(half.positions);
  let onSeam = 0;
  for (let v = 0; v < pos.length; v += 3)
    if (pos[v]! < seam) {
      pos[v] = 0;
      onSeam++;
    }
  if (onSeam < 2) return null;
  // The flat face the cut left on the centre plane is inside the part: it goes.
  const idx: number[] = [];
  for (let t = 0; t < half.index.length; t += 3) {
    const [a, b, c] = [half.index[t]!, half.index[t + 1]!, half.index[t + 2]!];
    if (pos[a * 3] === 0 && pos[b * 3] === 0 && pos[c * 3] === 0) continue;
    idx.push(a, b, c);
  }
  if (idx.length < 6) return null;
  return mirrorHalf({ positions: pos, index: new Uint32Array(idx) }, seam);
}

/**
 * Can the game hang a mesh on these nodes? For each vertex it takes a node, a second one, and a
 * third that must stand well off the line through the first two; with none it reports "VY node
 * not found" and the mesh stays where it is. A wide, thin part cut down to a row of single nodes
 * fails (a 9-node grille did: from its quarter-way node every other node lay within 25° of one
 * line, and a node 33° off was enough). So every node, with each of its two nearest neighbours,
 * needs another node at least BIND_ANGLE off that line.
 */
const BIND_ANGLE = (45 * Math.PI) / 180;

export function bindable(m: ProxyMesh): boolean {
  const p = m.positions;
  const n = p.length / 3;
  if (n < 3) return false;
  const minSin = Math.sin(BIND_ANGLE);
  for (let a = 0; a < n; a++) {
    const near = [...Array(n).keys()].filter((b) => b !== a).map((b) => [b, Math.hypot(p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!)] as const).sort((x, y) => x[1] - y[1]);
    for (const [b, ab] of near.slice(0, 2)) {
      if (!(ab > 0)) continue;
      const ux = (p[b * 3]! - p[a * 3]!) / ab;
      const uy = (p[b * 3 + 1]! - p[a * 3 + 1]!) / ab;
      const uz = (p[b * 3 + 2]! - p[a * 3 + 2]!) / ab;
      const off = near.some(([c, ac]) => {
        if (c === b || !(ac > 0)) return false;
        const vx = (p[c * 3]! - p[a * 3]!) / ac;
        const vy = (p[c * 3 + 1]! - p[a * 3 + 1]!) / ac;
        const vz = (p[c * 3 + 2]! - p[a * 3 + 2]!) / ac;
        return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) >= minSin;
      });
      if (!off) return false;
    }
  }
  return true;
}

/** Build a part's proxy from its (BeamNG-space) render geometry. Requires `await meshoptReady` for decimate/hull. */
/** Faces of a thin panel are closer than this (m); its nodes are kept at least THIN_MIN_EDGE apart. */
const THIN_DEPTH = 0.12;
const THIN_MIN_EDGE = 0.09;

function isThin(positions: ArrayLike<number>): boolean {
  const n = positions.length / 3;
  if (n < 4) return false;
  const { center, axes } = principalAxes(positions);
  const a = axes[2]!;
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < n; v++) {
    const d = (positions[v * 3]! - center[0]) * a[0] + (positions[v * 3 + 1]! - center[1]) * a[1] + (positions[v * 3 + 2]! - center[2]) * a[2];
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return hi - lo < THIN_DEPTH;
}

/** Nodes closer than this (m) are merged: a 1 mm beam can only shake. */
const WELD_NODES = 0.001;

export function buildProxy(input: ProxyMesh, settings: ProxyBuildSettings): ProxyBuildResult {
  const started = performance.now();
  // A thin panel's hull has a node on each face at every edge, a few centimetres apart: one node
  // does there, and the budget goes on the skin instead.
  const s = settings.mode === 'hull' && settings.minEdge > 0 && isThin(input.positions) ? { ...settings, minEdge: Math.max(settings.minEdge, THIN_MIN_EDGE) } : settings;
  const symmetric = s.symmetry && (s.mode === 'decimate' || s.mode === 'surface' || s.mode === 'hull') && isMirrorSymmetric(input.positions);
  const hullHalves = symmetric && s.mode === 'hull' ? mirroredHull(input, s) : null;
  const mirrored = symmetric && (s.mode !== 'hull' || !!hullHalves);
  let mesh: ProxyMesh;
  if (hullHalves) {
    mesh = hullHalves;
  } else if (s.mode === 'surface') {
    // Even spacing on the surface already: no collapse/subdivide pass (it would undo the evenness).
    const cap = s.maxVertices ?? Infinity;
    mesh = mirrored
      ? mirrorGraph(remeshSurface(leftHalf(input), { targetVertices: Math.min(Math.ceil(s.targetVertices / 2), Math.ceil(cap / 2)) }), Math.max(s.minEdge / 2, 0.01))
      : remeshSurface(input, { targetVertices: Math.min(s.targetVertices, cap) });
  } else if (mirrored) {
    const target = Math.ceil(s.targetVertices / 2);
    const half = clean(shape(leftHalf(input), s, target), s, target, Math.ceil((s.maxVertices ?? Infinity) / 2));
    mesh = mirrorHalf(half, Math.max(s.minEdge / 2, 0.005));
  } else {
    mesh = s.mode === 'box' || s.mode === 'cylinder' ? shape(input, s, s.targetVertices) : clean(shape(input, s, s.targetVertices), s, s.targetVertices, s.maxVertices ?? Infinity);
  }
  // Nodes that ended up in one place (the centre seam, inset thin panels) become one node.
  mesh = weldGraph(hullHalves ? orientOutward(mesh) : insetShell(orientOutward(mesh), s.inset), WELD_NODES);
  return { mesh, mirrored, stats: { inputTriangles: input.index.length / 3, vertices: vertexCount(mesh), triangles: faceCount(mesh), ms: performance.now() - started } };
}
