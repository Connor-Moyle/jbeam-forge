import { faceCount, vertexCount, type ProxyMesh } from './mesh';
import { collapseShortEdges, orientOutward, removeDegenerate, subdivideLongEdges } from './quality';
import { convexHull, decimate, fitBox, fitCylinder } from './shapes';
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
      return convexHull(input, target);
    case 'box':
      return fitBox(input);
    case 'cylinder':
      return fitCylinder(input, Math.max(4, Math.min(12, Math.round(target / 2))));
  }
}

/** Quality pass. Subdivision is capped at 1.5× the budget: remaining long beams are reported, not hidden in a blown budget. */
function clean(m: ProxyMesh, s: ProxyBuildSettings, target: number, hardCap: number): ProxyMesh {
  let out = removeDegenerate(m);
  if (s.minEdge > 0) out = collapseShortEdges(out, s.minEdge);
  if (s.maxEdge > 0) out = subdivideLongEdges(out, s.maxEdge, Math.max(vertexCount(out), Math.min(hardCap, Math.ceil(target * 1.5))));
  return out;
}

/** Build a part's proxy from its (BeamNG-space) render geometry. Requires `await meshoptReady` for decimate/hull. */
export function buildProxy(input: ProxyMesh, s: ProxyBuildSettings): ProxyBuildResult {
  const started = performance.now();
  const mirrored = s.symmetry && (s.mode === 'decimate' || s.mode === 'surface') && isMirrorSymmetric(input.positions);
  let mesh: ProxyMesh;
  if (s.mode === 'surface') {
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
  mesh = insetShell(orientOutward(mesh), s.inset);
  return { mesh, mirrored, stats: { inputTriangles: input.index.length / 3, vertices: vertexCount(mesh), triangles: faceCount(mesh), ms: performance.now() - started } };
}
