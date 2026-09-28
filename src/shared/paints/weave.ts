/**
 * Woven-fibre textures (carbon fibre, Kevlar): a 2×2 twill of tows, each a
 * rounded bundle of fibres running across or along, as a colour image and a
 * tangent-space normal map. The picture tiles seamlessly (it's 4 tows by 4
 * tows), so it's used as the material's detail normal map, repeated across
 * the part; that's what makes the weave catch the light.
 */

export interface Weave {
  size: number;
  /** RGBA, row by row from the top. */
  albedo: Uint8ClampedArray;
  normal: Uint8ClampedArray;
}

/** Deterministic little hash (fibre streaks). */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * `size` pixels square (a multiple of 4), `tint` the resin/fibre colour
 * (sRGB 0–1): black for carbon, gold for Kevlar.
 */
export function makeWeave(size: number, tint: [number, number, number] = [0.08, 0.085, 0.095]): Weave {
  const n = Math.max(16, Math.round(size / 4) * 4);
  const cell = n / 4;
  const albedo = new Uint8ClampedArray(n * n * 4);
  const normal = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      // 2×2 twill: each tow passes over two and under two, stepping one along each row.
      const across = ((cx + cy) & 3) < 2;
      // Position across the tow (−1…1) and along it (0…1).
      const u = across ? ((y % cell) + 0.5) / cell : ((x % cell) + 0.5) / cell;
      const along = across ? x / n : y / n;
      const w = u * 2 - 1;
      // A rounded bundle: highest in the middle, dipping at its edges.
      const height = Math.sqrt(Math.max(0, 1 - w * w));
      const slope = -w / Math.max(0.25, height);
      // Fibre streaks along the tow.
      const fibre = hash((across ? y : x) * 131 + Math.floor(along * 7) * 17) * 0.25 + 0.75;
      const shade = (0.55 + 0.45 * height) * fibre * (across ? 1 : 0.82);
      const i = (y * n + x) * 4;
      for (let k = 0; k < 3; k++) albedo[i + k] = Math.round(Math.min(1, tint[k]! * (0.6 + shade * 0.9)) * 255);
      albedo[i + 3] = 255;
      // Tangent-space normal: tilted across the tow.
      const nx = across ? 0 : slope * 0.35;
      const ny = across ? -slope * 0.35 : 0;
      const len = Math.hypot(nx, ny, 1);
      normal[i] = Math.round((nx / len) * 127.5 + 127.5);
      normal[i + 1] = Math.round((ny / len) * 127.5 + 127.5);
      normal[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      normal[i + 3] = 255;
    }
  }
  return { size: n, albedo, normal };
}

/** Ready-made woven materials: name, fibre tint, and the look of the clear resin over it. */
export const WEAVES: { id: string; name: string; tint: [number, number, number]; base: [number, number, number]; metallic: number }[] = [
  { id: 'carbon', name: 'Carbon fibre', tint: [0.09, 0.095, 0.105], base: [0.06, 0.062, 0.068], metallic: 0.35 },
  { id: 'carbon_red', name: 'Red carbon', tint: [0.45, 0.04, 0.05], base: [0.28, 0.03, 0.035], metallic: 0.4 },
  { id: 'carbon_blue', name: 'Blue carbon', tint: [0.05, 0.12, 0.45], base: [0.03, 0.07, 0.28], metallic: 0.4 },
  { id: 'kevlar', name: 'Kevlar', tint: [0.85, 0.62, 0.12], base: [0.72, 0.52, 0.1], metallic: 0.15 },
];
