import { describe, expect, it } from 'vitest';
import { curvePeaks } from '../../src/shared/powertrain/edits';
import { figureProblems, shapeToFigures, type EngineFigures } from '../../src/shared/powertrain/figures';

// A game-like curve: builds to a peak at 4500 rpm, falls away to the limit at 7000.
const GAME: [number, number][] = [
  [0, 120],
  [1000, 180],
  [2000, 230],
  [3000, 265],
  [4000, 285],
  [4500, 290],
  [5500, 275],
  [6500, 245],
  [7000, 225],
  [7500, 200],
];

describe('setting an engine by its figures', () => {
  const hit = (f: EngineFigures) => {
    const c = shapeToFigures(GAME, 7000, f);
    const p = curvePeaks(c, f.limitRpm);
    expect(p.torque!.nm).toBeCloseTo(f.torqueNm, 0);
    expect(p.torque!.rpm).toBe(Math.round(f.torqueRpm));
    expect(p.power!.kw).toBeCloseTo(f.powerKw, 0);
    expect(p.power!.rpm).toBe(Math.round(f.powerRpm));
    expect(Math.max(...c.map(([r]) => r))).toBeGreaterThanOrEqual(f.limitRpm);
    for (let i = 1; i < c.length; i++) expect(c[i]![0]).toBeGreaterThan(c[i - 1]![0]);
    return c;
  };

  it('hits the asked peaks, each at its rpm', () => {
    hit({ torqueNm: 400, torqueRpm: 4000, powerKw: 220, powerRpm: 6200, limitRpm: 7000 });
    hit({ torqueNm: 250, torqueRpm: 3500, powerKw: 130, powerRpm: 6000, limitRpm: 6800 });
    // A high-revving one, and a diesel-like one with a low, broad peak.
    hit({ torqueNm: 300, torqueRpm: 7500, powerKw: 330, powerRpm: 11000, limitRpm: 12000 });
    hit({ torqueNm: 700, torqueRpm: 1800, powerKw: 230, powerRpm: 3500, limitRpm: 4500 });
  });

  it('keeps the curve’s character below the peak', () => {
    const c = hit({ torqueNm: 290 * 1.2, torqueRpm: 4500, powerKw: 200, powerRpm: 6000, limitRpm: 7000 });
    // Same peak rpm and limit: the low end is the game's, scaled.
    const at2000 = c.find(([r]) => r === 2000)![1];
    expect(at2000).toBeCloseTo(230 * 1.2, 0);
  });

  it('says why figures can’t all be true', () => {
    expect(figureProblems({ torqueNm: 400, torqueRpm: 4000, powerKw: 220, powerRpm: 6200, limitRpm: 7000 })).toEqual([]);
    expect(figureProblems({ torqueNm: 400, torqueRpm: 5000, powerKw: 150, powerRpm: 6000, limitRpm: 7000 }).join(' ')).toMatch(/already makes/);
    expect(figureProblems({ torqueNm: 200, torqueRpm: 3000, powerKw: 300, powerRpm: 6000, limitRpm: 7000 }).join(' ')).toMatch(/needs \d+ Nm/);
    expect(figureProblems({ torqueNm: 400, torqueRpm: 5000, powerKw: 300, powerRpm: 4000, limitRpm: 7000 }).join(' ')).toMatch(/after peak torque/);
    expect(() => shapeToFigures(GAME, 7000, { torqueNm: 200, torqueRpm: 3000, powerKw: 300, powerRpm: 6000, limitRpm: 7000 })).toThrow();
  });

  it('works from a curve with no usable shape', () => {
    const c = shapeToFigures([[0, 0]], 6000, { torqueNm: 300, torqueRpm: 4000, powerKw: 160, powerRpm: 5800, limitRpm: 6500 });
    const p = curvePeaks(c, 6500);
    expect(p.torque!.nm).toBeCloseTo(300, 0);
    expect(p.power!.kw).toBeCloseTo(160, 0);
  });
});
