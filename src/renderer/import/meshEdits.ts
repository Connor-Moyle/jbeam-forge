import { Box3, BufferAttribute, Matrix4, Vector3, type BufferGeometry } from 'three';
import { editMatrix, flipsWinding, isIdentityTransform, isIdentityUv, mapUv, MIRROR_X, mirroredName, projectUvs } from '@shared/mesh/meshEdit';
import type { MeshCopy, MeshEdit } from '@shared/project/schema';
import type { ImportedMesh } from './normalize';

/**
 * Per-mesh edits and copies (v10), applied after splits: an edited or copied
 * mesh gets its own geometry with the move/turn/resize and texture mapping
 * baked in, so the viewport, picking, structure generation and export all
 * see the same thing. Unedited meshes pass through untouched.
 */

export const copyKey = (id: string) => `copy:${id}`;

function centre(g: BufferGeometry): [number, number, number] {
  if (!g.boundingBox) g.computeBoundingBox();
  const c = (g.boundingBox ?? new Box3()).getCenter(new Vector3());
  return [c.x, c.y, c.z];
}

function flipWinding(g: BufferGeometry): void {
  const index = g.index;
  if (index) {
    const a = index.array;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(g.attributes)) {
    const n = attr.itemSize;
    const arr = attr.array;
    for (let v = 0; v + 2 < attr.count; v += 3) {
      for (let k = 0; k < n; k++) {
        const t = arr[(v + 1) * n + k]!;
        arr[(v + 1) * n + k] = arr[(v + 2) * n + k]!;
        arr[(v + 2) * n + k] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

/** A new geometry: `matrix` applied (null = none), textures remapped (null = none). */
function baked(g: BufferGeometry, matrix: number[] | null, uv: MeshEdit['uv'] | null): BufferGeometry {
  let out = g.clone();
  out.boundsTree = undefined;
  if (matrix) {
    out.applyMatrix4(new Matrix4().fromArray(matrix));
    if (flipsWinding(matrix)) flipWinding(out);
  }
  if (uv?.project) {
    // Each triangle gets its own corners (triangle order, and so material groups and painted faces, unchanged).
    if (out.index) out = out.toNonIndexed();
    out.setAttribute('uv', new BufferAttribute(projectUvs(out.getAttribute('position').array, uv.project), 2));
  }
  if (uv) {
    for (const name of uv.project ? ['uv'] : ['uv', 'uv1']) {
      const attr = out.getAttribute(name);
      if (!attr) continue;
      for (let i = 0; i < attr.count; i++) {
        const [u, v] = mapUv(attr.getX(i), attr.getY(i), uv);
        attr.setXY(i, u, v);
      }
      attr.needsUpdate = true;
    }
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function edited(m: ImportedMesh, e: MeshEdit | undefined): ImportedMesh {
  if (!e) return m;
  const pivot = centre(m.geometry);
  const matrix = isIdentityTransform(e) ? null : editMatrix(e, pivot);
  const uv = isIdentityUv(e) ? null : e.uv;
  if (!matrix && !uv) return m;
  const geometry = baked(m.geometry, matrix, uv);
  // The centre the edit turns about, for the viewport gizmo's maths.
  geometry.userData.editPivot = pivot;
  return { ...m, geometry };
}

export function applyMeshEdits(meshes: readonly ImportedMesh[], edits: Readonly<Record<string, MeshEdit>>, copies: readonly MeshCopy[]): ImportedMesh[] {
  const out = meshes.map((m) => edited(m, edits[m.key]));
  const byKey = new Map(out.map((m) => [m.key, m]));
  for (const c of copies) {
    const from = byKey.get(c.from);
    if (!from) continue;
    const key = copyKey(c.id);
    const copy: ImportedMesh = { ...from, key, name: c.mirror ? mirroredName(from.name) : `${from.name} copy`, geometry: baked(from.geometry, c.mirror ? MIRROR_X : null, null) };
    const result = edited(copy, edits[key]);
    out.push(result);
    byKey.set(key, result);
  }
  return out;
}

/** Which edits and copies belong to a source's meshes (for the re-derive check). */
export function editsKey(meshKeys: ReadonlySet<string>, edits: Readonly<Record<string, MeshEdit>>, copies: readonly MeshCopy[]): string {
  const mine = copies.filter((c) => meshKeys.has(c.from));
  const keys = new Set([...meshKeys, ...mine.map((c) => copyKey(c.id))]);
  return JSON.stringify([mine, Object.entries(edits).filter(([k]) => keys.has(k))]);
}
