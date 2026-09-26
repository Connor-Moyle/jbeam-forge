import { Box3, Matrix4, Mesh, type BufferAttribute, type BufferGeometry, type Material, type Object3D } from 'three';
import { loaderToBeamngMatrix, type Box3Like } from '@shared/coords';
import type { Axis } from '@shared/project/schema';

/**
 * Loader space → baked meshes → BeamNG space.
 *
 * SPEC §2: "all geometry sampling reads world matrices" — ColladaLoader only
 * rotates the root for Z_UP files and BeamNG DAEs put a transform on every
 * node, so each mesh's matrixWorld is baked into its own geometry copy.
 */

export interface BakedMesh {
  /** Unique within the source (duplicates get " (2)", " (3)"…). */
  name: string;
  /** Geometry in loader space with the world matrix applied. */
  geometry: BufferGeometry;
  material: Material | Material[];
}

export interface ImportedMesh {
  /** `${sourceId}:${name}` — stable across re-imports of the same file. */
  key: string;
  sourceId: string;
  name: string;
  /** BeamNG space (Z up, −Y forward, +X left, metres). */
  geometry: BufferGeometry;
  material: Material | Material[];
  triangles: number;
}

export interface ImportSettings {
  scale: number;
  upAxis: Axis;
  forwardAxis: Axis;
}

export function triangleCount(g: BufferGeometry): number {
  return Math.floor((g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3);
}

/** Reverse triangle winding (needed after a mirroring transform). */
export function flipWinding(g: BufferGeometry): void {
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
  for (const name of Object.keys(g.attributes)) {
    const attr = g.getAttribute(name) as BufferAttribute;
    const size = attr.itemSize;
    const arr = attr.array;
    for (let v = 0; v + 2 < attr.count; v += 3) {
      for (let c = 0; c < size; c++) {
        const i1 = (v + 1) * size + c;
        const i2 = (v + 2) * size + c;
        const t = arr[i1]!;
        arr[i1] = arr[i2]!;
        arr[i2] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

function applyTransform(g: BufferGeometry, m: Matrix4): void {
  g.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(g);
}

function nearestName(obj: Object3D): string {
  for (let o: Object3D | null = obj; o; o = o.parent) if (o.name) return o.name;
  return '';
}

/** Every renderable mesh under `root`, with world transforms baked (loader space). Lines/points are skipped. */
export function bakeMeshes(root: Object3D): BakedMesh[] {
  root.updateMatrixWorld(true);
  const out: BakedMesh[] = [];
  const used = new Map<string, number>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const geometry = (obj.geometry as BufferGeometry).clone();
    if (!geometry.getAttribute('position') || triangleCount(geometry) === 0) return;
    applyTransform(geometry, obj.matrixWorld);
    const base = nearestName(obj) || `mesh_${out.length + 1}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.push({ name: n === 1 ? base : `${base} (${n})`, geometry, material: obj.material as Material | Material[] });
  });
  return out;
}

export function boundsOf(meshes: readonly BakedMesh[]): Box3Like | null {
  const box = new Box3();
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
  }
  return box.isEmpty() ? null : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/** Convert baked loader-space meshes to BeamNG space (consumes the baked geometries). */
export function toBeamng(meshes: readonly BakedMesh[], sourceId: string, settings: ImportSettings): ImportedMesh[] {
  const conv = new Matrix4().fromArray(loaderToBeamngMatrix(settings.upAxis, settings.forwardAxis, settings.scale));
  return meshes.map((m) => {
    applyTransform(m.geometry, conv);
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
    return { key: `${sourceId}:${m.name}`, sourceId, name: m.name, geometry: m.geometry, material: m.material, triangles: triangleCount(m.geometry) };
  });
}
