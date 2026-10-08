import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { sweepSummary, sweepSuspension } from '../../src/shared/suspension/sweep';

const N = ['id', 'posX', 'posY', 'posZ'];
const B = ['id1:', 'id2:'];
/** The points on the car a left double-wishbone corner bolts to; the upper arm's are `upperX` from the middle. */
const car = (upperX: number, tieZ = 0.3) => ({
  la: [0.3, -0.2, 0.2],
  lb: [0.3, 0.2, 0.2],
  ua: [upperX, -0.2, 0.5],
  ub: [upperX, 0.2, 0.5],
  tie: [0.3, 0.15, tieZ],
  top: [0.5, 0, 0.9],
}) as Record<string, [number, number, number]>;

/** The corner itself: an upright (two ball joints, a steering arm, the axle's two nodes) on two arms, a tie rod and a spring. */
const corner: Record<string, JbeamObject> = {
  susp: {
    nodes: [N, { nodeWeight: 6 }, ['lball', 0.7, 0, 0.2], ['uball', 0.7, 0, 0.5], ['arm', 0.7, 0.15, 0.3], ['w1', 0.72, 0, 0.35], ['w2', 0.9, 0, 0.35]],
    beams: [
      B,
      { beamSpring: 4000000, beamDamp: 400 },
      // the upright, braced solid
      ['lball', 'uball'], ['lball', 'arm'], ['uball', 'arm'], ['lball', 'w1'], ['uball', 'w1'], ['arm', 'w1'], ['lball', 'w2'], ['uball', 'w2'], ['arm', 'w2'], ['w1', 'w2'],
      // lower and upper arms, and the tie rod
      ['la', 'lball'], ['lb', 'lball'], ['ua', 'uball'], ['ub', 'uball'], ['tie', 'arm'],
      // the spring and damper
      { beamSpring: 40000, beamDamp: 3500 },
      ['top', 'lball'],
    ],
    pressureWheels: [['name', 'hubGroup', 'group', 'node1:', 'node2:'], ['FL', 'wheel_FL', 'tire_FL', 'w1', 'w2']],
  },
};

describe('a suspension worked through its travel', () => {
  it('rises under load on its own spring, and hangs when pulled down', () => {
    const r = sweepSuspension(corner, car(0.3));
    expect(r.problem).toBeNull();
    const points = r.wheels[0]!.points;
    expect(r.wheels[0]!.wheel).toBe('FL');
    expect(points.find((p) => p.load === 0)!.travel).toBe(0);
    expect(points.find((p) => p.load === 3000)!.travel).toBeGreaterThan(40);
    expect(points.find((p) => p.load === -1000)!.travel).toBeLessThan(-10);
    // More load, more travel, all the way.
    for (let i = 1; i < points.length; i++) expect(points[i]!.travel).toBeGreaterThan(points[i - 1]!.travel);
  });

  it('keeps its camber on equal parallel arms, and gains negative camber in bump on a short upper arm', () => {
    const equal = sweepSuspension(corner, car(0.3)).wheels[0]!.points;
    const short = sweepSuspension(corner, car(0.48)).wheels[0]!.points;
    const at = (points: typeof equal, load: number) => points.find((p) => p.load === load)!;
    // (A little from the arms' own give under the load.)
    expect(Math.abs(at(equal, 4000).camber - at(equal, 0).camber)).toBeLessThan(0.6);
    expect(at(short, 4000).camber).toBeLessThan(at(short, 0).camber - 1);
  });

  it('shows bump steer when the tie rod doesn’t follow the arms', () => {
    const level = sweepSummary(sweepSuspension(corner, car(0.3)))!;
    const high = sweepSummary(sweepSuspension(corner, car(0.3, 0.36)))!;
    expect(level.toeChange).toBeLessThan(0.3);
    expect(high.toeChange).toBeGreaterThan(level.toeChange + 0.5);
    expect(level.travel).toBeGreaterThan(100);
  });

  it('says so when it finds no wheel to work', () => {
    const r = sweepSuspension({ susp: { ...corner.susp!, pressureWheels: [['name', 'hubGroup', 'group', 'node1:', 'node2:'], ['FL', 'wheel_FL', 'tire_FL', 'nowhere1', 'nowhere2']] } }, car(0.3));
    expect(r.wheels).toEqual([]);
    expect(r.problem).toContain('No wheel');
  });
});
