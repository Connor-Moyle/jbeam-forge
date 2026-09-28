import { describe, expect, it } from 'vitest';
import { pixelsPerMetre, surfaceFrame } from '../../src/shared/paints/frame';

// A 1 m × 1 m panel in the Y/Z plane, mapped u = y, v = z onto a 1000 px image (rows run down: y_img = (1 − v) · 1000).
const P: [[number, number, number], [number, number, number], [number, number, number]] = [
  [0, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const Q: [[number, number], [number, number], [number, number]] = [
  [0, 1000],
  [1000, 1000],
  [0, 0],
];

describe('surface frame', () => {
  it('left side (facing +X): right runs along +Y, which is +x on the image; up is −y', () => {
    const f = surfaceFrame(P, Q, [1, 0, 0])!;
    expect(f.right[0]).toBeCloseTo(1000);
    expect(f.right[1]).toBeCloseTo(0);
    expect(f.up[0]).toBeCloseTo(0);
    expect(f.up[1]).toBeCloseTo(-1000);
    expect(pixelsPerMetre(f)).toBeCloseTo(1000);
  });

  it('the other side with the same UV layout: right flips, so text is drawn mirrored to read correctly', () => {
    const f = surfaceFrame(P, Q, [-1, 0, 0])!;
    expect(f.right[0]).toBeCloseTo(-1000);
    expect(f.up[1]).toBeCloseTo(-1000);
  });

  it('roof: "up" is the car front, and stretched UVs show as different scales', () => {
    const roof: typeof P = [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
    ];
    const q: typeof Q = [
      [0, 0],
      [500, 0],
      [0, 1000],
    ];
    const f = surfaceFrame(roof, q, [0, 0, 1])!;
    // up = −Y → image −y at 1000 px/m; right = up × n = (−1, 0, 0) → image −x at 500 px/m
    expect(f.up).toEqual([expect.closeTo(0), expect.closeTo(-1000)]);
    expect(f.right).toEqual([expect.closeTo(-500), expect.closeTo(0)]);
  });

  it('a degenerate triangle has no frame', () => {
    expect(surfaceFrame([P[0], P[0], P[0]], Q, [1, 0, 0])).toBeNull();
  });
});
