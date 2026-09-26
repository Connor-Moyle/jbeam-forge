import { weldMap } from '../mesh/split';

/**
 * Proxy mesh: the low-poly shell that *becomes* a part's jbeam (SPEC §4.4):
 * vertices → nodes, edges → beams, faces → collision triangles. BeamNG space
 * (+X left, −Y front, +Z up, metres).
 */
export interface ProxyMesh {
  positions: Float32Array;
  index: Uint32Array;
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
