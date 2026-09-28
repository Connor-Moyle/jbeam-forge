import { triangleAdjacency, weldMap, type Index, type Positions } from '../mesh/split';
import type { Vec3 } from './patterns';

/**
 * Material painting: giving triangles of a mesh another material (carbon
 * fibre on a bonnet, chrome on a trim line, matte black on a roof). In
 * BeamNG every triangle has exactly one material, so this is the real thing:
 * on export the painted triangles become their own material group of the
 * mesh, with the material's own textures, roughness and clear coat.
 *
 * Painted faces are stored per mesh as runs of triangle numbers
 * ([start, count, start, count…]) per material.
 */

export interface FaceRuns {
  materialId: string;
  runs: number[];
}

/** Triangle numbers → runs. */
export function encodeRuns(faces: Iterable<number>): number[] {
  const sorted = [...new Set(faces)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const f of sorted) {
    const n = out.length;
    if (n && out[n - 2]! + out[n - 1]! === f) out[n - 1]!++;
    else out.push(f, 1);
  }
  return out;
}

export function* decodeRuns(runs: readonly number[]): Generator<number> {
  for (let i = 0; i + 1 < runs.length; i += 2) for (let k = 0; k < runs[i + 1]!; k++) yield runs[i]! + k;
}

/** Which painted material each triangle has: an index into `ids`, or −1 (its own). */
export function faceAssignment(entries: readonly FaceRuns[] | undefined, triangles: number): { ids: string[]; face: Int32Array } {
  const face = new Int32Array(triangles).fill(-1);
  const ids: string[] = [];
  for (const e of entries ?? []) {
    let k = ids.indexOf(e.materialId);
    if (k < 0) k = ids.push(e.materialId) - 1;
    for (const f of decodeRuns(e.runs)) if (f < triangles) face[f] = k;
  }
  return { ids, face };
}

/** Back to stored form (materials in first-use order; unpainted faces left out). */
export function toEntries(ids: readonly string[], face: Int32Array): FaceRuns[] {
  const per = ids.map(() => [] as number[]);
  for (let t = 0; t < face.length; t++) if (face[t]! >= 0) per[face[t]!]!.push(t);
  return ids.flatMap((materialId, k) => (per[k]!.length ? [{ materialId, runs: encodeRuns(per[k]!) }] : []));
}

/** What painting needs of a mesh, worked out once: centroids, normals and which triangles touch. */
export interface FaceData {
  count: number;
  centroids: Float32Array;
  normals: Float32Array;
  offsets: Uint32Array;
  adj: Uint32Array;
}

export function faceData(positions: Positions, index: Index): FaceData {
  const count = Math.floor(index.length / 3);
  const centroids = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    const a = index[t * 3]! * 3;
    const b = index[t * 3 + 1]! * 3;
    const c = index[t * 3 + 2]! * 3;
    const e1 = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
    const e2 = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    for (let k = 0; k < 3; k++) {
      centroids[t * 3 + k] = (positions[a + k]! + positions[b + k]! + positions[c + k]!) / 3;
      normals[t * 3 + k] = n[k]! / l;
    }
  }
  const { offsets, adj } = triangleAdjacency(index, weldMap(positions));
  return { count, centroids, normals, offsets, adj };
}

/** Grow from a seed across neighbouring triangles while `ok` says so. */
function grow(d: FaceData, seed: number, ok: (t: number, from: number) => boolean): number[] {
  if (seed < 0 || seed >= d.count) return [];
  const seen = new Uint8Array(d.count);
  const out = [seed];
  seen[seed] = 1;
  for (let i = 0; i < out.length; i++) {
    const t = out[i]!;
    for (let j = d.offsets[t]!; j < d.offsets[t + 1]!; j++) {
      const u = d.adj[j]!;
      if (seen[u] || !ok(u, t)) continue;
      seen[u] = 1;
      out.push(u);
    }
  }
  return out;
}

/**
 * The brush: triangles connected to the one under the pointer whose middle
 * is within `radius` of the point (so it doesn't jump to a separate panel
 * that happens to be close, like the other side of a thin lip).
 */
export function brushFaces(d: FaceData, seed: number, at: Vec3, radius: number): number[] {
  const r2 = radius * radius;
  return grow(d, seed, (u) => {
    const dx = d.centroids[u * 3]! - at[0];
    const dy = d.centroids[u * 3 + 1]! - at[1];
    const dz = d.centroids[u * 3 + 2]! - at[2];
    return dx * dx + dy * dy + dz * dz <= r2;
  });
}

/** Fill a smooth area: grow across edges that bend less than `maxAngleDeg`. */
export function smoothFaces(d: FaceData, seed: number, maxAngleDeg: number): number[] {
  const cos = Math.cos((maxAngleDeg * Math.PI) / 180);
  return grow(d, seed, (u, from) => d.normals[u * 3]! * d.normals[from * 3]! + d.normals[u * 3 + 1]! * d.normals[from * 3 + 1]! + d.normals[u * 3 + 2]! * d.normals[from * 3 + 2]! >= cos);
}

/** Everything joined to the seed (one connected piece of the mesh). */
export function connectedFaces(d: FaceData, seed: number): number[] {
  return grow(d, seed, () => true);
}

/**
 * A mesh's triangles reordered so each material is one run, as a renderer
 * or the DAE writer wants: `order` lists original triangles, `groups` the
 * runs (material index: the mesh's own group material, or `base + k` for
 * painted material k).
 */
export function groupFaces(triangles: number, own: (t: number) => number, face: Int32Array, base: number): { order: Uint32Array; groups: { start: number; count: number; materialIndex: number }[] } {
  const key = (t: number) => (face[t]! >= 0 ? base + face[t]! : own(t));
  const tris = Array.from({ length: triangles }, (_, t) => t).sort((a, b) => key(a) - key(b) || a - b);
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  for (let i = 0; i < tris.length; i++) {
    const m = key(tris[i]!);
    const last = groups[groups.length - 1];
    if (last && last.materialIndex === m) last.count += 3;
    else groups.push({ start: i * 3, count: 3, materialIndex: m });
  }
  return { order: Uint32Array.from(tris), groups };
}
