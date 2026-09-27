import { Matrix4, type BufferGeometry } from "three";
import { placementMatrix, samePlacement } from "@shared/placement";
import type { Placement } from "@shared/project/schema";
import type { ImportedMesh } from "./normalize";

/**
 * Move loaded geometry from one placement to another, in place (no reload).
 * Only the raw meshes are transformed; split pieces share their vertex data,
 * so re-derive them afterwards to refresh their bounds.
 */
export function applyPlacement(
  meshes: readonly ImportedMesh[],
  from: Placement,
  to: Placement,
): void {
  if (samePlacement(from, to)) return;
  const m = new Matrix4()
    .fromArray(placementMatrix(to))
    .multiply(new Matrix4().fromArray(placementMatrix(from)).invert());
  const seen = new Set<BufferGeometry>();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    if (seen.has(g)) continue;
    seen.add(g);
    g.applyMatrix4(m);
    g.disposeBoundsTree?.(); // picking BVH rebuilds on demand
  }
}
