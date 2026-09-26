/**
 * Mesh-splitting algorithms (SPEC §4.2), pure and framework-free.
 *
 * Inputs are flat arrays: `positions` (xyz per vertex) and `index` (3 vertex
 * indices per triangle). Everything is expressed as *triangle indices* of
 * the mesh being split, which is exactly what a split stores
 * (`triangleRuns`), so results are reproducible when the file is reopened.
 */

export type Positions = ArrayLike<number>;
export type Index = ArrayLike<number>;

export function triangleCount(index: Index): number {
  return Math.floor(index.length / 3);
}

/**
 * Canonical vertex id per vertex: vertices within `tolerance` of each other
 * share an id (UV/normal seams duplicate vertices at the same position; a
 * split must see through them). Spatial hash with neighbour-cell lookups.
 */
export function weldMap(positions: Positions, tolerance = 1e-5): Uint32Array {
  const n = Math.floor(positions.length / 3);
  const canon = new Uint32Array(n);
  const cell = Math.max(tolerance, 1e-9) * 2;
  const buckets = new Map<string, number[]>();
  const tol2 = tolerance * tolerance;
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let found = -1;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const o of list) {
            const ex = positions[o * 3]! - x;
            const ey = positions[o * 3 + 1]! - y;
            const ez = positions[o * 3 + 2]! - z;
            if (ex * ex + ey * ey + ez * ez <= tol2) {
              found = canon[o]!;
              break search;
            }
          }
        }
      }
    }
    canon[v] = found === -1 ? v : found;
    const key = `${cx},${cy},${cz}`;
    const list = buckets.get(key);
    if (list) list.push(v);
    else buckets.set(key, [v]);
  }
  return canon;
}

/** Edge-adjacent triangles (on welded vertices), as CSR arrays: neighbours of t are adj[offsets[t]..offsets[t+1]). */
export function triangleAdjacency(index: Index, canon: ArrayLike<number>): { offsets: Uint32Array; adj: Uint32Array } {
  const tris = triangleCount(index);
  const edges = new Map<string, number[]>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < tris; t++) {
    const a = canon[index[t * 3]!]!;
    const b = canon[index[t * 3 + 1]!]!;
    const c = canon[index[t * 3 + 2]!]!;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      if (p === q) continue; // degenerate edge
      const k = edgeKey(p, q);
      const list = edges.get(k);
      if (list) list.push(t);
      else edges.set(k, [t]);
    }
  }
  const neighbours: Set<number>[] = Array.from({ length: tris }, () => new Set<number>());
  for (const list of edges.values()) {
    for (const t of list) for (const u of list) if (t !== u) neighbours[t]!.add(u);
  }
  const offsets = new Uint32Array(tris + 1);
  for (let t = 0; t < tris; t++) offsets[t + 1] = offsets[t]! + neighbours[t]!.size;
  const adj = new Uint32Array(offsets[tris]!);
  for (let t = 0; t < tris; t++) {
    let i = offsets[t]!;
    for (const u of neighbours[t]!) adj[i++] = u;
  }
  return { offsets, adj };
}

/** Pieces that don't share an edge (after welding), largest first; each is a sorted triangle list. */
export function connectedComponents(positions: Positions, index: Index, tolerance = 1e-5): number[][] {
  const { offsets, adj } = triangleAdjacency(index, weldMap(positions, tolerance));
  const tris = triangleCount(index);
  const seen = new Uint8Array(tris);
  const out: number[][] = [];
  for (let s = 0; s < tris; s++) {
    if (seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const t = stack.pop()!;
      comp.push(t);
      for (let i = offsets[t]!; i < offsets[t + 1]!; i++) {
        const u = adj[i]!;
        if (!seen[u]) {
          seen[u] = 1;
          stack.push(u);
        }
      }
    }
    comp.sort((a, b) => a - b);
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length || a[0]! - b[0]!);
}

/** Unit face normals (zero for degenerate triangles). */
export function faceNormals(positions: Positions, index: Index): Float32Array {
  const tris = triangleCount(index);
  const out = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const a = index[t * 3]! * 3;
    const b = index[t * 3 + 1]! * 3;
    const c = index[t * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      out[t * 3] = nx / len;
      out[t * 3 + 1] = ny / len;
      out[t * 3 + 2] = nz / len;
    }
  }
  return out;
}

export function triangleCentroids(positions: Positions, index: Index): Float32Array {
  const tris = triangleCount(index);
  const out = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const a = index[t * 3]! * 3 + k;
      const b = index[t * 3 + 1]! * 3 + k;
      const c = index[t * 3 + 2]! * 3 + k;
      out[t * 3 + k] = (positions[a]! + positions[b]! + positions[c]!) / 3;
    }
  }
  return out;
}

export interface FloodOptions {
  /** Max angle between neighbouring face normals to cross (degrees). */
  maxAngleDeg?: number;
  /** Only grow within this distance of the seed's centroid (paint brush). */
  radius?: number;
  weldTolerance?: number;
}

/** Grow a region from seed triangles across smooth edges (angle limit) and/or within a radius. Sorted result. */
export function floodFill(positions: Positions, index: Index, seeds: readonly number[], opts: FloodOptions = {}, adjacency?: { offsets: Uint32Array; adj: Uint32Array }): number[] {
  const { offsets, adj } = adjacency ?? triangleAdjacency(index, weldMap(positions, opts.weldTolerance));
  const normals = opts.maxAngleDeg === undefined ? null : faceNormals(positions, index);
  const cosLimit = opts.maxAngleDeg === undefined ? -2 : Math.cos((opts.maxAngleDeg * Math.PI) / 180);
  const centroids = opts.radius === undefined ? null : triangleCentroids(positions, index);
  const tris = triangleCount(index);
  const seen = new Uint8Array(tris);
  const stack: number[] = [];
  const origins = seeds.filter((s) => s >= 0 && s < tris);
  for (const s of origins) {
    if (!seen[s]) {
      seen[s] = 1;
      stack.push(s);
    }
  }
  const r2 = opts.radius === undefined ? Infinity : opts.radius * opts.radius;
  const withinRadius = (u: number) => {
    if (!centroids) return true;
    for (const s of origins) {
      const dx = centroids[u * 3]! - centroids[s * 3]!;
      const dy = centroids[u * 3 + 1]! - centroids[s * 3 + 1]!;
      const dz = centroids[u * 3 + 2]! - centroids[s * 3 + 2]!;
      if (dx * dx + dy * dy + dz * dz <= r2) return true;
    }
    return false;
  };
  const out: number[] = [];
  while (stack.length) {
    const t = stack.pop()!;
    out.push(t);
    for (let i = offsets[t]!; i < offsets[t + 1]!; i++) {
      const u = adj[i]!;
      if (seen[u]) continue;
      if (normals) {
        const dot = normals[t * 3]! * normals[u * 3]! + normals[t * 3 + 1]! * normals[u * 3 + 1]! + normals[t * 3 + 2]! * normals[u * 3 + 2]!;
        if (dot < cosLimit) continue;
      }
      if (!withinRadius(u)) continue;
      seen[u] = 1;
      stack.push(u);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Triangles whose centroid lies on the positive side of the plane (point + normal). */
export function planeSide(positions: Positions, index: Index, point: readonly [number, number, number], normal: readonly [number, number, number]): number[] {
  const c = triangleCentroids(positions, index);
  const out: number[] = [];
  for (let t = 0; t < c.length / 3; t++) {
    const d = (c[t * 3]! - point[0]) * normal[0] + (c[t * 3 + 1]! - point[1]) * normal[1] + (c[t * 3 + 2]! - point[2]) * normal[2];
    if (d > 0) out.push(t);
  }
  return out;
}

/** Even–odd point-in-polygon test (polygon as [x0,y0,x1,y1,…]). */
export function pointInPolygon(x: number, y: number, polygon: ArrayLike<number>): boolean {
  let inside = false;
  const n = polygon.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i * 2]!;
    const yi = polygon[i * 2 + 1]!;
    const xj = polygon[j * 2]!;
    const yj = polygon[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Triangles whose projected centroid (xy per triangle, NaN = behind camera) is inside the polygon. */
export function trianglesInPolygon(projected: ArrayLike<number>, polygon: ArrayLike<number>): number[] {
  const out: number[] = [];
  if (polygon.length < 6) return out;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < polygon.length; i += 2) {
    minX = Math.min(minX, polygon[i]!);
    maxX = Math.max(maxX, polygon[i]!);
    minY = Math.min(minY, polygon[i + 1]!);
    maxY = Math.max(maxY, polygon[i + 1]!);
  }
  for (let t = 0; t < projected.length / 2; t++) {
    const x = projected[t * 2]!;
    const y = projected[t * 2 + 1]!;
    if (!(x >= minX && x <= maxX && y >= minY && y <= maxY)) continue; // also rejects NaN
    if (pointInPolygon(x, y, polygon)) out.push(t);
  }
  return out;
}

export function rectPolygon(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

/** Sorted, de-duplicated triangle list → [start, count] runs (the stored form). */
export function toRuns(triangles: Iterable<number>): [number, number][] {
  const sorted = [...new Set(triangles)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const t of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1] === t) last[1]++;
    else runs.push([t, 1]);
  }
  return runs;
}

export function fromRuns(runs: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  for (const [start, count] of runs) for (let i = 0; i < count; i++) out.push(start + i);
  return out;
}

/** Triangles not in `picked`, in order. */
export function complement(total: number, picked: Iterable<number>): number[] {
  const set = new Set(picked);
  const out: number[] = [];
  for (let t = 0; t < total; t++) if (!set.has(t)) out.push(t);
  return out;
}
