import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { Vector3 } from 'three';
import { compact, vertexCount, weld, type ProxyMesh } from './mesh';

/**
 * Proxy shape builders (SPEC §4.4):
 *   decimate  — meshoptimizer simplifier (never three's SimplifyModifier), border-locked when the budget allows
 *   hull      — convex hull, then decimated to budget (engine, gearbox, diff, hubs)
 *   box/cylinder — primitive fit on principal axes (PCA) (driveshafts, arms)
 */

export const meshoptReady: Promise<void> = MeshoptSimplifier.ready;

/**
 * Simplify towards `targetVertices`. Tries border locking first (keeps the
 * silhouette of open panels); if borders alone exceed the budget, retries
 * unlocked, and finally prunes small islands. Returns the welded input
 * untouched if it is already within budget. Requires `await meshoptReady`.
 */
export function decimate(input: ProxyMesh, targetVertices: number): ProxyMesh {
  const welded = weld(input.positions, input.index);
  if (vertexCount(welded) <= targetVertices || welded.index.length === 0) return welded;
  // meshopt: target index count must be a multiple of 3 within [3, input length].
  const valid = (n: number) => Math.min(welded.index.length, Math.max(3, Math.floor(n / 3) * 3));
  const attempt = (flags: ('LockBorder' | 'Prune')[]) => {
    let targetIndices = valid(targetVertices * 6);
    let best: ProxyMesh = welded;
    for (let i = 0; i < 8; i++) {
      const [idx] = MeshoptSimplifier.simplify(welded.index, welded.positions, 3, targetIndices, 1, flags);
      if (idx.length === 0) break;
      const out = compact(welded.positions, idx);
      if (out.index.length === 0) break;
      best = out;
      if (vertexCount(out) <= targetVertices * 1.1) return out;
      targetIndices = valid(targetIndices * Math.min(0.8, targetVertices / vertexCount(out)));
    }
    return best;
  };
  const locked = attempt(['LockBorder']);
  if (vertexCount(locked) <= targetVertices * 1.5) return locked;
  const free = attempt([]);
  if (vertexCount(free) <= targetVertices * 1.5) return free;
  const pruned = attempt(['Prune']);
  if (vertexCount(pruned) <= targetVertices * 1.5) return pruned;
  // Fragmented meshes (hundreds of tiny islands) resist edge collapse: cluster vertices instead,
  // and as a last resort wrap everything in a hull (always within budget).
  const clustered = sloppy(welded, targetVertices);
  if (vertexCount(clustered) <= targetVertices * 1.5) return clustered;
  return convexHull(welded, targetVertices);
}

/** Vertex clustering (meshopt simplifySloppy): always reaches the budget, at some cost to shape. */
function sloppy(welded: ProxyMesh, targetVertices: number): ProxyMesh {
  let targetIndices = Math.min(welded.index.length, Math.max(3, Math.floor((targetVertices * 6) / 3) * 3));
  let best = welded;
  for (let i = 0; i < 10; i++) {
    const [idx] = MeshoptSimplifier.simplifySloppy(welded.index, welded.positions, 3, null, targetIndices, 1);
    if (idx.length === 0) break;
    const out = weld(welded.positions, idx, 1e-4);
    if (out.index.length === 0) break;
    best = out;
    if (vertexCount(out) <= targetVertices * 1.2) break;
    targetIndices = Math.max(3, Math.floor((targetIndices * 0.7) / 3) * 3);
  }
  return best;
}

/** Convex hull of all vertices, decimated to the budget. */
export function convexHull(input: ProxyMesh, targetVertices: number, depth = 0): ProxyMesh {
  const pts: Vector3[] = [];
  for (let i = 0; i < input.positions.length; i += 3) pts.push(new Vector3(input.positions[i], input.positions[i + 1], input.positions[i + 2]));
  if (pts.length < 4) return weld(input.positions, input.index);
  const hull = new ConvexHull().setFromPoints(pts);
  const positions: number[] = [];
  const index: number[] = [];
  const ids = new Map<Vector3, number>();
  const vid = (p: Vector3) => {
    let i = ids.get(p);
    if (i === undefined) {
      i = positions.length / 3;
      ids.set(p, i);
      positions.push(p.x, p.y, p.z);
    }
    return i;
  };
  for (const face of hull.faces) {
    const loop: number[] = [];
    let e = face.edge;
    do {
      loop.push(vid(e.head().point));
      e = e.next;
    } while (e !== face.edge);
    for (let k = 1; k + 1 < loop.length; k++) index.push(loop[0]!, loop[k]!, loop[k + 1]!);
  }
  const hullMesh = { positions: new Float32Array(positions), index: new Uint32Array(index) };
  // A hull is one closed manifold: plain decimation always reduces it (depth guards the mutual recursion).
  return depth > 0 ? hullMesh : decimateClosed(hullMesh, targetVertices);
}

function decimateClosed(m: ProxyMesh, targetVertices: number): ProxyMesh {
  const welded = weld(m.positions, m.index);
  if (vertexCount(welded) <= targetVertices) return welded;
  let targetIndices = Math.min(welded.index.length, Math.max(3, Math.floor((targetVertices * 6) / 3) * 3));
  let best = welded;
  for (let i = 0; i < 10; i++) {
    const [idx] = MeshoptSimplifier.simplify(welded.index, welded.positions, 3, targetIndices, 1, []);
    if (idx.length === 0) break;
    best = compact(welded.positions, idx);
    if (vertexCount(best) <= targetVertices * 1.1) break;
    targetIndices = Math.max(3, Math.floor((targetIndices * 0.7) / 3) * 3);
  }
  return best;
}

/** Principal axes of the vertices (unit vectors, largest spread first) and centroid. */
export function principalAxes(positions: ArrayLike<number>): { center: [number, number, number]; axes: [number, number, number][] } {
  const n = positions.length / 3;
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += positions[i * 3 + k]! / n;
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++) {
    const d = [positions[i * 3]! - c[0], positions[i * 3 + 1]! - c[1], positions[i * 3 + 2]! - c[2]];
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) cov[r]![q]! += (d[r]! * d[q]!) / n;
  }
  // Jacobi eigen-decomposition of the symmetric 3×3 covariance.
  const a = cov.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p]![q]! ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p]![q]!) < 1e-15) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < 3; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = cs * akp - sn * akq;
          a[k]![q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = cs * apk - sn * aqk;
          a[q]![k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = cs * vkp - sn * vkq;
          v[k]![q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  const eig = [0, 1, 2].map((i) => ({ value: a[i]![i]!, axis: [v[0]![i]!, v[1]![i]!, v[2]![i]!] as [number, number, number] }));
  eig.sort((x, y) => y.value - x.value);
  return { center: c, axes: eig.map((e) => e.axis) };
}

/** A fitted box or cylinder is at least this thick (m): a flat one has nodes in the same place. */
const MIN_THICKNESS = 0.01;

function extents(positions: ArrayLike<number>, center: [number, number, number], axes: [number, number, number][]): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const d = [positions[i]! - center[0], positions[i + 1]! - center[1], positions[i + 2]! - center[2]];
    axes.forEach((ax, k) => {
      const s = d[0]! * ax[0] + d[1]! * ax[1] + d[2]! * ax[2];
      lo[k] = Math.min(lo[k]!, s);
      hi[k] = Math.max(hi[k]!, s);
    });
  }
  for (let k = 0; k < 3; k++) {
    const mid = (lo[k]! + hi[k]!) / 2;
    if (hi[k]! - lo[k]! < MIN_THICKNESS) {
      lo[k] = mid - MIN_THICKNESS / 2;
      hi[k] = mid + MIN_THICKNESS / 2;
    }
  }
  return { lo, hi };
}

const at = (center: [number, number, number], axes: [number, number, number][], s: number[]): [number, number, number] => [
  center[0] + axes[0]![0] * s[0]! + axes[1]![0] * s[1]! + axes[2]![0] * s[2]!,
  center[1] + axes[0]![1] * s[0]! + axes[1]![1] * s[1]! + axes[2]![1] * s[2]!,
  center[2] + axes[0]![2] * s[0]! + axes[1]![2] * s[1]! + axes[2]![2] * s[2]!,
];

/** Oriented bounding box on the principal axes: 8 vertices, 12 outward triangles. */
export function fitBox(input: ProxyMesh): ProxyMesh {
  const { center, axes } = principalAxes(input.positions);
  if (det(axes) < 0) axes[2] = axes[2]!.map((x) => -x) as [number, number, number]; // keep the frame right-handed so faces wind outward
  const { lo, hi } = extents(input.positions, center, axes);
  const positions: number[] = [];
  for (let i = 0; i < 8; i++) positions.push(...at(center, axes, [i & 1 ? hi[0]! : lo[0]!, i & 2 ? hi[1]! : lo[1]!, i & 4 ? hi[2]! : lo[2]!]));
  // Faces of the unit cube with vertex bit layout x=1, y=2, z=4, wound outward for a right-handed frame.
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const index = faces.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]);
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

function det(m: [number, number, number][]): number {
  const [a, b, c] = m as [[number, number, number], [number, number, number], [number, number, number]];
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

/** Cylinder along the main principal axis: two rings of `segments` vertices, capped. */
export function fitCylinder(input: ProxyMesh, segments = 6): ProxyMesh {
  const { center, axes } = principalAxes(input.positions);
  const { lo, hi } = extents(input.positions, center, axes);
  const r1 = (hi[1]! - lo[1]!) / 2;
  const r2 = (hi[2]! - lo[2]!) / 2;
  const mid1 = (hi[1]! + lo[1]!) / 2;
  const mid2 = (hi[2]! + lo[2]!) / 2;
  const positions: number[] = [];
  for (const s0 of [lo[0]!, hi[0]!]) {
    for (let k = 0; k < segments; k++) {
      const ang = (2 * Math.PI * k) / segments;
      positions.push(...at(center, axes, [s0, mid1 + r1 * Math.cos(ang), mid2 + r2 * Math.sin(ang)]));
    }
  }
  const index: number[] = [];
  for (let k = 0; k < segments; k++) {
    const a = k;
    const b = (k + 1) % segments;
    index.push(a, b, segments + b, a, segments + b, segments + a);
  }
  for (let k = 1; k + 1 < segments; k++) {
    index.push(0, k + 1, k); // cap at lo
    index.push(segments, segments + k, segments + k + 1); // cap at hi
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}
