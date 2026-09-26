/**
 * THE coordinate conversion module (SPEC §2, §3.8). Nothing else in the app
 * converts between spaces.
 *
 * BeamNG space (verified against official node positions, Phase 2):
 *   +Z up, +Y rearward (vehicles face −Y), +X towards the vehicle's LEFT.
 *   Right-handed: left × rear = up.
 *
 * "Loader space" is what three.js loaders produce after their own up-axis
 * handling (ColladaLoader turns Z_UP files into Y-up, glTF is Y-up, …). The
 * user's import settings say which loader-space axes are the vehicle's up and
 * forward; everything else follows:
 *
 *   L = U × F          (left)
 *   x_b = p·L,  y_b = −p·F,  z_b = p·U      (then × metres-per-unit)
 *
 * For a BeamNG-exported Z_UP DAE loaded by ColladaLoader the defaults
 * (up +y, forward +z) give back the file's original coordinates exactly.
 *
 * The viewport shows BeamNG space inside one root rotated −90° about X
 * (see BEAMNG_TO_VIEW_ROTATION_X), i.e. view = (x_b, z_b, −y_b).
 */
import type { Axis } from './project/schema';

export type Vec3 = readonly [number, number, number];

export const AXIS_VECTORS: Record<Axis, Vec3> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

/** Loader-space defaults: three.js convention (Y up), vehicle front toward +Z. */
export const DEFAULT_UP: Axis = '+y';
export const DEFAULT_FORWARD: Axis = '+z';

/** Rotation (radians about X) of the viewport root that displays BeamNG space in three's Y-up world. */
export const BEAMNG_TO_VIEW_ROTATION_X = -Math.PI / 2;

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Up and forward must be perpendicular (different axis letters). */
export function axesValid(up: Axis, forward: Axis): boolean {
  return up[1] !== forward[1];
}

/**
 * Column-major 4×4 matrix (three.js `Matrix4.fromArray` order) taking
 * loader-space points to BeamNG space, including unit scale.
 */
export function loaderToBeamngMatrix(up: Axis, forward: Axis, metresPerUnit: number): number[] {
  if (!axesValid(up, forward)) throw new Error(`Up (${up}) and forward (${forward}) must be different axes`);
  const U = AXIS_VECTORS[up];
  const F = AXIS_VECTORS[forward];
  const L = cross(U, F);
  const s = metresPerUnit;
  // Rows of the linear part: x_b = L·p, y_b = −F·p, z_b = U·p
  const r0 = L.map((v) => v * s);
  const r1 = F.map((v) => -v * s);
  const r2 = U.map((v) => v * s);
  // Column-major
  return [r0[0]!, r1[0]!, r2[0]!, 0, r0[1]!, r1[1]!, r2[1]!, 0, r0[2]!, r1[2]!, r2[2]!, 0, 0, 0, 0, 1];
}

/** Apply a column-major 4×4 to a point. */
export function transformPoint(m: readonly number[], p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

/** BeamNG point → viewport (three) point, matching the root rotation. */
export function beamngToView(p: Vec3): Vec3 {
  return [p[0], p[2], -p[1]];
}

export interface Box3Like {
  min: Vec3;
  max: Vec3;
}

/**
 * Exact bounding box after an axis-permutation/sign/scale transform (all our
 * import transforms are of that form), from the box's 8 corners.
 */
export function transformBox(m: readonly number[], box: Box3Like): Box3Like {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
    const t = transformPoint(m, corner);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, t[k]!);
      max[k] = Math.max(max[k]!, t[k]!);
    }
  }
  return { min, max };
}
