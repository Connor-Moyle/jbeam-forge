import { describe, expect, it } from 'vitest';
import { nodesTouchingOtherParts, pointTriangleDistance } from '../../src/shared/export/contact';

describe('nodes that start against another part', () => {
  it('measures a point’s distance to a triangle', () => {
    expect(pointTriangleDistance([0.2, 0.2, 0.5], [0, 0, 0], [1, 0, 0], [0, 1, 0])).toBeCloseTo(0.5);
    expect(pointTriangleDistance([2, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0])).toBeCloseTo(1);
  });

  it('finds a grille node tucked against the bumper, not one clear of it or on the bumper itself', () => {
    const nodes = [
      { id: 'bp1', partId: 'bumper', pos: [0, 0, 0] as const },
      { id: 'bp2', partId: 'bumper', pos: [1, 0, 0] as const },
      { id: 'bp3', partId: 'bumper', pos: [0, 0, 1] as const },
      { id: 'gr1', partId: 'grille', pos: [0.3, 0.01, 0.3] as const },
      { id: 'gr2', partId: 'grille', pos: [0.3, 0.2, 0.3] as const },
    ];
    const tris = [{ ids: ['bp1', 'bp2', 'bp3'] as [string, string, string], partId: 'bumper' }];
    expect([...nodesTouchingOtherParts(nodes, tris)]).toEqual(['gr1']);
  });
});
