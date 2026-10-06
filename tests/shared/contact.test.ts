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

describe('parts made to close against the body', () => {
  it('keep their contact: a door shuts on the jamb, and the jamb stays solid for it', () => {
    const nodes = [
      { id: 'b1', partId: 'body', pos: [0, 0, 0] as const },
      { id: 'b2', partId: 'body', pos: [1, 0, 0] as const },
      { id: 'b3', partId: 'body', pos: [0, 0, 1] as const },
      { id: 'd1', partId: 'door', pos: [0.3, 0.01, 0.3] as const },
      { id: 'd2', partId: 'door', pos: [0.6, 0.01, 0.3] as const },
      { id: 'd3', partId: 'door', pos: [0.3, 0.01, 0.6] as const },
    ];
    const tris = [
      { ids: ['b1', 'b2', 'b3'] as [string, string, string], partId: 'body' },
      { ids: ['d1', 'd2', 'd3'] as [string, string, string], partId: 'door' },
    ];
    expect(nodesTouchingOtherParts(nodes, tris).size).toBeGreaterThan(0);
    expect([...nodesTouchingOtherParts(nodes, tris, undefined, new Set(['door']))]).toEqual([]);
  });
});
