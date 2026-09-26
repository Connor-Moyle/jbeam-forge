import { Texture, type BufferGeometry, type Material } from 'three';
import type { ImportedMesh } from './normalize';

/**
 * Free everything an import created on the GPU: geometries, materials and the
 * textures in their slots (BC7 textures are several MB each). Each import owns
 * its materials, so nothing here is shared with another source.
 */
export function disposeImported(meshes: readonly ImportedMesh[]): void {
  const materials = new Set<Material>();
  for (const g of new Set(meshes.map((m) => m.geometry))) {
    g.disposeBoundsTree?.();
    g.dispose();
  }
  for (const m of meshes) {
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
  }
  disposeMaterials(materials);
}

/** Geometries only (split results): their attributes and materials belong to the raw import. */
export function disposeGeometries(meshes: readonly ImportedMesh[], keep: ReadonlySet<unknown>): void {
  for (const g of new Set(meshes.map((m) => m.geometry))) {
    if (keep.has(g)) continue;
    disposeSharingGeometry(g);
  }
}

/**
 * Dispose a geometry whose vertex attributes are shared with another one.
 * three.js frees the GPU buffers of every attribute on dispose, so the shared
 * ones are detached first (only this geometry's own index is freed).
 */
export function disposeSharingGeometry(g: BufferGeometry): void {
  g.disposeBoundsTree?.();
  for (const name of Object.keys(g.attributes)) g.deleteAttribute(name);
  g.dispose();
}

function disposeMaterials(materials: Set<Material>): void {
  for (const mat of materials) {
    for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
      if (value instanceof Texture) value.dispose();
    }
    mat.dispose();
  }
}
