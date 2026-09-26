import { describe, expect, it } from 'vitest';
import { BoxGeometry, type BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { applySplits, geometryTriangleCount, subsetGeometry } from '../../src/renderer/import/applySplits';
import type { ImportedMesh } from '../../src/renderer/import/normalize';
import type { Split } from '../../src/shared/project/schema';

const box = (): ImportedMesh => {
  const g = new BoxGeometry(1, 1, 1); // 12 triangles, 6 material groups
  return { key: 's:box', sourceId: 's', name: 'box', geometry: g, material: [new MeshBasicMaterial()], triangles: 12 };
};

describe('subsetGeometry', () => {
  it('shares vertex attributes and keeps material groups', () => {
    const g = new BoxGeometry(1, 1, 1);
    const sub = subsetGeometry(g, [0, 1, 4, 5]);
    expect(sub.getAttribute('position')).toBe(g.getAttribute('position'));
    expect(sub.getAttribute('uv')).toBe(g.getAttribute('uv'));
    expect(geometryTriangleCount(sub)).toBe(4);
    // Bounds cover only the subset's vertices (+X and −Y faces), not the shared buffer.
    expect(sub.boundingBox!.min.x).toBe(-0.5);
    expect(g.boundingBox === null || sub.boundingBox !== g.boundingBox).toBe(true);
    const top = subsetGeometry(g, [4, 5]); // +Y face only
    expect(top.boundingBox!.min.y).toBe(0.5);
    expect(sub.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 2 },
    ]);
  });

  it('handles non-indexed geometry', () => {
    const g = new BoxGeometry(1, 1, 1).toNonIndexed();
    expect(geometryTriangleCount(subsetGeometry(g, [11]))).toBe(1);
  });
});

describe('applySplits', () => {
  it('applies splits in order, including splits of split results', () => {
    const splits: Split[] = [
      { id: 'a', meshKey: 's:box', name: 'top', triangleRuns: [[4, 4]] },
      { id: 'b', meshKey: 's:box/a', name: 'top_half', triangleRuns: [[0, 2]] },
    ];
    const { meshes, problems } = applySplits([box()], splits);
    expect(problems).toEqual([]);
    expect(meshes.map((m) => [m.key, m.name, m.triangles])).toEqual([
      ['s:box', 'box', 8],
      ['s:box/a', 'top', 2],
      ['s:box/a/b', 'top_half', 2],
    ]);
  });

  it('reports splits that no longer fit instead of throwing', () => {
    const { meshes, problems } = applySplits([box()], [
      { id: 'x', meshKey: 's:gone', name: 'ghost', triangleRuns: [[0, 1]] },
      { id: 'y', meshKey: 's:box', name: 'too far', triangleRuns: [[10, 5]] },
    ]);
    expect(meshes).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });

  it('drops a mesh whose every triangle was split off', () => {
    const { meshes } = applySplits([box()], [{ id: 'a', meshKey: 's:box', name: 'all', triangleRuns: [[0, 12]] }]);
    expect(meshes.map((m) => m.key)).toEqual(['s:box/a']);
  });
});

describe('BVH picking keeps triangle numbering (indirect)', () => {
  it('reports the original face index after building an indirect BVH', () => {
    const g = new BoxGeometry(1, 1, 1);
    const before = Array.from(g.index!.array);
    (g as BufferGeometry & { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
    (g as unknown as { computeBoundsTree: (o: object) => void }).computeBoundsTree({ indirect: true });
    expect(Array.from(g.index!.array)).toEqual(before); // index untouched: stored split triangles stay valid
    const mesh = new Mesh(g, new MeshBasicMaterial());
    mesh.raycast = acceleratedRaycast;
    const hit = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectObject(mesh)[0]!;
    // +Z face is BoxGeometry group 4 → triangles 8 and 9.
    expect([8, 9]).toContain(hit.faceIndex);
  });
});
