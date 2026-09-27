import { describe, expect, it } from 'vitest';
import { massBalance } from '../../src/shared/structure/balance';

const node = (x: number, y: number, z: number, weight: number) => ({ pos: [x, y, z] as [number, number, number], weight });

describe('mass balance', () => {
  it('weights the centre of gravity by node mass', () => {
    const b = massBalance([node(0, -1, 0, 3), node(0, 1, 1, 1)])!;
    expect(b.massKg).toBe(4);
    expect(b.cog).toEqual([0, -0.5, 0.25]);
  });

  it('splits front/rear about the middle of the length (front is −Y) and left/right about X = 0', () => {
    const b = massBalance([node(0.5, -2, 0, 6), node(-0.5, 2, 0, 4)])!;
    expect(b.front).toBeCloseTo(0.6);
    expect(b.left).toBeCloseTo(0.6);
  });

  it('centre-line nodes count half to each side', () => {
    expect(massBalance([node(0, 0, 0, 2), node(0.3, -1, 0, 2), node(-0.3, 1, 0, 2)])!.left).toBeCloseTo(0.5);
  });

  it('nothing to weigh gives null', () => {
    expect(massBalance([])).toBeNull();
  });
});
