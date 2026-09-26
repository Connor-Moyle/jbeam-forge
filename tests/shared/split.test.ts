import { describe, expect, it } from 'vitest';
import {
  complement,
  connectedComponents,
  faceNormals,
  floodFill,
  fromRuns,
  planeSide,
  pointInPolygon,
  rectPolygon,
  toRuns,
  trianglesInPolygon,
  weldMap,
} from '../../src/shared/mesh/split';

/** Quad (2 tris) in the XY plane at offset, with its own (unwelded) vertices. */
function quad(ox: number, oy: number, oz = 0): { p: number[]; i: number[] } {
  return { p: [ox, oy, oz, ox + 1, oy, oz, ox + 1, oy + 1, oz, ox, oy + 1, oz], i: [0, 1, 2, 0, 2, 3] };
}

function merge(...parts: { p: number[]; i: number[] }[]): { positions: Float32Array; index: Uint32Array } {
  const p: number[] = [];
  const i: number[] = [];
  for (const part of parts) {
    const base = p.length / 3;
    p.push(...part.p);
    i.push(...part.i.map((x) => x + base));
  }
  return { positions: new Float32Array(p), index: new Uint32Array(i) };
}

/** An open box's floor + a wall meeting at 90°: two quads sharing an edge (via duplicated seam vertices). */
function bentSheet() {
  const floor = { p: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], i: [0, 1, 2, 0, 2, 3] };
  const wall = { p: [0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1], i: [0, 1, 2, 0, 2, 3] };
  return merge(floor, wall);
}

describe('weldMap', () => {
  it('merges coincident vertices within tolerance only', () => {
    const w = weldMap(new Float32Array([0, 0, 0, 0, 0, 1e-7, 0, 0, 1]), 1e-5);
    expect(w[1]).toBe(w[0]);
    expect(w[2]).not.toBe(w[0]);
  });
});

describe('connectedComponents', () => {
  it('splits separate pieces, largest first, and sees through UV seams', () => {
    const { positions, index } = merge(quad(0, 0), quad(5, 0), quad(1, 0)); // quad 3 touches quad 1 along x=1 (seam)
    const comps = connectedComponents(positions, index);
    expect(comps).toEqual([
      [0, 1, 4, 5],
      [2, 3],
    ]);
  });
});

describe('floodFill', () => {
  it('stops at sharp edges (angle limit) but crosses them without one', () => {
    const { positions, index } = bentSheet();
    expect(floodFill(positions, index, [0], { maxAngleDeg: 30 })).toEqual([0, 1]);
    expect(floodFill(positions, index, [0], { maxAngleDeg: 95 })).toEqual([0, 1, 2, 3]);
    expect(floodFill(positions, index, [0])).toEqual([0, 1, 2, 3]);
  });

  it('limits growth to a radius (paint brush)', () => {
    const { positions, index } = merge(quad(0, 0), quad(1, 0), quad(2, 0), quad(3, 0));
    const hit = floodFill(positions, index, [0], { radius: 1.2 });
    expect(hit).toContain(2); // next quad
    expect(hit).not.toContain(6); // four metres away
  });

  it('ignores out-of-range seeds', () => {
    const { positions, index } = merge(quad(0, 0));
    expect(floodFill(positions, index, [99])).toEqual([]);
  });
});

describe('plane and polygon selection', () => {
  it('selects by centroid side of a plane', () => {
    const { positions, index } = merge(quad(-2, 0), quad(2, 0));
    expect(planeSide(positions, index, [0, 0, 0], [1, 0, 0])).toEqual([2, 3]);
  });

  it('selects projected centroids inside a rectangle or lasso', () => {
    const projected = new Float32Array([0.5, 0.5, 5, 5, Number.NaN, Number.NaN]);
    expect(trianglesInPolygon(projected, rectPolygon(0, 0, 1, 1))).toEqual([0]);
    const triangleLasso = [0, 0, 10, 0, 0, 10];
    expect(pointInPolygon(1, 1, triangleLasso)).toBe(true);
    expect(pointInPolygon(9, 9, triangleLasso)).toBe(false);
    expect(trianglesInPolygon(projected, triangleLasso)).toEqual([0]);
  });
});

describe('runs', () => {
  it('round-trips triangle lists through [start, count] runs', () => {
    expect(toRuns([5, 1, 2, 3, 9, 3])).toEqual([
      [1, 3],
      [5, 1],
      [9, 1],
    ]);
    expect(fromRuns(toRuns([7, 8, 1]))).toEqual([1, 7, 8]);
    expect(complement(5, [1, 3])).toEqual([0, 2, 4]);
  });

  it('faceNormals gives unit normals', () => {
    const { positions, index } = merge(quad(0, 0));
    expect([...faceNormals(positions, index).slice(0, 3)]).toEqual([0, 0, 1]);
  });
});
