import type { Vec3 } from './patterns';

/**
 * How the car's surface lies on the texture at a triangle: which way "up"
 * and "right" (as seen from outside the car) run on the image, in texture
 * pixels per metre. With it, a stamped number comes out upright and reading
 * the right way on any panel, whatever its UV layout, and brush and stamp
 * sizes can be given in centimetres on the car.
 */

export interface SurfaceFrame {
  /** Texture pixels per metre along the car's "right" at this point (x, y in image pixels). */
  right: [number, number];
  /** Texture pixels per metre along "up". */
  up: [number, number];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * `p`: the triangle's corners (BeamNG space), `q`: the same corners on the
 * image (pixels), `n`: its outward normal. "Up" is the car's up (+Z); on
 * surfaces facing up or down (roof, bonnet) it's the car's front (−Y), so
 * text there reads from the side of the car.
 */
export function surfaceFrame(p: [Vec3, Vec3, Vec3], q: [[number, number], [number, number], [number, number]], n: Vec3): SurfaceFrame | null {
  const nn = norm(n);
  const e1 = sub(p[1], p[0]);
  const e2 = sub(p[2], p[0]);
  const f1: [number, number] = [q[1][0] - q[0][0], q[1][1] - q[0][1]];
  const f2: [number, number] = [q[2][0] - q[0][0], q[2][1] - q[0][1]];
  const g11 = dot(e1, e1);
  const g12 = dot(e1, e2);
  const g22 = dot(e2, e2);
  const det = g11 * g22 - g12 * g12;
  if (Math.abs(det) < 1e-12) return null;
  // A direction in the triangle's plane → the same direction on the image.
  const onImage = (d: Vec3): [number, number] => {
    const r1 = dot(d, e1);
    const r2 = dot(d, e2);
    const a = (r1 * g22 - r2 * g12) / det;
    const b = (r2 * g11 - r1 * g12) / det;
    return [a * f1[0] + b * f2[0], a * f1[1] + b * f2[1]];
  };
  const worldUp: Vec3 = Math.abs(nn[2]) > 0.8 ? [0, -1, 0] : [0, 0, 1];
  const up = norm(sub(worldUp, nn.map((c) => c * dot(worldUp, nn)) as Vec3));
  const right = norm(cross(up, nn));
  return { right: onImage(right), up: onImage(up) };
}

/** Pixels per metre on the image around a point (the average stretch of the frame). */
export function pixelsPerMetre(f: SurfaceFrame): number {
  return Math.sqrt(Math.hypot(...f.right) * Math.hypot(...f.up)) || 1;
}
