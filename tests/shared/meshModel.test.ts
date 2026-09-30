import { describe, expect, it } from 'vitest';
import { edgesOf, emptyModel, extrude, faceNormal, facesTouching, fill, flipFaces, linkedFaces, livePoints, modelFits, movePoints, pointAt, removeFaces, shapeOf, weld, type V3 } from '@shared/mesh/meshModel';

/** A unit cube as a triangle soup, wound outwards. */
function cube(): Float32Array {
  const v: V3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const quads = [
    [0, 3, 2, 1], // -z
    [4, 5, 6, 7], // +z
    [0, 1, 5, 4], // -y
    [2, 3, 7, 6], // +y
    [1, 2, 6, 5], // +x
    [0, 4, 7, 3], // -x
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) for (const i of [a, b, c, a, c, d]) out.push(...v[i!]!);
  return Float32Array.from(out);
}

describe('modelling core', () => {
  const topo = weld(cube());

  it('welds corners into points, numbered in the order they appear', () => {
    expect(topo.triCount).toBe(12);
    expect(topo.pointCount).toBe(8);
    expect(Array.from(topo.pointOf.subarray(0, 3))).toEqual([0, 1, 2]);
    expect(edgesOf(shapeOf(topo, undefined)).length / 2).toBe(18);
  });

  it('moves points, and edits that no longer fit the file are left off', () => {
    const m = movePoints(emptyModel(topo), new Map([[0, [-1, -1, -1] as V3]]));
    expect(pointAt(shapeOf(topo, m), 0)).toEqual([-1, -1, -1]);
    const other = weld(cube().subarray(0, 18));
    expect(modelFits(other, m)).toBe(false);
    expect(pointAt(shapeOf(other, m), 0)).toEqual([0, 0, 0]);
  });

  it('deletes triangles without renumbering the rest, and turns them round', () => {
    let m = removeFaces(emptyModel(topo), [0, 1]);
    let s = shapeOf(topo, m);
    expect(s.triCount).toBe(12);
    expect(s.removed[0]).toBe(1);
    expect(facesTouching(s, new Set([0]))).not.toContain(0);
    m = flipFaces(m, [2]);
    s = shapeOf(topo, m);
    const before = faceNormal(shapeOf(topo, undefined), 2);
    const after = faceNormal(s, 2);
    expect(after[2]).toBeCloseTo(-before[2]);
    // Twice = back.
    expect(shapeOf(topo, flipFaces(m, [2])).flipped[2]).toBe(0);
  });

  it('fills a hole with a face turned outwards', () => {
    // Open the bottom, then fill it from its four corners.
    const open = removeFaces(emptyModel(topo), [0, 1]);
    const s = shapeOf(topo, open);
    const r = fill(open, s, [0, 1, 2, 3])!;
    expect(r.faces).toEqual([12, 13]);
    const filled = shapeOf(topo, r.model);
    for (const t of r.faces) expect(faceNormal(filled, t)[2]).toBeCloseTo(-1);
    expect(fill(open, s, [0, 1])).toBeNull();
  });

  it('extrudes faces: new points lifted along the normal, walls round the edge', () => {
    const top = [2, 3]; // the +z quad
    const r = extrude(emptyModel(topo), shapeOf(topo, undefined), { faces: top }, 0.5)!;
    expect(r.points.length).toBe(4);
    const s = shapeOf(topo, r.model);
    expect(s.triCount).toBe(12 + 8);
    for (const p of r.points) expect(pointAt(s, p)[2]).toBeCloseTo(1.5);
    // The lifted faces now sit on the new points and still face up.
    for (const t of top) {
      for (let k = 0; k < 3; k++) expect(r.points).toContain(s.corners[t * 3 + k]);
      expect(faceNormal(s, t)[2]).toBeCloseTo(1);
    }
    // Walls face outwards (away from the middle of the top).
    for (let t = 12; t < 20; t++) {
      const n = faceNormal(s, t);
      const a = pointAt(s, s.corners[t * 3]!);
      const b = pointAt(s, s.corners[t * 3 + 1]!);
      const c = pointAt(s, s.corners[t * 3 + 2]!);
      const mid = [(a[0] + b[0] + c[0]) / 3 - 0.5, (a[1] + b[1] + c[1]) / 3 - 0.5];
      expect(n[0] * mid[0]! + n[1] * mid[1]!).toBeGreaterThan(0);
    }
    expect(linkedFaces(s, [0]).length).toBe(20);
    expect(livePoints(s).reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('extrudes an edge into a new face', () => {
    const open = removeFaces(emptyModel(topo), [0, 1]);
    const r = extrude(open, shapeOf(topo, open), { edges: [[0, 1]] })!;
    expect(r.points.length).toBe(2);
    expect(r.faces).toEqual([12, 13]);
    expect(shapeOf(topo, r.model).triCount).toBe(14);
  });
});
