import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { applyDrivetrainToAxle, DEFAULT_FINAL_DRIVE, planDrivetrain, powertrainRows } from '../../src/shared/powertrain/drivetrain';
import { powertrainChain } from '../../src/shared/powertrain/chain';

const H = ['type', 'name', 'inputName', 'inputIndex'];
const W = ['name', 'hubGroup', 'group', 'node1:', 'node2:'];
const ENGINE: Record<string, JbeamObject> = { eng: { powertrain: [H, ['combustionEngine', 'mainEngine', 'dummy', 0]] } };
const BOX: Record<string, JbeamObject> = { box: { powertrain: [H, ['frictionClutch', 'clutch', 'mainEngine', 1], ['manualGearbox', 'gearbox', 'clutch', 1]] } };
/** A suspension with wheels and nothing to turn them: the rear of a front-drive car. */
const dead = (end: 'F' | 'R'): Record<string, JbeamObject> => ({ [`susp_${end}`]: { pressureWheels: [W, [`${end}R`, `wheel_${end}R`, `tire_${end}R`, 'a', 'b'], [`${end}L`, `wheel_${end}L`, `tire_${end}L`, 'c', 'd']] } });
/** One whose wheel shafts wait for a differential that stayed with its own car. */
const waiting = (end: 'F' | 'R'): Record<string, JbeamObject> => ({
  [`susp_${end}`]: {
    pressureWheels: dead(end)[`susp_${end}`]!.pressureWheels!,
    powertrain: [H, ['shaft', `wheelaxle${end}L`, `differential_${end}`, 1, { connectedWheel: `${end}L` }], ['shaft', `wheelaxle${end}R`, `differential_${end}`, 2, { connectedWheel: `${end}R` }]],
  },
});
const axles = (front: Record<string, JbeamObject>, rear: Record<string, JbeamObject>) => [{ index: 0, name: 'Front axle', y: -1.3, parts: front }, { index: 1, name: 'Rear axle', y: 1.3, parts: rear }];
const reached = (plan: ReturnType<typeof planDrivetrain>, ...sets: Record<string, JbeamObject>[]) => powertrainChain([...Object.values(ENGINE), ...Object.values(BOX), ...sets.flatMap((s) => Object.values(s)), { powertrain: plan.rows ?? [H] }] as never).wheels.sort();

describe('an axle that has to drive but has no differential', () => {
  it('is given one, with a half-shaft to each wheel: the rear, when nothing else can drive', () => {
    const front = dead('F');
    const rear = dead('R');
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: axles(front, rear) });
    expect(plan.problems).toEqual([]);
    expect(plan.axles.map((a) => [a.name, a.driven, a.given ?? false])).toEqual([['Front axle', false, false], ['Rear axle', true, true]]);
    expect(plan.rows!.slice(1).map((r) => r.slice(0, 4))).toEqual([
      ['shaft', 'jbf_driveshaft_2', 'gearbox', 1],
      ['differential', 'jbf_differential_2', 'jbf_driveshaft_2', 1],
      ['shaft', 'jbf_halfshaft_RL', 'jbf_differential_2', 1],
      ['shaft', 'jbf_halfshaft_RR', 'jbf_differential_2', 2],
    ]);
    expect((plan.rows![2]![4] as JbeamObject).gearRatio).toBe(DEFAULT_FINAL_DRIVE);
    expect(reached(plan, front, rear)).toEqual(['RL', 'RR']);
  });

  it('gets the differential its own wheel shafts were waiting for, and keeps them', () => {
    const front = dead('F');
    const rear = waiting('R');
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: axles(front, rear) });
    expect(plan.drop.has(1)).toBe(false);
    expect(plan.rows!.slice(1).map((r) => r.slice(0, 3))).toEqual([
      ['shaft', 'jbf_driveshaft_2', 'gearbox'],
      ['differential', 'differential_R', 'jbf_driveshaft_2'],
    ]);
    expect(applyDrivetrainToAxle(rear, plan, 1)).toEqual([]);
    expect(powertrainRows(rear).map((r) => r.name)).toEqual(['wheelaxleRL', 'wheelaxleRR']);
    expect(reached(plan, front, rear)).toEqual(['RL', 'RR']);
  });

  it('is the end the drive is set to, front or both', () => {
    const fwd = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: axles(dead('F'), dead('R')) }, { layout: 'fwd', frontShare: 0.4, centre: 'viscous' });
    expect(fwd.axles.map((a) => a.given ?? false)).toEqual([true, false]);
    expect(fwd.rows!.some((r) => r[1] === 'jbf_halfshaft_FL')).toBe(true);
    const awd = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: axles(dead('F'), dead('R')) }, { layout: 'awd', frontShare: 0.4, centre: 'viscous' });
    expect(awd.axles.every((a) => a.given)).toBe(true);
    expect(awd.rows!.filter((r) => r[0] === 'differential').map((r) => r[1])).toEqual(['jbf_centre_diff', 'jbf_differential_1', 'jbf_differential_2']);
    expect(reached(awd, dead('F'), dead('R'))).toEqual(['FL', 'FR', 'RL', 'RR']);
  });

  it('is left alone when another axle already drives', () => {
    const rear: Record<string, JbeamObject> = {
      diff: { powertrain: [H, ['differential', 'differential_R', 'driveshaft', 1, { diffType: 'open' }]] },
      susp: { powertrain: [H, ['shaft', 'wheelaxleRL', 'differential_R', 1, { connectedWheel: 'RL' }], ['shaft', 'wheelaxleRR', 'differential_R', 2, { connectedWheel: 'RR' }]] },
    };
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: axles(dead('F'), rear) });
    expect(plan.axles.map((a) => a.given ?? false)).toEqual([false, false]);
    expect(plan.rows).toEqual([H, ['shaft', 'jbf_driveshaft_2', 'gearbox', 1]]);
  });

  it('takes the final drive of the differential the gearbox’s own car had', () => {
    const transaxle: Record<string, JbeamObject> = {
      box: { powertrain: [H, ['frictionClutch', 'clutch', 'mainEngine', 1], ['manualGearbox', 'gearbox', 'clutch', 1]] },
      diff: { powertrain: [H, ['differential', 'differential_F', 'gearbox', 1, { diffType: 'open', gearRatio: 4.31 }]] },
    };
    const plan = planDrivetrain({ engine: ENGINE, gearbox: transaxle, axles: axles(dead('F'), dead('R')) });
    expect((plan.rows!.find((r) => r[0] === 'differential')![4] as JbeamObject).gearRatio).toBe(4.31);
  });
});
