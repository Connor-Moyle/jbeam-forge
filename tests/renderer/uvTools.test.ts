import { describe, expect, it } from 'vitest';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { applyMeshEdits } from '../../src/renderer/import/meshEdits';
import type { ImportedMesh } from '../../src/renderer/import/normalize';
import { uvTriangles, uvView } from '../../src/renderer/scene/UvLayout';
import { IDENTITY_EDIT, isIdentityUv, projectUvs } from '../../src/shared/mesh/meshEdit';

const box = (): ImportedMesh => ({ key: 's:box', sourceId: 's', name: 'box', geometry: new BoxGeometry(2, 1, 0.5), material: [new MeshBasicMaterial()], triangles: 12 });

describe('projectUvs', () => {
  it('lays a triangle flat along its facing axis, one repeat per size metres', () => {
    // A triangle in the X = 0 plane, facing +X.
    const pos = [0, 0, 0, 0, 1, 0, 0, 0, 1];
    const uv = projectUvs(pos, { kind: 'box', size: 0.5 });
    expect(Array.from(uv)).toEqual([0, 0, 2, 0, 0, 2]);
    // Facing −X: u flips so the texture doesn't read backwards.
    const back = projectUvs([0, 0, 0, 0, 0, 1, 0, 1, 0], { kind: 'box', size: 1 });
    expect(back[4]).toBe(-1);
  });

  it('projects every triangle along a fixed axis', () => {
    const uv = projectUvs([0, 0, 0, 1, 0, 0, 0, 0, 1], { kind: 'z', size: 1 }); // a wall, seen from above
    expect(Array.from(uv)).toEqual([0, 0, 1, 0, 0, 0]);
  });
});

describe('projected texture coordinates on a mesh', () => {
  it('counts as a mapping change', () => {
    expect(isIdentityUv({ ...IDENTITY_EDIT, uv: { ...IDENTITY_EDIT.uv, project: { kind: 'box', size: 1 } } })).toBe(false);
  });

  it('bakes fresh UVs in metres, keeping triangle order and material groups', () => {
    const src = box();
    const [out] = applyMeshEdits([src], { 's:box': { ...IDENTITY_EDIT, uv: { ...IDENTITY_EDIT.uv, project: { kind: 'box', size: 0.25 } } } }, []);
    const g = out!.geometry;
    expect(g.index).toBeNull();
    expect(g.getAttribute('position').count).toBe(36);
    expect(g.groups.map((x) => x.materialIndex)).toEqual(src.geometry.groups.map((x) => x.materialIndex));
    const tris = uvTriangles(g);
    const [, , span] = uvView(tris);
    // The box is 2 m long: 8 repeats of 25 cm across its long side.
    expect(span).toBeCloseTo(8, 5);
  });
});

describe('uvTriangles', () => {
  it('reads indexed geometry into corner triples', () => {
    const tris = uvTriangles(new BoxGeometry(1, 1, 1));
    expect(tris.length).toBe(12 * 6);
    expect(uvView(tris)).toEqual([0, 0, 1]);
  });
});
