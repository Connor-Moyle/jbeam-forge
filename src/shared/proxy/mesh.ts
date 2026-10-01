import { weldMap } from '../mesh/split';

/**
 * Proxy mesh: the low-poly shell that *becomes* a part's jbeam (SPEC §4.4):
 * vertices → nodes, edges → beams, faces → collision triangles. BeamNG space
 * (+X left, −Y front, +Z up, metres).
 */
export interface ProxyMesh {
  positions: Float32Array;
  index: Uint32Array;
  /** Beams that are not triangle edges (surface remesher: region contacts, island ties). */
  extraEdges?: [number, number][];
}

export function vertexCount(m: ProxyMesh): number {
  return m.positions.length / 3;
}

export function faceCount(m: ProxyMesh): number {
  return m.index.length / 3;
}

/** Unique undirected edges as [a, b] pairs with a < b. */
export function edges(m: ProxyMesh): [number, number][] {
  const seen = new Set<number>();
  const n = vertexCount(m);
  const out: [number, number][] = [];
  for (const [a, b] of m.extraEdges ?? []) {
    if (a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (seen.has(lo * n + hi)) continue;
    seen.add(lo * n + hi);
    out.push([lo, hi]);
  }
  for (let t = 0; t < m.index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.index[t + k]!;
      const b = m.index[t + ((k + 1) % 3)]!;
      if (a === b) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * n + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([lo, hi]);
    }
  }
  return out;
}

export function distance(m: ProxyMesh, a: number, b: number): number {
  const p = m.positions;
  return Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
}

/** Drop unused vertices and renumber (order of first use is kept stable by original index). */
export function compact(positions: ArrayLike<number>, index: ArrayLike<number>): ProxyMesh {
  const used = new Int32Array(positions.length / 3).fill(-1);
  const order: number[] = [];
  for (let i = 0; i < index.length; i++) used[index[i]!] = 1;
  for (let v = 0; v < used.length; v++) if (used[v] === 1) order.push(v);
  const remap = new Int32Array(used.length).fill(-1);
  const out = new Float32Array(order.length * 3);
  order.forEach((v, i) => {
    remap[v] = i;
    out[i * 3] = positions[v * 3]!;
    out[i * 3 + 1] = positions[v * 3 + 1]!;
    out[i * 3 + 2] = positions[v * 3 + 2]!;
  });
  const idx = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) idx[i] = remap[index[i]!]!;
  return { positions: out, index: idx };
}

/** Merge vertices within tolerance (UV/normal seams), drop degenerate triangles, compact. */
export function weld(positions: ArrayLike<number>, index: ArrayLike<number>, tolerance = 1e-4): ProxyMesh {
  const canon = weldMap(positions, tolerance);
  const idx: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = canon[index[t]!]!;
    const b = canon[index[t + 1]!]!;
    const c = canon[index[t + 2]!]!;
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return compact(positions, idx);
}

export function bounds(positions: ArrayLike<number>): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** Signed volume (positive when faces wind counter-clockwise seen from outside). */
export function signedVolume(m: ProxyMesh): number {
  const p = m.positions;
  let v = 0;
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t]! * 3;
    const b = m.index[t + 1]! * 3;
    const c = m.index[t + 2]! * 3;
    v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v / 6;
}

/**
 * Merge nodes closer than `tolerance` (m) in a finished proxy, keeping its
 * extra edges: two nodes in one place make a beam with no length, which the
 * game can't solve. Degenerate triangles and self-edges go.
 */
export function weldGraph(m: ProxyMesh, tolerance: number): ProxyMesh {
  const canon = weldMap(m.positions, tolerance);
  const n = m.positions.length / 3;
  if (canon.every((c, i) => c === i)) return m;
  const idx: number[] = [];
  for (let t = 0; t + 2 < m.index.length; t += 3) {
    const a = canon[m.index[t]!]!;
    const b = canon[m.index[t + 1]!]!;
    const c = canon[m.index[t + 2]!]!;
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const extra = (m.extraEdges ?? []).map(([a, b]) => [canon[a]!, canon[b]!] as [number, number]).filter(([a, b]) => a !== b);
  const used = new Uint8Array(n);
  for (const v of idx) used[v] = 1;
  for (const [a, b] of extra) used[a] = used[b] = 1;
  const remap = new Int32Array(n).fill(-1);
  const out: number[] = [];
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue;
    remap[v] = out.length / 3;
    out.push(m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!);
  }
  return {
    positions: new Float32Array(out),
    index: new Uint32Array(idx.map((v) => remap[v]!)),
    ...(extra.length ? { extraEdges: extra.map(([a, b]) => [remap[a]!, remap[b]!] as [number, number]) } : {}),
  };
}

/**
 * A very dense mesh brought down to about `maxTriangles` before proxy work:
 * vertices merged on a grid anchored at the origin (so a car that is mirror
 * symmetric about x = 0 stays so), each cell's vertices averaged, and
 * triangles that collapse or repeat dropped. A part's structure has a few
 * hundred nodes, so its shape survives; a million-triangle part generates in
 * a fraction of the time. Meshes under the budget come back unchanged.
 */
export function reduceDense(m: ProxyMesh, maxTriangles = 20_000): ProxyMesh {
  const tris = m.index.length / 3;
  if (tris <= maxTriangles) return m;
  const p = m.positions;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[i + k]!);
      hi[k] = Math.max(hi[k]!, p[i + k]!);
    }
  // A surface mesh has about twice as many triangles as vertices: aim for maxTriangles/2 cells in use.
  const area = (hi[0]! - lo[0]!) * (hi[1]! - lo[1]!) + (hi[1]! - lo[1]!) * (hi[2]! - lo[2]!) + (hi[0]! - lo[0]!) * (hi[2]! - lo[2]!);
  let cell = Math.max(1e-4, Math.sqrt((2 * Math.max(area, 1e-6)) / (maxTriangles / 2)));
  for (let attempt = 0; attempt < 6; attempt++) {
    const cells = new Map<number, number>();
    // Cell coordinates relative to the lowest cell, packed into one number.
    const ox = Math.floor(lo[0]! / cell), oy = Math.floor(lo[1]! / cell), oz = Math.floor(lo[2]! / cell);
    const nx = Math.floor(hi[0]! / cell) - ox + 1, ny = Math.floor(hi[1]! / cell) - oy + 1;
    const sums: number[] = [];
    const counts: number[] = [];
    const remap = new Int32Array(p.length / 3);
    for (let v = 0; v < remap.length; v++) {
      const x = p[v * 3]!, y = p[v * 3 + 1]!, z = p[v * 3 + 2]!;
      const key = Math.floor(x / cell) - ox + nx * (Math.floor(y / cell) - oy + ny * (Math.floor(z / cell) - oz));
      let id = cells.get(key);
      if (id === undefined) {
        id = counts.length;
        cells.set(key, id);
        sums.push(0, 0, 0);
        counts.push(0);
      }
      sums[id * 3]! += x;
      sums[id * 3 + 1]! += y;
      sums[id * 3 + 2]! += z;
      counts[id]!++;
      remap[v] = id;
    }
    const seen = new Set<number>();
    const index: number[] = [];
    const n = counts.length;
    for (let t = 0; t < m.index.length; t += 3) {
      const a = remap[m.index[t]!]!, b = remap[m.index[t + 1]!]!, c = remap[m.index[t + 2]!]!;
      if (a === b || b === c || a === c) continue;
      const lo3 = Math.min(a, b, c), hi3 = Math.max(a, b, c), mid3 = a + b + c - lo3 - hi3;
      const key = (lo3 * n + mid3) * n + hi3;
      if (seen.has(key)) continue;
      seen.add(key);
      index.push(a, b, c);
    }
    if (index.length / 3 > maxTriangles * 1.5 && attempt < 5) {
      cell *= 1.4;
      continue;
    }
    const positions = new Float32Array(counts.length * 3);
    for (let i = 0; i < counts.length; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = sums[i * 3 + k]! / counts[i]!;
    return compact(positions, index);
  }
  return m;
}
