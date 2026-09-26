import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import type { Split } from '@shared/project/schema';
import { complement, fromRuns } from '@shared/mesh/split';
import { splitResultKey } from '@shared/mesh/splitOps';
import type { ImportedMesh } from './normalize';

/**
 * Non-destructive splits (SPEC §4.2): each split carves triangles out of a
 * mesh (possibly itself a split result) into a new mesh. Splits are applied in
 * document order to the freshly loaded meshes, so triangle indices always mean
 * the same thing when a project is reopened.
 *
 * Derived geometries *share* the source's vertex attributes (positions,
 * normals, UVs, colours) and only own a new index, so UVs and materials are
 * preserved exactly and nothing is copied.
 */


function triangleIndexArray(g: BufferGeometry): ArrayLike<number> {
  if (g.index) return g.index.array;
  const n = (g.getAttribute('position')?.count ?? 0) - ((g.getAttribute('position')?.count ?? 0) % 3);
  const implicit = new Uint32Array(n);
  for (let i = 0; i < n; i++) implicit[i] = i;
  return implicit;
}

export function geometryTriangleCount(g: BufferGeometry): number {
  return Math.floor(triangleIndexArray(g).length / 3);
}

/** A geometry holding only `triangles` (sorted) of `g`, sharing its attributes; material groups are carried over. */
export function subsetGeometry(g: BufferGeometry, triangles: readonly number[]): BufferGeometry {
  const src = triangleIndexArray(g);
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) out.setAttribute(name, attr);
  const index = new Uint32Array(triangles.length * 3);
  triangles.forEach((t, i) => {
    index[i * 3] = src[t * 3]!;
    index[i * 3 + 1] = src[t * 3 + 1]!;
    index[i * 3 + 2] = src[t * 3 + 2]!;
  });
  out.setIndex(new BufferAttribute(index, 1));
  if (g.groups.length && triangles.length) {
    const materialOf = (t: number) => g.groups.find((gr) => t * 3 >= gr.start && t * 3 < gr.start + gr.count)?.materialIndex ?? 0;
    let start = 0;
    for (let i = 1; i <= triangles.length; i++) {
      const cur = i < triangles.length ? materialOf(triangles[i]!) : -1;
      const prev = materialOf(triangles[i - 1]!);
      if (cur !== prev) {
        out.addGroup(start * 3, (i - start) * 3, prev);
        start = i;
      }
    }
  }
  // Bounds from the vertices this subset actually uses: the shared attribute holds the whole mesh.
  const pos = g.getAttribute('position');
  const box = new Box3();
  const v = new Vector3();
  for (let i = 0; i < index.length; i++) box.expandByPoint(v.fromBufferAttribute(pos, index[i]!));
  out.boundingBox = box;
  out.boundingSphere = box.isEmpty() ? new Sphere() : box.getBoundingSphere(new Sphere());
  return out;
}

export interface SplitResult {
  meshes: ImportedMesh[];
  /** Human-readable reasons some splits couldn't be applied (source changed on disk, …). */
  problems: string[];
}

/** Apply a source's splits (in order) to its freshly loaded meshes. */
export function applySplits(raw: readonly ImportedMesh[], splits: readonly Split[]): SplitResult {
  const list: ImportedMesh[] = [...raw];
  const problems: string[] = [];
  for (const split of splits) {
    const i = list.findIndex((m) => m.key === split.meshKey);
    const target = list[i];
    if (!target) {
      problems.push(`"${split.name}": mesh ${split.meshKey.slice(split.meshKey.indexOf(':') + 1)} not found`);
      continue;
    }
    const total = geometryTriangleCount(target.geometry);
    const picked = fromRuns(split.triangleRuns);
    if (picked.length === 0 || picked.some((t) => t < 0 || t >= total)) {
      problems.push(`"${split.name}": triangles no longer match ${target.name} (was the model changed?)`);
      continue;
    }
    const rest = complement(total, picked);
    const child: ImportedMesh = { key: splitResultKey(split), sourceId: target.sourceId, name: split.name, geometry: subsetGeometry(target.geometry, picked), material: target.material, triangles: picked.length };
    const replacement: ImportedMesh[] = rest.length ? [{ ...target, geometry: subsetGeometry(target.geometry, rest), triangles: rest.length }, child] : [child];
    list.splice(i, 1, ...replacement);
  }
  return { meshes: list, problems };
}

/** Splits that belong to a source (their mesh keys are prefixed with its id). */
export function splitsForSource(splits: readonly Split[], sourceId: string): Split[] {
  return splits.filter((s) => s.meshKey.startsWith(`${sourceId}:`));
}
