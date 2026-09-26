import { Texture, type Material } from 'three';
import type { ImportedMesh } from './normalize';

/**
 * Free everything an import created on the GPU: geometries, materials and the
 * textures in their slots (BC7 textures are several MB each). Each import owns
 * its materials, so nothing here is shared with another source.
 */
export function disposeImported(meshes: readonly ImportedMesh[]): void {
  const materials = new Set<Material>();
  for (const m of meshes) {
    m.geometry.disposeBoundsTree?.();
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
  }
  for (const mat of materials) {
    for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
      if (value instanceof Texture) value.dispose();
    }
    mat.dispose();
  }
}
