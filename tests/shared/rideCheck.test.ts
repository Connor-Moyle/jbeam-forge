import { describe, expect, it } from 'vitest';
import { dropCurve } from '../../src/shared/sim/rideCheck';

describe('suspension check drop', () => {
  const frames = dropCurve({ height: 0.2, travel: 0.1, seconds: 4 });

  it('falls, lands, compresses (never past the bump stop) and settles at ride height', () => {
    expect(frames[0]!.wheels).toBeCloseTo(0.2, 3);
    const landed = frames.findIndex((f) => f.wheels === 0);
    expect(landed).toBeGreaterThan(0);
    expect(landed / 60).toBeCloseTo(Math.sqrt((2 * 0.2) / 9.81), 1);
    const peak = Math.max(...frames.map((f) => f.compression));
    expect(peak).toBeGreaterThan(0.03);
    expect(peak).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(Math.abs(frames.at(-1)!.compression)).toBeLessThan(0.01);
  });

  it('a hard drop reaches the bump stop', () => {
    const hard = dropCurve({ height: 0.6, travel: 0.08 });
    expect(Math.max(...hard.map((f) => f.compression))).toBeCloseTo(0.08, 2);
  });
});
