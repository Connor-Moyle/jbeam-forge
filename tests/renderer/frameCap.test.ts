import { describe, expect, it } from 'vitest';
import { frameDue } from '../../src/renderer/panels/viewport/frameCap';

/** Frames drawn per second at a display refresh rate with a cap. */
function rendered(hz: number, cap: number, seconds = 2): number {
  let last = 0;
  let n = 0;
  for (let t = 1000 / hz; t <= seconds * 1000; t += 1000 / hz) {
    const due = frameDue(t, last, cap);
    if (due === null) continue;
    last = due;
    n++;
  }
  return n / seconds;
}

describe('frame-rate cap', () => {
  it('averages out to the cap on any display, and never above the display rate', () => {
    expect(rendered(144, 120)).toBeCloseTo(120, -1);
    expect(rendered(144, 60)).toBeCloseTo(60, -1);
    expect(rendered(60, 60)).toBeCloseTo(60, -1);
    expect(rendered(60, 30)).toBeCloseTo(30, -1);
    expect(rendered(60, 144)).toBeLessThanOrEqual(60.5);
    expect(rendered(60, 0)).toBeCloseTo(60, -1);
  });

  it('restarts the schedule after a pause instead of catching up', () => {
    expect(frameDue(10_000, 0, 60)).toBe(10_000);
  });
});
