import { describe, expect, it } from 'vitest';
import { DEFAULT_PATTERN, patternAt, rasterizeMesh, valueNoise, type PatternSpec } from '../../src/shared/paints/patterns';

const bounds = { min: [-0.9, -2.2, 0.1] as [number, number, number], max: [0.9, 2.2, 1.4] as [number, number, number] };
const spec = (over: Partial<PatternSpec>): PatternSpec => ({ ...DEFAULT_PATTERN, ...over });

describe('paint patterns', () => {
  it('racing stripes: twin bands either side of the centre line, the same on both sides', () => {
    const s = spec({ kind: 'stripes', axis: 'width', size: 0.2, gap: 0.1, offset: 0 });
    expect(patternAt(s, [0, 0, 1], bounds)).toBeNull(); // the gap between them
    expect(patternAt(s, [0.12, 0, 1], bounds)).toEqual({ a: 0, b: 0, t: 0 });
    expect(patternAt(s, [-0.12, 1, 1], bounds)).toEqual({ a: 0, b: 0, t: 0 });
    expect(patternAt(s, [0.3, 0, 1], bounds)).toBeNull();
    // one wide stripe
    expect(patternAt({ ...s, gap: 0 }, [0.05, 0, 1], bounds)).not.toBeNull();
    // three colours: a pinstripe along the edges
    expect(patternAt({ ...s, colors: 3 }, [0.051, 0, 1], bounds)?.a).toBe(1);
  });

  it('side stripes are placed from the middle of the car height', () => {
    // bounds run 0.1–1.4 m up: the middle is 0.75 m
    const s = spec({ kind: 'stripes', axis: 'height', size: 0.1, gap: 0, offset: 0.1 });
    expect(patternAt(s, [0.9, 0, 0.85], bounds)).not.toBeNull();
    expect(patternAt(s, [0.9, 0, 0.75], bounds)).toBeNull();
  });

  it('gradient: front to back across the car, and reversible', () => {
    const s = spec({ kind: 'gradient', axis: 'length', from: 0, to: 1 });
    expect(patternAt(s, [0, -2.2, 1], bounds)!.t).toBeCloseTo(0);
    expect(patternAt(s, [0, 0, 1], bounds)!.t).toBeCloseTo(0.5);
    expect(patternAt(s, [0, 2.2, 1], bounds)!.t).toBeCloseTo(1);
    expect(patternAt({ ...s, from: 1, to: 0 }, [0, 2.2, 1], bounds)!.t).toBeCloseTo(0);
    // three colours: through the middle one
    expect(patternAt({ ...s, colors: 3 }, [0, 0.6, 1], bounds)).toMatchObject({ a: 1, b: 2 });
  });

  it('checker and camo use every colour, deterministically', () => {
    const pts: [number, number, number][] = [];
    for (let x = -0.9; x <= 0.9; x += 0.13) for (let y = -2.2; y <= 2.2; y += 0.17) pts.push([x, y, 0.8]);
    for (const kind of ['checker', 'camo', 'digital-camo'] as const) {
      const s = spec({ kind, colors: 3, size: 0.3, amount: 0.6 });
      const used = new Set(pts.map((p) => patternAt(s, p, bounds)!.a));
      expect([...used].sort(), kind).toEqual([0, 1, 2]);
      expect(pts.map((p) => patternAt(s, p, bounds)!.a)).toEqual(pts.map((p) => patternAt(s, p, bounds)!.a));
    }
    // a different seed moves the camo
    const a = pts.map((p) => patternAt(spec({ kind: 'camo', seed: 1 }), p, bounds)!.a).join('');
    const b = pts.map((p) => patternAt(spec({ kind: 'camo', seed: 2 }), p, bounds)!.a).join('');
    expect(a).not.toBe(b);
  });

  it('noise stays within 0–1', () => {
    for (let i = 0; i < 200; i++) {
      const n = valueNoise(i * 0.37, i * 0.11, -i * 0.23, 5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});

describe('texture rasteriser', () => {
  it('covers a UV quad with the positions it maps to', () => {
    // A 1 m × 1 m square in X/Y, UVs over the whole texture.
    const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    const index = [0, 1, 2, 0, 2, 3];
    const seen = new Map<string, [number, number, number]>();
    const n = rasterizeMesh({ positions, uvs, index }, { width: 16, height: 16, flipY: true }, (x, y, pos) => seen.set(`${x},${y}`, pos));
    expect(seen.size).toBe(256); // every pixel
    expect(n).toBeGreaterThanOrEqual(256);
    // flipY: the top row of the image is v = 1 (y = 1 m)
    expect(seen.get('0,0')![1]).toBeCloseTo(1 - 0.5 / 16, 1);
    expect(seen.get('15,15')![0]).toBeCloseTo(1 - 0.5 / 16, 1);
  });

  it('paints tiled UVs (1–2) on the same pixels as 0–1', () => {
    const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], index: null };
    const a = new Set<string>();
    const b = new Set<string>();
    rasterizeMesh({ ...tri, uvs: [0.1, 0.1, 0.9, 0.1, 0.1, 0.9] }, { width: 32, height: 32, flipY: false }, (x, y) => a.add(`${x},${y}`));
    rasterizeMesh({ ...tri, uvs: [1.1, 1.1, 1.9, 1.1, 1.1, 1.9] }, { width: 32, height: 32, flipY: false }, (x, y) => b.add(`${x},${y}`));
    expect(a.size).toBeGreaterThan(200);
    expect([...b].sort()).toEqual([...a].sort());
  });
});
