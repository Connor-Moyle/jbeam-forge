import { bounds, compact, edges, weld, type ProxyMesh } from './mesh';

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

/**
 * Is the mesh actually mirror-symmetric about X = 0? At least `share` of
 * sampled vertices must have a mirror partner within `tolerance` × the
 * bounding-box diagonal. Straddling the centre isn't enough: an asymmetric part
 * (a skid plate offset to one side, a single exhaust) must not be mirrored.
 */
export function isMirrorSymmetric(positions: ArrayLike<number>, tolerance = 0.02, share = 0.9): boolean {
  if (!straddlesCentre(positions)) return false;
  const { min, max } = bounds(positions);
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const tol = tolerance * diagonal;
  const cell = tol * 2;
  const grid = new Map<string, number[]>();
  const n = positions.length / 3;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < n; v++) {
    const k = key(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
    const l = grid.get(k);
    if (l) l.push(v);
    else grid.set(k, [v]);
  }
  const step = Math.max(1, Math.floor(n / 2000));
  let tested = 0;
  let matched = 0;
  for (let v = 0; v < n; v += step) {
    tested++;
    const x = -positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const u of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (Math.hypot(positions[u * 3]! - x, positions[u * 3 + 1]! - y, positions[u * 3 + 2]! - z) <= tol) {
              matched++;
              break search;
            }
          }
  }
  return tested > 0 && matched / tested >= share;
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

/**
 * Mirror a left-half node graph (surface remesher output, with extra edges):
 * nodes within `seam` of X = 0 snap onto it and are shared; the rest get an
 * exact −X twin. Triangles are mirrored with reversed winding.
 */
export function mirrorGraph(half: ProxyMesh, seam: number): ProxyMesh {
  const n = half.positions.length / 3;
  const pos: number[] = Array.from(half.positions);
  // Typical beam length of the half: nodes this close to the centre line join both halves.
  const lens = edges(half)
    .map(([a, b]) => Math.hypot(pos[a * 3]! - pos[b * 3]!, pos[a * 3 + 1]! - pos[b * 3 + 1]!, pos[a * 3 + 2]! - pos[b * 3 + 2]!))
    .sort((x, y) => x - y);
  const typical = lens[Math.floor(lens.length / 2)] ?? seam;
  const snap = Math.max(seam, 0.4 * typical);
  const twin = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    if (pos[v * 3]! < snap) {
      pos[v * 3] = 0;
      twin[v] = v; // centre node: its own mirror
    } else {
      twin[v] = pos.length / 3;
      pos.push(-pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
    }
  }
  const idx: number[] = Array.from(half.index);
  for (let t = 0; t < half.index.length; t += 3) {
    const [a, b, c] = [half.index[t]!, half.index[t + 1]!, half.index[t + 2]!];
    if (twin[a] === a && twin[b] === b && twin[c] === c) continue; // lies on the centre line: already present
    idx.push(twin[a]!, twin[c]!, twin[b]!);
  }
  const extra: [number, number][] = [];
  for (const [a, b] of half.extraEdges ?? []) {
    extra.push([a, b]);
    if (twin[a] !== a || twin[b] !== b) extra.push([twin[a]!, twin[b]!]);
  }
  // Cross-centre beams: near-seam nodes tie to their own mirror so the halves are one structure.
  for (let v = 0; v < n; v++) if (twin[v] !== v && pos[v * 3]! < 0.75 * typical) extra.push([v, twin[v]!]);
  return { positions: new Float32Array(pos), index: new Uint32Array(idx), extraEdges: extra };
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
