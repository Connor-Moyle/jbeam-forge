import { describe, expect, it } from 'vitest';
import { measuredFigures, withMeasured } from '../../src/shared/export/performance';

describe('the game’s measured figures', () => {
  it('keeps only what its performance tests write', () => {
    const info = { Configuration: 'Base', 'Top Speed': 52.3, '0-100 km/h': 7.1, Weight: 1240, BoundingBox: [[0, 0, 0]], Value: 12000 };
    expect(measuredFigures(info)).toEqual({ 'Top Speed': 52.3, '0-100 km/h': 7.1, Weight: 1240 });
    expect(measuredFigures(null)).toEqual({});
  });

  it('puts them over what export guessed and leaves the rest', () => {
    const text = withMeasured(JSON.stringify({ Configuration: 'Base', Weight: 1100 }), { Weight: 1240, '100-0 km/h': 38.2 });
    expect(JSON.parse(text)).toEqual({ Configuration: 'Base', Weight: 1240, '100-0 km/h': 38.2 });
    expect(withMeasured('{"a":1}', {})).toBe('{"a":1}');
  });
});
