import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '@shared/jbeam/parse';
import { setWheels } from '@shared/suspension/wheels';

describe('where a fitted suspension holds its wheels', () => {
  const hub: JbeamObject = {
    slotType: 'car_hub_F',
    nodes: [['id', 'posX', 'posY', 'posZ'], ['fw1l', 0.72, -1.3, 0.3], ['fw1ll', 0.62, -1.3, 0.3], ['fw1r', -0.72, -1.3, 0.3], ['fw1rr', -0.62, -1.3, 0.3]],
    pressureWheels: [
      ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
      { hubRadius: 0.2 },
      ['FR', 'wheel_FR', 'tire_FR', 'fw1rr', 'fw1r', 9999, 'fh1r', -1],
      ['FL', 'wheel_FL', 'tire_FL', 'fw1ll', 'fw1l', 9999, 'fh1l', 1],
    ],
  };

  it('reads each side from the hub’s wheel rows, moved with the set', () => {
    const wheels = setWheels({ car_hub_F: hub }, [0, 0.1, 0.02]);
    const left = wheels.find((w) => w.side === 'L')!;
    const right = wheels.find((w) => w.side === 'R')!;
    expect(left.centre[0]).toBeCloseTo(0.67);
    expect(left.centre[1]).toBeCloseTo(-1.2);
    expect(left.centre[2]).toBeCloseTo(0.32);
    expect(right.centre[0]).toBeCloseTo(-0.67);
    expect(left.axis[0]).toBeCloseTo(1);
    expect(right.axis[0]).toBeCloseTo(-1);
  });

  it('falls back to the hub nodes by name when there are no wheel rows', () => {
    const noRows: JbeamObject = { slotType: 'x', nodes: [['id', 'posX', 'posY', 'posZ'], ['rw1l', 0.7, 1.2, 0.31], ['rw1r', -0.7, 1.2, 0.31], ['rx1l', 0.4, 1.2, 0.5]] };
    const wheels = setWheels({ x: noRows });
    expect(wheels.map((w) => w.side).sort()).toEqual(['L', 'R']);
    expect(wheels.find((w) => w.side === 'L')!.centre).toEqual([0.7, 1.2, 0.31]);
  });

  it('finds nothing in a set without hubs', () => {
    expect(setWheels({ a: { slotType: 'a', nodes: [['id', 'posX', 'posY', 'posZ'], ['fx1', 0, 0, 0]] } })).toEqual([]);
  });
});
