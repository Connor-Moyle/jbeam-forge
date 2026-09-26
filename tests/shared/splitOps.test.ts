import { describe, expect, it } from 'vitest';
import { addSplit, removeSplit, splitProducing, splitResultKey, uniqueMeshName } from '../../src/shared/mesh/splitOps';
import type { Project } from '../../src/shared/project/schema';

const doc = (): Pick<Project, 'splits' | 'assignments' | 'ignoredMeshes'> => ({ splits: [], assignments: { 's:body': 'p1' }, ignoredMeshes: [] });

describe('split document ops', () => {
  it('stores triangles as runs and inherits the parent part', () => {
    const d = doc();
    const s = addSplit(d, { meshKey: 's:body', name: 'hood', triangles: [3, 4, 5, 9], id: 'a' });
    expect(s.triangleRuns).toEqual([
      [3, 3],
      [9, 1],
    ]);
    expect(d.assignments[splitResultKey(s)]).toBe('p1');
    expect(splitProducing(d, 's:body/a')).toBe(s);
    expect(() => addSplit(d, { meshKey: 's:body', name: 'x', triangles: [] })).toThrow();
  });

  it('removing a split cascades to splits of its result and cleans flags', () => {
    const d = doc();
    addSplit(d, { meshKey: 's:body', name: 'front', triangles: [0, 1], id: 'a' });
    addSplit(d, { meshKey: 's:body/a', name: 'grille', triangles: [0], id: 'b' });
    addSplit(d, { meshKey: 's:body', name: 'roof', triangles: [5], id: 'c' });
    d.ignoredMeshes.push('s:body/a/b');
    expect(removeSplit(d, 'a')).toEqual(['a', 'b']);
    expect(d.splits.map((s) => s.id)).toEqual(['c']);
    expect(d.ignoredMeshes).toEqual([]);
    expect(Object.keys(d.assignments).sort()).toEqual(['s:body', 's:body/c']);
  });

  it('makes unique names', () => {
    expect(uniqueMeshName('body_piece', ['body_piece', 'body_piece_2'])).toBe('body_piece_3');
    expect(uniqueMeshName('x', [])).toBe('x');
  });
});
