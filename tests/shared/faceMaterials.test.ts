import { describe, expect, it } from 'vitest';
import { brushFaces, connectedFaces, decodeRuns, encodeRuns, faceAssignment, faceData, groupFaces, smoothFaces, toEntries } from '../../src/shared/paints/faceMaterials';
import { makeWeave } from '../../src/shared/paints/weave';

/** A 1 m square in the XY plane as an n × n grid of quads (two triangles each), plus a second square folded up 90° along x = 1. */
function panel(n: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const grid = (at: (i: number, j: number) => [number, number, number]) => {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) pos.push(...at(i / n, j / n));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
  };
  grid((u, v) => [u, v, 0]);
  grid((u, v) => [1, v, u]); // shares the x = 1 edge, bent up 90°
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

describe('face runs', () => {
  it('encode and decode', () => {
    expect(encodeRuns([5, 1, 2, 3, 9, 10, 2])).toEqual([1, 3, 5, 1, 9, 2]);
    expect([...decodeRuns([1, 3, 9, 2])]).toEqual([1, 2, 3, 9, 10]);
    const { ids, face } = faceAssignment(
      [
        { materialId: 'carbon', runs: [0, 2] },
        { materialId: 'chrome', runs: [3, 1] },
      ],
      6,
    );
    expect(ids).toEqual(['carbon', 'chrome']);
    expect([...face]).toEqual([0, 0, -1, 1, -1, -1]);
    face[5] = 0;
    expect(toEntries(ids, face)).toEqual([
      { materialId: 'carbon', runs: [0, 2, 5, 1] },
      { materialId: 'chrome', runs: [3, 1] },
    ]);
  });
});

describe('painting faces', () => {
  const m = panel(10);
  const d = faceData(m.positions, m.index);

  it('the brush takes connected triangles near the point', () => {
    const seed = 0; // corner of the flat square
    const faces = brushFaces(d, seed, [0.05, 0.05, 0], 0.25);
    expect(faces.length).toBeGreaterThan(8);
    expect(faces.length).toBeLessThan(60);
    for (const f of faces) expect(Math.hypot(d.centroids[f * 3]! - 0.05, d.centroids[f * 3 + 1]! - 0.05)).toBeLessThanOrEqual(0.25);
  });

  it('a smooth fill stops at the fold; the whole piece does not', () => {
    const flat = smoothFaces(d, 0, 20);
    expect(flat).toHaveLength(200); // one 10 × 10 square
    expect(connectedFaces(d, 0)).toHaveLength(400);
  });

  it('groups faces by material for rendering and export', () => {
    const face = new Int32Array(6).fill(-1);
    face[1] = 0;
    face[4] = 1;
    const { order, groups } = groupFaces(6, (t) => (t < 3 ? 0 : 1), face, 2);
    expect([...order]).toEqual([0, 2, 3, 5, 1, 4]);
    expect(groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 1 },
      { start: 12, count: 3, materialIndex: 2 },
      { start: 15, count: 3, materialIndex: 3 },
    ]);
  });
});

describe('fibre weave', () => {
  it('tiles seamlessly and makes a sensible normal map', () => {
    const w = makeWeave(64);
    expect(w.size).toBe(64);
    const px = (a: Uint8ClampedArray, x: number, y: number) => [...a.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    // the pattern repeats every 64 px: the column past the edge would be column 0 again, so the edges match the pattern period
    expect(px(w.normal, 0, 5)[2]).toBeGreaterThan(200); // mostly facing out
    for (let i = 0; i < w.normal.length; i += 4) expect(w.normal[i + 2]).toBeGreaterThan(127);
    // tows run both ways: some pixels tilt in x, some in y
    let tiltX = 0;
    let tiltY = 0;
    for (let i = 0; i < w.normal.length; i += 4) {
      if (Math.abs(w.normal[i]! - 128) > 10) tiltX++;
      if (Math.abs(w.normal[i + 1]! - 128) > 10) tiltY++;
    }
    expect(tiltX).toBeGreaterThan(100);
    expect(tiltY).toBeGreaterThan(100);
  });
});
