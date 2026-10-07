import { describe, expect, it } from 'vitest';
import { HELD, mountsHolding, weakestWay } from '../../src/shared/proxy/hold';

type P = { id: string; pos: [number, number, number] };
const at: [number, number, number] = [0, -1.98, 0.79];
const byDistance = (nodes: P[]) => [...nodes].sort((a, b) => Math.hypot(a.pos[0] - at[0], a.pos[1] - at[1], a.pos[2] - at[2]) - Math.hypot(b.pos[0] - at[0], b.pos[1] - at[1], b.pos[2] - at[2]));

describe('what a mounting point is tied to', () => {
  // A bonnet catch on the practice car: the body's nearest nodes are half a metre off, all in one upright plane with it.
  const wall: P[] = [
    { id: 'b1l', pos: [0.49, -1.955, 0.616] },
    { id: 'b1r', pos: [-0.49, -1.955, 0.616] },
    { id: 'b5', pos: [0, -1.832, 0.178] },
    { id: 'b2l', pos: [0.643, -1.952, 0.568] },
  ];
  const behind: P[] = [
    { id: 'b10l', pos: [0.552, -1.394, 0.626] },
    { id: 'b10r', pos: [-0.552, -1.394, 0.626] },
  ];

  it('sees that mounts in one plane with the point do not hold it across the plane', () => {
    const { way, hold } = weakestWay(at, wall);
    expect(hold).toBeLessThan(HELD);
    expect(Math.abs(way[1])).toBeGreaterThan(0.9); // front to back
  });

  it('adds a mount that stands out of the plane, however near the others are', () => {
    const picked = mountsHolding(at, byDistance([...wall, ...behind]), 4);
    expect(picked.map((p) => p.id)).toEqual(expect.arrayContaining(['b1l', 'b1r', 'b5', 'b2l']));
    expect(picked.some((p) => p.id.startsWith('b10'))).toBe(true);
    expect(weakestWay(at, picked).hold).toBeGreaterThan(weakestWay(at, wall).hold * 4);
  });

  it('leaves well-held points with the nearest few, and gives a twisted one the extra it asks for', () => {
    const round: P[] = [
      { id: 'a', pos: [0.2, -1.98, 0.79] },
      { id: 'b', pos: [0, -1.78, 0.79] },
      { id: 'c', pos: [0, -1.98, 0.99] },
      { id: 'd', pos: [-0.3, -2.2, 0.6] },
    ];
    expect(mountsHolding(at, round, 3).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(mountsHolding(at, round, 3, 4).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    // Nothing out of the plane to be had: it keeps what there is.
    expect(mountsHolding(at, byDistance(wall), 3)).toHaveLength(3);
  });
});
