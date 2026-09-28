/**
 * Paint patterns worked out in the car's own space (BeamNG metres: +X left,
 * −Y forward, +Z up) rather than on the texture, so a stripe or a camo blob
 * carries on across panels and UV seams the way real paint would. Each
 * pattern says, for a point on the car, which of its colours goes there (and
 * how much of the next one, for fades), or nothing (leave it as it is).
 *
 * On a livery the colours are real colours; on the paint-slot mask they're
 * paint slots, so a camo on the mask is one the player can recolour in game.
 */

export type Vec3 = [number, number, number];

export type PatternKind = 'gradient' | 'stripes' | 'checker' | 'camo' | 'digital-camo' | 'speckle';
export type Axis = 'length' | 'height' | 'width';

export interface PatternSpec {
  kind: PatternKind;
  /** gradient: the direction of the fade; stripes: across which axis the bands sit. */
  axis: Axis;
  /** stripes: band width (m); checker / camo / speckle: size of a square or blob (m). */
  size: number;
  /** stripes: gap between twin stripes (m); 0 = one stripe. */
  gap: number;
  /** stripes: where the stripes are centred along the axis (m, from the car's centre). */
  offset: number;
  /** gradient: where the fade starts and ends, 0–1 along the car. */
  from: number;
  to: number;
  /** camo / speckle: how much of the colour(s) after the first, 0–1. */
  amount: number;
  seed: number;
  /** How many colours the pattern uses (2 or 3). */
  colors: 2 | 3;
}

export const DEFAULT_PATTERN: PatternSpec = { kind: 'stripes', axis: 'width', size: 0.25, gap: 0.08, offset: 0, from: 0.25, to: 0.75, amount: 0.5, seed: 1, colors: 2 };

/** What goes at a point: colour `a`, or a blend `t` of the way to colour `b`. */
export interface PatternSample {
  a: number;
  b: number;
  t: number;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { width: 0, length: 1, height: 2 };

/** Integer hash → 0–1 (deterministic per seed). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth 3D value noise, 0–1. */
export function valueNoise(x: number, y: number, z: number, seed: number): number {
  const [xi, yi, zi] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const [xf, yf, zf] = [smooth(x - xi), smooth(y - yi), smooth(z - zi)];
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

/** Layered noise (blobby camo shapes), roughly 0–1. */
function fbm(p: Vec3, scale: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1 / Math.max(0.01, scale);
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(p[0] * f, p[1] * f, p[2] * f, seed + o * 17);
    f *= 2.1;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

/** The pattern at a point on the car, or null to leave it alone. */
export function patternAt(spec: PatternSpec, p: Vec3, bounds: Bounds): PatternSample | null {
  const i = AXIS_INDEX[spec.axis];
  switch (spec.kind) {
    case 'gradient': {
      const span = bounds.max[i] - bounds.min[i] || 1;
      // Along the car, 0 is the front (−Y); up, 0 is the bottom; across, 0 is the right (−X).
      const u = (p[i] - bounds.min[i]) / span;
      const [a, b] = spec.from <= spec.to ? [spec.from, spec.to] : [spec.to, spec.from];
      const t = Math.min(1, Math.max(0, (u - a) / Math.max(1e-6, b - a)));
      const k = spec.from <= spec.to ? t : 1 - t;
      if (spec.colors === 3) return k < 0.5 ? { a: 0, b: 1, t: k * 2 } : { a: 1, b: 2, t: (k - 0.5) * 2 };
      return { a: 0, b: 1, t: k };
    }
    case 'stripes': {
      // Across the car the centre line is X = 0; along it and up it, the middle of the car.
      const centre = i === 0 ? 0 : (bounds.min[i] + bounds.max[i]) / 2;
      const d = Math.abs(p[i] - centre - spec.offset);
      const half = spec.gap / 2;
      const inside = spec.gap > 0 ? d >= half && d <= half + spec.size : d <= spec.size / 2;
      if (!inside) return null;
      // Three colours: a pinstripe of the third along each edge of the band.
      if (spec.colors === 3) {
        const edge = Math.min(spec.size * 0.12, 0.02);
        const inner = spec.gap > 0 ? d - half : d + spec.size / 2;
        if (inner < edge || inner > spec.size - edge) return { a: 1, b: 1, t: 0 };
      }
      return { a: 0, b: 0, t: 0 };
    }
    case 'checker': {
      const s = Math.max(0.005, spec.size);
      const n = Math.floor(p[0] / s) + Math.floor(p[1] / s) + Math.floor(p[2] / s);
      const k = ((n % spec.colors) + spec.colors) % spec.colors;
      return { a: k, b: k, t: 0 };
    }
    case 'camo':
    case 'digital-camo': {
      const s = Math.max(0.01, spec.size);
      // Digital camo: the same blobs, snapped to little squares.
      const q = spec.kind === 'digital-camo' ? s / 6 : 0;
      const pp: Vec3 = q ? [Math.floor(p[0] / q) * q, Math.floor(p[1] / q) * q, Math.floor(p[2] / q) * q] : p;
      const n = fbm(pp, s, spec.seed);
      // `amount` of the car goes to the colours after the first, split evenly between them.
      const cut1 = 1 - spec.amount;
      if (n < cut1) return { a: 0, b: 0, t: 0 };
      if (spec.colors === 2) return { a: 1, b: 1, t: 0 };
      const n2 = fbm([pp[0] + 31.7, pp[1] - 12.3, pp[2] + 5.1], s * 0.8, spec.seed + 101);
      return n2 < 0.5 ? { a: 1, b: 1, t: 0 } : { a: 2, b: 2, t: 0 };
    }
    case 'speckle': {
      const s = Math.max(0.002, spec.size);
      const cell: Vec3 = [Math.floor(p[0] / s), Math.floor(p[1] / s), Math.floor(p[2] / s)];
      const h = hash3(cell[0], cell[1], cell[2], spec.seed);
      if (h > spec.amount) return null;
      const k = spec.colors === 3 ? (hash3(cell[0], cell[1], cell[2], spec.seed + 7) < 0.5 ? 0 : 1) : 0;
      return { a: k, b: k, t: 0 };
    }
  }
}

/**
 * Every texture pixel a mesh's triangles cover, with the point on the car it
 * shows: `write(x, y, pos)` per pixel. UVs map to pixels with `flipY` (rows
 * bottom-up for DAE/FBX/OBJ UVs). Pixels a hair outside a triangle count too,
 * so there are no hairline gaps along its edges.
 */
export function rasterizeMesh(
  mesh: { positions: ArrayLike<number>; uvs: ArrayLike<number>; index: ArrayLike<number> | null; normals?: ArrayLike<number> | null },
  size: { width: number; height: number; flipY: boolean },
  write: (x: number, y: number, pos: Vec3, nrm: Vec3 | null) => void,
): number {
  const { positions: P, uvs: U, index } = mesh;
  const Nn = mesh.normals ?? null;
  const count = index ? index.length : P.length / 3;
  const { width: W, height: H } = size;
  let pixels = 0;
  const eps = 0.02;
  for (let t = 0; t + 2 < count; t += 3) {
    const v = [0, 1, 2].map((k) => (index ? index[t + k]! : t + k)) as [number, number, number];
    // Tiled UVs: the whole triangle is shifted back into 0–1 together (a vertex at exactly 1 stays at the edge).
    const us = v.map((k) => U[k * 2]!);
    const vs = v.map((k) => U[k * 2 + 1]!);
    const du = Math.min(...us) < 0 || Math.max(...us) > 1 ? Math.floor(Math.min(...us)) : 0;
    const dv = Math.min(...vs) < 0 || Math.max(...vs) > 1 ? Math.floor(Math.min(...vs)) : 0;
    const [a, b, c] = [0, 1, 2].map((k) => [(us[k]! - du) * W, (size.flipY ? 1 - (vs[k]! - dv) : vs[k]! - dv) * H]) as [[number, number], [number, number], [number, number]];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) - 1));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0]) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) - 1));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1]) + 1));
    const pos = (k: number, i: number) => P[v[k]! * 3 + i]!;
    const nrm = (k: number, i: number) => Nn![v[k]! * 3 + i]!;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5;
        const sy = y + 0.5;
        const w0 = ((b[0] - sx) * (c[1] - sy) - (c[0] - sx) * (b[1] - sy)) / area;
        const w1 = ((c[0] - sx) * (a[1] - sy) - (a[0] - sx) * (c[1] - sy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
        write(x, y, [0, 1, 2].map((i) => w0 * pos(0, i) + w1 * pos(1, i) + w2 * pos(2, i)) as Vec3, Nn ? ([0, 1, 2].map((i) => w0 * nrm(0, i) + w1 * nrm(1, i) + w2 * nrm(2, i)) as Vec3) : null);
        pixels++;
      }
    }
  }
  return pixels;
}
