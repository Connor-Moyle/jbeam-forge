/**
 * Ambient occlusion baking, the maths half: cosine-weighted directions over
 * a hemisphere, turned to face a surface normal, and a dilation pass that
 * pushes baked texels out past island edges so filtering and mipmaps never
 * pull in the empty background (a dark seam in game).
 */

export type Vec3 = [number, number, number];

/** `n` cosine-weighted directions around +Z (a Fibonacci spiral: even and repeatable, no noise). */
export function hemisphere(n: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * golden;
    out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
}

/** A direction given around +Z, turned to be around `normal` (normalised on the way). */
export function orient(d: Vec3, normal: Vec3): Vec3 {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  // Any axis not parallel to n, then two perpendiculars (Frisvad-style, branch on the sign).
  const a: Vec3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t: Vec3 = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
  const tl = Math.hypot(t[0], t[1], t[2]);
  t[0] /= tl;
  t[1] /= tl;
  t[2] /= tl;
  const b: Vec3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  return [0, 1, 2].map((i) => d[0] * t[i]! + d[1] * b[i]! + d[2] * n[i]!) as Vec3;
}

/**
 * Grow the baked area outward `passes` texels: each empty texel next to
 * baked ones takes their average. `mask` (1 = baked) is updated too.
 */
export function dilate(values: Float32Array, mask: Uint8Array, width: number, height: number, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const add: [number, number][] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (mask[i]) continue;
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const j = yy * width + xx;
            if (mask[j]) {
              sum += values[j]!;
              n++;
            }
          }
        }
        if (n) add.push([i, sum / n]);
      }
    }
    if (!add.length) return;
    for (const [i, v] of add) {
      values[i] = v;
      mask[i] = 1;
    }
  }
}

/** Occlusion (0–1 of rays blocked) as the texture's value: open = white, `strength` 1 = fully blocked is black. */
export function aoValue(blocked: number, strength: number): number {
  return Math.max(0, Math.min(1, 1 - blocked * strength));
}
