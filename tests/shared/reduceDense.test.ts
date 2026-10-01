import { describe, expect, it } from 'vitest';
import { reduceDense } from '@shared/proxy/mesh';

/** A sphere of radius 1 centred at the origin, as a triangle soup of about 2·n² triangles. */
function sphere(n: number) {
  const pos: number[] = [];
  const at = (i: number, j: number) => {
    const th = (i / n) * Math.PI;
    const ph = (j / n) * 2 * Math.PI;
    return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return { positions: new Float32Array(pos), index: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) };
}

describe('dense meshes brought down before structure generation', () => {
  it('leaves a mesh under the budget alone', () => {
    const m = sphere(20);
    expect(reduceDense(m, 10_000)).toBe(m);
  });

  it('brings a dense mesh near the budget, keeping its shape and its mirror symmetry', () => {
    const m = sphere(400); // 320,000 triangles
    const r = reduceDense(m, 20_000);
    const tris = r.index.length / 3;
    expect(tris).toBeLessThan(30_000);
    expect(tris).toBeGreaterThan(2_000);
    let maxR = 0;
    let minR = Infinity;
    let sumX = 0;
    for (let i = 0; i < r.positions.length; i += 3) {
      const len = Math.hypot(r.positions[i]!, r.positions[i + 1]!, r.positions[i + 2]!);
      maxR = Math.max(maxR, len);
      minR = Math.min(minR, len);
      sumX += r.positions[i]!;
    }
    expect(maxR).toBeLessThan(1.01);
    expect(minR).toBeGreaterThan(0.95);
    expect(Math.abs(sumX / (r.positions.length / 3))).toBeLessThan(0.01);
  });
});
