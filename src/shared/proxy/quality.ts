import { compact, distance, edges, signedVolume, vertexCount, type ProxyMesh } from './mesh';

/**
 * Proxy quality pass (SPEC §4.4): degenerate/sliver removal, long-edge
 * subdivision (long beams are floppy), short-edge collapse (short beams are
 * unstable), and coherent outward winding (collision triangles face out).
 */

function triangleArea2(p: Float32Array, a: number, b: number, c: number): number {
  const ux = p[b * 3]! - p[a * 3]!;
  const uy = p[b * 3 + 1]! - p[a * 3 + 1]!;
  const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const vx = p[c * 3]! - p[a * 3]!;
  const vy = p[c * 3 + 1]! - p[a * 3 + 1]!;
  const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** Remove triangles with repeated vertices, zero area, or a sliver shape (min altitude below `minAltitudeRatio` × longest edge). */
export function removeDegenerate(m: ProxyMesh, minAltitudeRatio = 0.02): ProxyMesh {
  const p = m.positions;
  const idx: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t]!;
    const b = m.index[t + 1]!;
    const c = m.index[t + 2]!;
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue; // duplicate face
    const longest = Math.max(distance(m, a, b), distance(m, b, c), distance(m, c, a));
    const area2 = triangleArea2(p, a, b, c);
    if (longest === 0 || area2 / longest < minAltitudeRatio * longest) continue;
    seen.add(key);
    idx.push(a, b, c);
  }
  return compact(p, idx);
}

/**
 * Split every edge longer than `maxLength` at its midpoint, re-tiling each
 * triangle by how many of its edges split (1→2, 2→3, 3→4 triangles). Both
 * triangles sharing an edge see the same split, so the result has no cracks.
 * Repeats until no edge is too long or `maxVertices` is reached.
 */
export function subdivideLongEdges(m: ProxyMesh, maxLength: number, maxVertices = 4000): ProxyMesh {
  const pos = Array.from(m.positions);
  let tris = Array.from(m.index);
  const len = (a: number, b: number) => Math.hypot(pos[a * 3]! - pos[b * 3]!, pos[a * 3 + 1]! - pos[b * 3 + 1]!, pos[a * 3 + 2]! - pos[b * 3 + 2]!);
  for (let pass = 0; pass < 16; pass++) {
    const mids = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const long = new Map<string, [number, number, number]>();
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k]!;
        const b = tris[t + ((k + 1) % 3)]!;
        const l = len(a, b);
        if (l > maxLength) long.set(key(a, b), [a, b, l]);
      }
    }
    // Longest first, so a vertex cap spends its budget where beams are floppiest.
    for (const [kk, [a, b]] of [...long].sort((x, y) => y[1][2] - x[1][2])) {
      if (pos.length / 3 >= maxVertices) break;
      mids.set(kk, pos.length / 3);
      pos.push((pos[a * 3]! + pos[b * 3]!) / 2, (pos[a * 3 + 1]! + pos[b * 3 + 1]!) / 2, (pos[a * 3 + 2]! + pos[b * 3 + 2]!) / 2);
    }
    if (mids.size === 0) break;
    const next: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
      const mid = [0, 1, 2].map((k) => mids.get(key(v[k]!, v[(k + 1) % 3]!)));
      const count = mid.filter((x) => x !== undefined).length;
      if (count === 0) {
        next.push(...v);
        continue;
      }
      if (count === 3) {
        const [ab, bc, ca] = mid as [number, number, number];
        next.push(v[0]!, ab, ca, ab, v[1]!, bc, ca, bc, v[2]!, ab, bc, ca);
        continue;
      }
      // Rotate so the pattern starts at edge 0 (split) — for count 2, the unsplit edge becomes edge 2.
      let r = 0;
      if (count === 1) r = mid.findIndex((x) => x !== undefined);
      else r = (mid.findIndex((x) => x === undefined) + 1) % 3;
      const a = v[r]!;
      const b = v[(r + 1) % 3]!;
      const c = v[(r + 2) % 3]!;
      const mab = mid[r]!;
      if (count === 1) {
        next.push(a, mab, c, mab, b, c);
      } else {
        const mbc = mid[(r + 1) % 3]!;
        next.push(a, mab, c, mab, b, mbc, mab, mbc, c);
      }
    }
    tris = next;
  }
  return compact(pos, tris);
}

/** Collapse edges shorter than `minLength` (to their midpoint), then clean up. */
export function collapseShortEdges(m: ProxyMesh, minLength: number): ProxyMesh {
  const pos = Float32Array.from(m.positions);
  const parent = Array.from({ length: vertexCount(m) }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const merged = new Set<number>();
  const short = edges(m)
    .map(([a, b]) => ({ a, b, l: distance(m, a, b) }))
    .filter((e) => e.l < minLength)
    .sort((x, y) => x.l - y.l);
  for (const { a, b } of short) {
    if (merged.has(a) || merged.has(b)) continue; // one collapse per vertex per pass keeps shape
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    for (let k = 0; k < 3; k++) pos[ra * 3 + k] = (pos[ra * 3 + k]! + pos[rb * 3 + k]!) / 2;
    parent[rb] = ra;
    merged.add(a);
    merged.add(b);
  }
  const idx: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) idx.push(find(m.index[t]!), find(m.index[t + 1]!), find(m.index[t + 2]!));
  return removeDegenerate(compact(pos, idx), 0);
}

/**
 * Make winding coherent across each connected surface (neighbours traverse a
 * shared edge in opposite directions), then flip closed shells whose volume is
 * negative so normals face outward.
 */
export function orientOutward(m: ProxyMesh): ProxyMesh {
  const tris = m.index.length / 3;
  const idx = Uint32Array.from(m.index);
  const edgeTris = new Map<string, number[]>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const kk = key(idx[t * 3 + k]!, idx[t * 3 + ((k + 1) % 3)]!);
      const list = edgeTris.get(kk);
      if (list) list.push(t);
      else edgeTris.set(kk, [t]);
    }
  }
  const directed = (t: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (idx[t * 3 + k] === a && idx[t * 3 + ((k + 1) % 3)] === b) return true;
    return false;
  };
  const flip = (t: number) => {
    const x = idx[t * 3 + 1]!;
    idx[t * 3 + 1] = idx[t * 3 + 2]!;
    idx[t * 3 + 2] = x;
  };
  const seen = new Uint8Array(tris);
  const components: number[][] = [];
  for (let s = 0; s < tris; s++) {
    if (seen[s]) continue;
    const comp: number[] = [];
    const queue = [s];
    seen[s] = 1;
    while (queue.length) {
      const t = queue.shift()!;
      comp.push(t);
      for (let k = 0; k < 3; k++) {
        const a = idx[t * 3 + k]!;
        const b = idx[t * 3 + ((k + 1) % 3)]!;
        for (const u of edgeTris.get(key(a, b)) ?? []) {
          if (u === t || seen[u]) continue;
          // Consistent neighbour walks the shared edge b→a; if it also walks a→b, flip it.
          if (directed(u, a, b)) flip(u);
          seen[u] = 1;
          queue.push(u);
        }
      }
    }
    components.push(comp);
  }
  // Closed components: outward = positive signed volume.
  for (const comp of components) {
    const sub: ProxyMesh = { positions: m.positions, index: new Uint32Array(comp.flatMap((t) => [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!])) };
    if (signedVolume(sub) < 0) for (const t of comp) flip(t);
  }
  return { positions: m.positions, index: idx };
}
