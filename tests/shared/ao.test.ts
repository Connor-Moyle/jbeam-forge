import { describe, expect, it } from 'vitest';
import { aoValue, dilate, hemisphere, orient } from '../../src/shared/paints/ao';

describe('hemisphere', () => {
  it('gives unit directions on the +Z side, weighted towards the pole', () => {
    const d = hemisphere(64);
    expect(d).toHaveLength(64);
    for (const v of d) {
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
      expect(v[2]).toBeGreaterThan(0);
    }
    const meanZ = d.reduce((n, v) => n + v[2], 0) / d.length;
    expect(meanZ).toBeGreaterThan(0.6); // cosine-weighted: ≈ 2/3
  });
});

describe('orient', () => {
  it('turns +Z onto the normal and keeps directions on its side', () => {
    const n: [number, number, number] = [0, -3, 0];
    const up = orient([0, 0, 1], n);
    expect(up[1]).toBeCloseTo(-1, 6);
    for (const d of hemisphere(16)) expect(orient(d, n)[1]).toBeLessThan(0);
    expect(orient([0, 0, 1], [1, 0, 0])[0]).toBeCloseTo(1, 6);
  });
});

describe('dilate', () => {
  it('pushes baked values into empty neighbours', () => {
    const values = new Float32Array([0.2, 0, 0, 0]);
    const mask = new Uint8Array([1, 0, 0, 0]);
    dilate(values, mask, 4, 1, 2);
    expect(Array.from(mask)).toEqual([1, 1, 1, 0]);
    expect(values[2]).toBeCloseTo(0.2, 6);
  });
});

describe('aoValue', () => {
  it('is white when open and black when enclosed at full strength', () => {
    expect(aoValue(0, 1)).toBe(1);
    expect(aoValue(1, 1)).toBe(0);
    expect(aoValue(1, 0.5)).toBe(0.5);
  });
});
