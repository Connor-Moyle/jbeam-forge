import { describe, expect, it } from 'vitest';
import { engineFit, engineFitWarning } from '../../src/shared/powertrain/fit';

const own = { min: [-0.3, -1.85, 0.2], max: [0.3, -1.0, 0.75] } as const;

describe('a fitted engine against the car’s own engine', () => {
  it('fits when its block is within the car’s own engine, give or take a few centimetres', () => {
    const fit = engineFit({ min: [-0.25, -0.4, 0.1], max: [0.25, 0.4, 0.6] }, [0, -1.42, 0.12], own);
    expect(fit).toEqual({ ahead: 0, behind: 0, above: 0, below: 0, wide: 0 });
    expect(engineFitWarning('Covet 1.5', fit)).toBeNull();
  });

  it('says how far a long, tall block stands out, and which way (the pickup’s straight-six)', () => {
    const fit = engineFit({ min: [-0.26, -0.55, 0.0], max: [0.26, 0.55, 0.72] }, [0, -1.3, 0.2], own);
    expect(fit.behind).toBeCloseTo(0.25, 2);
    expect(fit.above).toBeCloseTo(0.17, 2);
    expect(fit.ahead).toBe(0);
    const text = engineFitWarning('Gavril 4.1L I6', fit)!;
    expect(text).toContain('25 cm further back, 17 cm higher');
  });
});
