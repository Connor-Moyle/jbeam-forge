import { describe, expect, it } from 'vitest';
import type { ProxyMesh } from '../../src/shared/proxy/mesh';
import { carveWheels, insideWheel, inWheelSpace, wheelSpaceOf } from '../../src/shared/proxy/wheelSpace';

const mesh = (points: number[][], faces: number[][]): ProxyMesh => ({ positions: Float32Array.from(points.flat()), index: Uint32Array.from(faces.flat()) });
const wheel = { centre: [0.75, -1.3, 0.31] as const, radius: 0.31, halfWidth: 0.1 };
const anyInside = (m: ProxyMesh) => Array.from({ length: m.positions.length / 3 }, (_, v) => insideWheel(m.positions, v * 3, wheel)).some(Boolean);

describe('the room a wheel takes', () => {
  it('is read from a tyre’s mesh, and not from something that isn’t a wheel', () => {
    const tyre = mesh([[0.65, -1.61, 0], [0.85, -1.61, 0], [0.65, -0.99, 0], [0.85, -0.99, 0.62], [0.75, -1.3, 0.62], [0.75, -1.3, 0]], [[0, 1, 2]]);
    const space = wheelSpaceOf(tyre)!;
    expect(space.radius).toBeCloseTo(0.31, 2);
    expect(space.halfWidth).toBeCloseTo(0.1, 2);
    expect(space.centre.map((v) => Math.round(v * 100) / 100)).toEqual([0.75, -1.3, 0.31]);
    expect(wheelSpaceOf(mesh([[0, 0, 0], [0.05, 0, 0], [0, 0.05, 0.05]], [[0, 1, 2]]))).toBeNull();
    const ring = mesh(
      Array.from({ length: 12 }, (_, i) => [0.75 + (i % 2 ? 0.09 : -0.09), -1.3 + 0.31 * Math.cos((i * Math.PI) / 6), 0.31 + 0.31 * Math.sin((i * Math.PI) / 6)]),
      [[0, 1, 2]],
    );
    expect(inWheelSpace(ring, [wheel])).toBe(true);
  });

  // A wing wrapped in a hull: an arch top, a front and a rear corner, and what bridged the arch.
  const wing = mesh(
    [
      [0.8, -2.1, 0.8], // 0 front top
      [0.8, -2.1, 0.2], // 1 front bottom
      [0.8, -0.5, 0.8], // 2 rear top
      [0.8, -0.5, 0.2], // 3 rear bottom
      [0.8, -1.3, 0.82], // 4 arch top
      [0.78, -1.5, 0.5], // 5 in the wheel, ahead of and above the axle
    ],
    [
      [0, 1, 4],
      [4, 2, 3],
      [1, 5, 4],
      [5, 3, 4],
      [1, 3, 5],
      [0, 4, 2],
    ],
  );

  it('is cleared of a part: a node in the wheel moves straight out from the axle, and faces still crossing the wheel go', () => {
    const carved = carveWheels(wing, [wheel]);
    expect(anyInside(carved)).toBe(false);
    // All six nodes are still there: the one from the wheel now sits on the arch line, ahead of and above the axle.
    expect(carved.positions.length / 3).toBe(6);
    const at = Array.from({ length: 6 }, (_, v) => [carved.positions[v * 3 + 1]!, carved.positions[v * 3 + 2]!]).find(([y, z]) => Math.abs(Math.hypot(y! + 1.3, z! - 0.31) - 0.415) < 0.002)!;
    expect(at[0]).toBeLessThan(-1.3);
    expect(at[1]).toBeGreaterThan(0.31);
    // The face along the sill, through the wheel, went; the two on the moved node are beams now, not faces.
    expect(carved.index.length / 3).toBe(3);
    expect(carved.extraEdges?.length).toBeGreaterThanOrEqual(2);
  });

  it('also drops a face that spans the wheel with every corner outside it', () => {
    const bridge = mesh([[0.8, -2.1, 0.2], [0.8, -0.5, 0.2], [0.8, -1.3, 0.82], [0.8, -2.1, 0.8], [0.8, -0.5, 0.8]], [[0, 1, 2], [0, 2, 3], [2, 1, 4], [3, 2, 4]]);
    expect(carveWheels(bridge, [wheel]).index.length / 3).toBe(3);
  });

  it('does not take a wing for a wheel because its middle is in the arch', () => {
    expect(inWheelSpace(wing, [wheel])).toBe(false);
  });

  it('leaves a part alone when nothing of it is in a wheel', () => {
    const away = mesh([[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], [[0, 1, 2], [1, 3, 2]]);
    expect(carveWheels(away, [wheel])).toBe(away);
    expect(carveWheels(wing, [])).toBe(wing);
  });

  it('leaves a part that is all arch (a liner) as it was drawn', () => {
    const liner = mesh([[0.75, -1.5, 0.4], [0.76, -1.1, 0.4], [0.74, -1.3, 0.6], [0.75, -1.3, 0.75], [0.75, -1.75, 0.31]], [[0, 1, 2], [0, 2, 3], [2, 1, 3], [0, 3, 4]]);
    expect(carveWheels(liner, [wheel])).toBe(liner);
  });
});
