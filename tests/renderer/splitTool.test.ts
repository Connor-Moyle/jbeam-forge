import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial } from 'three';
import { applySplits } from '../../src/renderer/import/applySplits';
import { sequentialRenumber } from '../../src/renderer/split/splitTool';
import type { Split } from '../../src/shared/project/schema';
import { connectedComponents } from '../../src/shared/mesh/split';
import { toRuns } from '../../src/shared/mesh/split';

describe('sequentialRenumber', () => {
  it('maps later pieces into the remainder left by earlier ones', () => {
    const r = sequentialRenumber(10);
    expect(r([2, 3])).toEqual([2, 3]);
    expect(r([5, 9])).toEqual([3, 7]); // two removed before each
    expect(r([0, 1])).toEqual([0, 1]);
  });
});

describe('connected split end to end', () => {
  it('three separate triangles become three meshes when splits are applied in order', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0, 9, 0, 0, 10, 0, 0, 9, 1, 0], 3));
    const pieces = connectedComponents(g.getAttribute('position').array, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const renumber = sequentialRenumber(3);
    const splits: Split[] = pieces.slice(1).map((tris, i) => ({ id: `s${i}`, meshKey: 'x:m', name: `p${i}`, triangleRuns: toRuns(renumber(tris)) }));
    const { meshes, problems } = applySplits([{ key: 'x:m', sourceId: 'x', name: 'm', geometry: g, material: new MeshBasicMaterial(), triangles: 3 }], splits);
    expect(problems).toEqual([]);
    expect(meshes.map((m) => m.triangles)).toEqual([1, 1, 1]);
  });
});
