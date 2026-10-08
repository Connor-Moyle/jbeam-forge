import { describe, expect, it } from 'vitest';
import { budgetWarnings } from '../../src/shared/export/budgets';

describe('what a car costs the game', () => {
  it('says nothing for a car like the game’s own', () => {
    expect(budgetWarnings({ nodes: 620, beams: 5400, triangles: 1300, meshes: 140 })).toEqual([]);
  });

  it('names each count that is over, by how much, and what to do', () => {
    const w = budgetWarnings({ nodes: 1650, beams: 5400, triangles: 4200, meshes: 140 });
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('1,650 nodes, 50% over');
    expect(w[1]).toContain('4,200 collision triangles, 50% over');
  });
});
