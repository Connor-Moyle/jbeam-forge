import { describe, expect, it } from 'vitest';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { applyMeshModels, topologyOf } from '@renderer/modelling/build';
import { emptyModel, extrude, flipFaces, movePoints, removeFaces, shapeOf, type V3 } from '@shared/mesh/meshModel';
import type { ImportedMesh } from '@renderer/import/normalize';

const mesh = (): ImportedMesh => {
  const geometry = new BoxGeometry(1, 1, 1); // indexed, 12 triangles, 6 material groups
  return { key: 's:box', sourceId: 's', name: 'box', geometry, material: new MeshBasicMaterial(), triangles: 12 };
};

describe('reshaped meshes', () => {
  it('welds the box into 8 points and leaves unreshaped meshes alone (remembering where they came from)', () => {
    const m = mesh();
    const topo = topologyOf(m.geometry);
    expect(topo.pointCount).toBe(8);
    const [out] = applyMeshModels([m], {});
    expect(out!.geometry).toBe(m.geometry);
    expect(out!.geometry.userData.modelBase).toBe(m.geometry);
  });

  it('builds the reshaped geometry: moved points, deleted and turned triangles, extruded walls with their neighbour’s material', () => {
    const m = mesh();
    const topo = topologyOf(m.geometry);
    let model = movePoints(emptyModel(topo), new Map([[0, [2, 2, 2] as V3]]));
    model = removeFaces(model, [11]);
    model = flipFaces(model, [4]);
    const r = extrude(model, shapeOf(topo, model), { faces: [0, 1] }, 0.25)!;
    const problems: string[] = [];
    const [out] = applyMeshModels([m], { 's:box': r.model }, problems);
    expect(problems).toEqual([]);
    const g = out!.geometry;
    expect(g.index).toBeNull();
    const tris = g.getAttribute('position').count / 3;
    expect(tris).toBe(12 + 8);
    expect(out!.triangles).toBe(tris);
    // Deleted triangle 11 is still there, empty.
    const p = g.getAttribute('position');
    expect([p.getX(33), p.getY(33), p.getZ(33)]).toEqual([p.getX(34), p.getY(34), p.getZ(34)]);
    // Every corner has a unit normal and a texture coordinate.
    const n = g.getAttribute('normal');
    for (let c = 0; c < n.count; c++) expect(Math.hypot(n.getX(c), n.getY(c), n.getZ(c))).toBeCloseTo(1, 3);
    expect(g.getAttribute('uv').count).toBe(tris * 3);
    // The walls take the material of the faces they grew from (the box's first side).
    const last = g.groups[g.groups.length - 1]!;
    expect(last.start + last.count).toBe(tris * 3);
    expect(last.materialIndex).toBe(0);
    expect(g.userData.modelBase).toBe(m.geometry);
  });

  it('leaves edits off, and says so, when the file’s mesh changed under them', () => {
    const m = mesh();
    const model = { ...emptyModel(topologyOf(m.geometry)), base: { tris: 99, points: 8 } };
    const problems: string[] = [];
    const [out] = applyMeshModels([m], { 's:box': model }, problems);
    expect(problems).toEqual(['box']);
    expect(out!.geometry).toBe(m.geometry);
  });
});
