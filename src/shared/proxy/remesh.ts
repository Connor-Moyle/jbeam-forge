import { weld, type ProxyMesh } from './mesh';

/**
 * Surface remesher (Voronoi / ACVD-style) — the default proxy for panels and
 * shells. Decimation keeps whatever edges survive collapsing, which on real
 * car meshes (overlapping skins, many islands, long thin triangles) gives
 * blobs; this instead spreads nodes evenly *on* the surface, like official
 * jbeam nodes (~0.3 m apart, following the silhouette):
 *
 *   1. densify: split long triangle edges so the surface is finely sampled
 *   2. seeds: farthest-point sampling over the samples (even spacing)
 *   3. Lloyd relaxation: each seed moves to the surface sample nearest its region's area-weighted centroid
 *   4. graph: two nodes are joined by a beam when their regions touch along a mesh edge;
 *      a triangle is made where three regions meet in one mesh triangle (winding from the mesh)
 *   5. connectivity: separate islands are tied to their nearest neighbours
 *
 * Output nodes lie exactly on the input surface.
 */

export interface RemeshResult extends ProxyMesh {
  /** Beams that are not edges of any output triangle (region contacts, island ties). */
  extraEdges: [number, number][];
}

interface Dense {
  pos: Float64Array;
  tris: Uint32Array;
  area: Float64Array;
}

/** Split edges longer than `maxLen` until none remain or the vertex cap is hit (no cracks: shared midpoints). */
function densify(positions: ArrayLike<number>, index: ArrayLike<number>, maxLen: number, maxVerts: number): Dense {
  let pos = Array.from(positions);
  let tris = Array.from(index);
  for (let pass = 0; pass < 12; pass++) {
    const nv = pos.length / 3;
    const mids = new Map<number, number>();
    const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
    const len2 = (a: number, b: number) => (pos[a * 3]! - pos[b * 3]!) ** 2 + (pos[a * 3 + 1]! - pos[b * 3 + 1]!) ** 2 + (pos[a * 3 + 2]! - pos[b * 3 + 2]!) ** 2;
    const max2 = maxLen * maxLen;
    for (let t = 0; t < tris.length && pos.length / 3 < maxVerts; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k]!;
        const b = tris[t + ((k + 1) % 3)]!;
        const kk = key(a, b);
        if (mids.has(kk) || len2(a, b) <= max2) continue;
        mids.set(kk, pos.length / 3);
        pos.push((pos[a * 3]! + pos[b * 3]!) / 2, (pos[a * 3 + 1]! + pos[b * 3 + 1]!) / 2, (pos[a * 3 + 2]! + pos[b * 3 + 2]!) / 2);
      }
    }
    if (mids.size === 0) break;
    const next: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
      const m = [0, 1, 2].map((k) => mids.get(key(v[k]!, v[(k + 1) % 3]!)));
      const n = m.filter((x) => x !== undefined).length;
      if (n === 0) next.push(...v);
      else if (n === 3) {
        const [ab, bc, ca] = m as [number, number, number];
        next.push(v[0]!, ab, ca, ab, v[1]!, bc, ca, bc, v[2]!, ab, bc, ca);
      } else {
        const r = n === 1 ? m.findIndex((x) => x !== undefined) : (m.findIndex((x) => x === undefined) + 1) % 3;
        const a = v[r]!;
        const b = v[(r + 1) % 3]!;
        const c = v[(r + 2) % 3]!;
        const mab = m[r]!;
        if (n === 1) next.push(a, mab, c, mab, b, c);
        else {
          const mbc = m[(r + 1) % 3]!;
          next.push(a, mab, c, mab, b, mbc, mab, mbc, c);
        }
      }
    }
    tris = next;
    if (pos.length / 3 >= maxVerts) break;
  }
  pos = pos.slice();
  const P = Float64Array.from(pos);
  const T = Uint32Array.from(tris);
  const area = new Float64Array(P.length / 3);
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t]!;
    const b = T[t + 1]!;
    const c = T[t + 2]!;
    const ux = P[b * 3]! - P[a * 3]!;
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!;
    const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
    const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const A = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6; // a third of the triangle area
    area[a]! += A;
    area[b]! += A;
    area[c]! += A;
  }
  return { pos: P, tris: T, area };
}

/** Spatial hash over seed positions for nearest-seed queries. */
class SeedGrid {
  private cells = new Map<string, number[]>();
  constructor(
    private seeds: Float64Array,
    private cell: number,
  ) {
    for (let i = 0; i < seeds.length / 3; i++) {
      const k = this.key(seeds[i * 3]!, seeds[i * 3 + 1]!, seeds[i * 3 + 2]!);
      const l = this.cells.get(k);
      if (l) l.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  nearest(x: number, y: number, z: number): number {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r < 256; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            for (const i of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              const d = (this.seeds[i * 3]! - x) ** 2 + (this.seeds[i * 3 + 1]! - y) ** 2 + (this.seeds[i * 3 + 2]! - z) ** 2;
              if (d < bd) {
                bd = d;
                best = i;
              }
            }
          }
      if (best !== -1 && Math.sqrt(bd) <= r * this.cell) break;
    }
    return best;
  }
}

export interface RemeshOptions {
  /** Number of nodes wanted. */
  targetVertices: number;
  /** Lloyd iterations (evenness). */
  iterations?: number;
  /** Dihedral angle (degrees) above which an edge is a crease the nodes should follow. Default 35. */
  creaseAngleDeg?: number;
  /** Most of the budget feature lines may take (0..1). Default 0.6. */
  featureShare?: number;
}

/**
 * Feature samples: vertices on open boundaries (panel outlines, window openings)
 * and on creases sharper than `angleDeg` (sills, beltlines, panel folds). Official
 * nodes sit on exactly these lines.
 */
export function featureVertices(pos: ArrayLike<number>, tris: ArrayLike<number>, angleDeg: number): Uint8Array {
  const nv = pos.length / 3;
  const nt = tris.length / 3;
  const normals = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3]!;
    const b = tris[t * 3 + 1]!;
    const c = tris[t * 3 + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / l;
    normals[t * 3 + 1] = ny / l;
    normals[t * 3 + 2] = nz / l;
  }
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k]!;
      const b = tris[t * 3 + ((k + 1) % 3)]!;
      const key = a < b ? a * nv + b : b * nv + a;
      const l = edgeTris.get(key);
      if (l) l.push(t);
      else edgeTris.set(key, [t]);
    }
  }
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const out = new Uint8Array(nv);
  for (const [key, list] of edgeTris) {
    const a = Math.floor(key / nv);
    const b = key % nv;
    let feature = list.length === 1; // open boundary
    if (list.length === 2) {
      const t = list[0]!;
      const u = list[1]!;
      const dot = normals[t * 3]! * normals[u * 3]! + normals[t * 3 + 1]! * normals[u * 3 + 1]! + normals[t * 3 + 2]! * normals[u * 3 + 2]!;
      feature = Math.abs(dot) < cos; // |dot|: the same whichever way either face winds
    }
    if (feature) {
      out[a] = 1;
      out[b] = 1;
    }
  }
  return out;
}

/** Total surface area. */
export function surfaceArea(m: ProxyMesh): number {
  const p = m.positions;
  let A = 0;
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t]! * 3;
    const b = m.index[t + 1]! * 3;
    const c = m.index[t + 2]! * 3;
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return A;
}

export function remeshSurface(input: ProxyMesh, opts: RemeshOptions): RemeshResult {
  const welded = weld(input.positions, input.index, 1e-4);
  const N = Math.max(4, Math.round(opts.targetVertices));
  const area = surfaceArea(welded);
  if (welded.index.length < 3 || area <= 0) return { positions: new Float32Array(), index: new Uint32Array(), extraEdges: [] };
  // Spacing of an even triangular lattice with N vertices over this area.
  const spacing = Math.sqrt((2 * area) / (Math.sqrt(3) * N));
  // ~40 samples per node is plenty for even spacing (and keeps big flat shells cheap).
  const d = densify(welded.positions, welded.index, spacing / 3, Math.max(welded.positions.length / 3, Math.min(150_000, 40 * N)));
  const nv = d.pos.length / 3;
  // Seed-grid cell: the lattice spacing, but never tiny relative to the part (near-zero-area input
  // would otherwise make every nearest-seed query walk millions of empty cells).
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, d.pos[v * 3 + k]!);
      hi[k] = Math.max(hi[k]!, d.pos[v * 3 + k]!);
    }
  const gridCell = Math.max(spacing, Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 64, 1e-6);

  // Farthest-point seeds (start from the sample farthest from the area-weighted centroid).
  const c = [0, 0, 0];
  let wsum = 0;
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) c[k]! += d.pos[v * 3 + k]! * d.area[v]!;
    wsum += d.area[v]!;
  }
  for (let k = 0; k < 3; k++) c[k]! /= wsum || 1;
  const dist = new Float64Array(nv).fill(Infinity);
  let first = 0;
  let far = -1;
  for (let v = 0; v < nv; v++) {
    const dd = (d.pos[v * 3]! - c[0]!) ** 2 + (d.pos[v * 3 + 1]! - c[1]!) ** 2 + (d.pos[v * 3 + 2]! - c[2]!) ** 2;
    if (dd > far) {
      far = dd;
      first = v;
    }
  }
  const seedVerts: number[] = [];
  // Feature lines first: farthest-point sampling restricted to feature samples, until they are
  // covered at the lattice spacing (or their share of the budget is used).
  const isFeature = featureVertices(d.pos, d.tris, opts.creaseAngleDeg ?? 35);
  const featureList: number[] = [];
  for (let v = 0; v < nv; v++) if (isFeature[v]) featureList.push(v);
  const fixed = new Set<number>();
  if (featureList.length) {
    const fdist = new Float64Array(featureList.length).fill(Infinity);
    const maxFeatureSeeds = Math.floor(N * (opts.featureShare ?? 0.6));
    let fi = 0;
    let farC = -1;
    for (let i = 0; i < featureList.length; i++) {
      const v = featureList[i]!;
      const dd = (d.pos[v * 3]! - c[0]!) ** 2 + (d.pos[v * 3 + 1]! - c[1]!) ** 2 + (d.pos[v * 3 + 2]! - c[2]!) ** 2;
      if (dd > farC) {
        farC = dd;
        fi = i;
      }
    }
    const minGap2 = (spacing * 0.85) ** 2;
    while (seedVerts.length < maxFeatureSeeds) {
      const v = featureList[fi]!;
      seedVerts.push(v);
      fixed.add(v);
      const sx = d.pos[v * 3]!;
      const sy = d.pos[v * 3 + 1]!;
      const sz = d.pos[v * 3 + 2]!;
      let best = -1;
      for (let i = 0; i < featureList.length; i++) {
        const u = featureList[i]!;
        const dd = (d.pos[u * 3]! - sx) ** 2 + (d.pos[u * 3 + 1]! - sy) ** 2 + (d.pos[u * 3 + 2]! - sz) ** 2;
        if (dd < fdist[i]!) fdist[i] = dd;
        if (fdist[i]! > best) {
          best = fdist[i]!;
          fi = i;
        }
      }
      if (best < minGap2) break; // feature lines covered at the lattice spacing
    }
    // The general farthest-point pass continues from the feature seeds.
    for (const sv of seedVerts) {
      const sx = d.pos[sv * 3]!;
      const sy = d.pos[sv * 3 + 1]!;
      const sz = d.pos[sv * 3 + 2]!;
      for (let v = 0; v < nv; v++) {
        const dd = (d.pos[v * 3]! - sx) ** 2 + (d.pos[v * 3 + 1]! - sy) ** 2 + (d.pos[v * 3 + 2]! - sz) ** 2;
        if (dd < dist[v]!) dist[v] = dd;
      }
    }
    let bestD = -1;
    for (let v = 0; v < nv; v++) {
      if (dist[v]! > bestD) {
        bestD = dist[v]!;
        first = v;
      }
    }
  }
  let next = first;
  for (let s = seedVerts.length; s < Math.min(N, nv); s++) {
    seedVerts.push(next);
    const sx = d.pos[next * 3]!;
    const sy = d.pos[next * 3 + 1]!;
    const sz = d.pos[next * 3 + 2]!;
    let bestD = -1;
    for (let v = 0; v < nv; v++) {
      const dd = (d.pos[v * 3]! - sx) ** 2 + (d.pos[v * 3 + 1]! - sy) ** 2 + (d.pos[v * 3 + 2]! - sz) ** 2;
      if (dd < dist[v]!) dist[v] = dd;
      if (dist[v]! > bestD) {
        bestD = dist[v]!;
        next = v;
      }
    }
    if (bestD <= 0) break;
  }

  // Lloyd relaxation on the samples.
  const region = new Int32Array(nv);
  const assign = () => {
    const seeds = new Float64Array(seedVerts.length * 3);
    seedVerts.forEach((v, i) => seeds.set([d.pos[v * 3]!, d.pos[v * 3 + 1]!, d.pos[v * 3 + 2]!], i * 3));
    const grid = new SeedGrid(seeds, gridCell);
    for (let v = 0; v < nv; v++) region[v] = grid.nearest(d.pos[v * 3]!, d.pos[v * 3 + 1]!, d.pos[v * 3 + 2]!);
  };
  for (let it = 0; it < (opts.iterations ?? 4); it++) {
    assign();
    const S = seedVerts.length;
    const cx = new Float64Array(S);
    const cy = new Float64Array(S);
    const cz = new Float64Array(S);
    const w = new Float64Array(S);
    for (let v = 0; v < nv; v++) {
      const r = region[v]!;
      const a = d.area[v]! || 1e-12;
      cx[r]! += d.pos[v * 3]! * a;
      cy[r]! += d.pos[v * 3 + 1]! * a;
      cz[r]! += d.pos[v * 3 + 2]! * a;
      w[r]! += a;
    }
    // Move each seed to its region's sample closest to the centroid (stays on the surface).
    const best = new Float64Array(S).fill(Infinity);
    const bestV = seedVerts.slice();
    const onFeature = seedVerts.map((v) => fixed.has(v));
    for (let v = 0; v < nv; v++) {
      const r = region[v]!;
      if (!w[r]) continue;
      if (onFeature[r] && !isFeature[v]) continue; // feature nodes slide along their lines only
      const dd = (d.pos[v * 3]! - cx[r]! / w[r]) ** 2 + (d.pos[v * 3 + 1]! - cy[r]! / w[r]) ** 2 + (d.pos[v * 3 + 2]! - cz[r]! / w[r]) ** 2;
      if (dd < best[r]!) {
        best[r] = dd;
        bestV[r] = v;
      }
    }
    for (let r = 0; r < S; r++) {
      if (onFeature[r]) fixed.delete(seedVerts[r]!);
      seedVerts[r] = bestV[r]!;
      if (onFeature[r]) fixed.add(seedVerts[r]!);
    }
  }
  assign();

  // Graph from region contacts.
  const S = seedVerts.length;
  const positions = new Float32Array(S * 3);
  seedVerts.forEach((v, i) => positions.set([d.pos[v * 3]!, d.pos[v * 3 + 1]!, d.pos[v * 3 + 2]!], i * 3));
  const edgeSet = new Set<number>();
  const triSet = new Set<string>();
  const tris: number[] = [];
  const ek = (a: number, b: number) => (a < b ? a * S + b : b * S + a);
  for (let t = 0; t < d.tris.length; t += 3) {
    const ra = region[d.tris[t]!]!;
    const rb = region[d.tris[t + 1]!]!;
    const rc = region[d.tris[t + 2]!]!;
    if (ra !== rb) edgeSet.add(ek(ra, rb));
    if (rb !== rc) edgeSet.add(ek(rb, rc));
    if (rc !== ra) edgeSet.add(ek(rc, ra));
    if (ra !== rb && rb !== rc && rc !== ra) {
      const key = [ra, rb, rc].sort((x, y) => x - y).join(',');
      if (!triSet.has(key)) {
        triSet.add(key);
        tris.push(ra, rb, rc);
      }
    }
  }

  // Tie islands (fragmented meshes) to the rest: 2 nearest links per island.
  const parent = Int32Array.from({ length: S }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const k of edgeSet) {
    const a = Math.floor(k / S);
    const b = k % S;
    parent[find(a)] = find(b);
  }
  const dist2 = (a: number, b: number) => (positions[a * 3]! - positions[b * 3]!) ** 2 + (positions[a * 3 + 1]! - positions[b * 3 + 1]!) ** 2 + (positions[a * 3 + 2]! - positions[b * 3 + 2]!) ** 2;
  for (let guard = 0; guard < S; guard++) {
    const comps = new Map<number, number[]>();
    for (let i = 0; i < S; i++) {
      const r = find(i);
      const l = comps.get(r);
      if (l) l.push(i);
      else comps.set(r, [i]);
    }
    if (comps.size <= 1) break;
    // Join the smallest component to its nearest outside nodes.
    const small = [...comps.values()].sort((x, y) => x.length - y.length)[0]!;
    const inside = new Set(small);
    const pairs: [number, number, number][] = [];
    for (const a of small) for (let b = 0; b < S; b++) if (!inside.has(b)) pairs.push([a, b, dist2(a, b)]);
    pairs.sort((x, y) => x[2] - y[2]);
    const used = new Set<number>();
    let links = 0;
    for (const [a, b] of pairs) {
      if (used.has(a)) continue;
      edgeSet.add(ek(a, b));
      used.add(a);
      parent[find(a)] = find(b);
      if (++links >= Math.min(3, small.length + 1)) break;
    }
  }

  const triEdges = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) triEdges.add(ek(tris[t + k]!, tris[t + ((k + 1) % 3)]!));
  const extraEdges: [number, number][] = [];
  for (const k of edgeSet) if (!triEdges.has(k)) extraEdges.push([Math.floor(k / S), k % S]);
  return { positions, index: new Uint32Array(tris), extraEdges };
}
