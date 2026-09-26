import { bounds, compact, weld, type ProxyMesh } from './mesh';

/**
 * Symmetry by mirroring the proxy itself (SPEC §4.4): keep the left half
 * (+X is left in BeamNG space), snap near-centre vertices onto the seam,
 * mirror to the right, weld the seam. Every off-centre vertex then has an
 * exact mirror twin → perfect l/r node pairs.
 */

/** Is the mesh roughly symmetric about X = 0 (spans both sides by similar amounts)? */
export function straddlesCentre(positions: ArrayLike<number>, tolerance = 0.15): boolean {
  const { min, max } = bounds(positions);
  if (!(min[0] < 0 && max[0] > 0)) return false;
  const width = max[0] - min[0];
  return Math.abs(max[0] + min[0]) <= tolerance * width;
}

/** The left half of a mesh: triangles whose centroid has x ≥ 0. */
export function leftHalf(m: ProxyMesh): ProxyMesh {
  const idx: number[] = [];
  const p = m.positions;
  for (let t = 0; t < m.index.length; t += 3) {
    const cx = (p[m.index[t]! * 3]! + p[m.index[t + 1]! * 3]! + p[m.index[t + 2]! * 3]!) / 3;
    if (cx >= 0) idx.push(m.index[t]!, m.index[t + 1]!, m.index[t + 2]!);
  }
  return compact(p, idx);
}

/** Mirror a left-half proxy to a full, exactly symmetric one. `seam`: vertices with x below it snap to 0. */
export function mirrorHalf(half: ProxyMesh, seam: number): ProxyMesh {
  const n = half.positions.length / 3;
  const pos = Float32Array.from(half.positions);
  for (let v = 0; v < n; v++) if (pos[v * 3]! < seam) pos[v * 3] = 0;
  const all = new Float32Array(n * 6);
  all.set(pos, 0);
  for (let v = 0; v < n; v++) {
    all[(n + v) * 3] = -pos[v * 3]!;
    all[(n + v) * 3 + 1] = pos[v * 3 + 1]!;
    all[(n + v) * 3 + 2] = pos[v * 3 + 2]!;
  }
  const idx = new Uint32Array(half.index.length * 2);
  idx.set(half.index, 0);
  for (let t = 0; t < half.index.length; t += 3) {
    // mirrored copy with reversed winding (a mirror flips orientation)
    idx[half.index.length + t] = n + half.index[t]!;
    idx[half.index.length + t + 1] = n + half.index[t + 2]!;
    idx[half.index.length + t + 2] = n + half.index[t + 1]!;
  }
  return weld(all, idx, 1e-6); // seam vertices (x = 0) merge with their mirror
}
