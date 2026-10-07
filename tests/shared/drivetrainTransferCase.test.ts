import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { planDrivetrain } from '../../src/shared/powertrain/drivetrain';

const H = ['type', 'name', 'inputName', 'inputIndex'];
const ENGINE: Record<string, JbeamObject> = { eng: { powertrain: [H, ['combustionEngine', 'mainEngine', 'dummy', 0]] } };
/** The Gavril pickup's automatic with its four-wheel-drive transfer case: the rear output always on, the front one switched. */
const BOX: Record<string, JbeamObject> = {
  box: { powertrain: [H, ['torqueConverter', 'torqueConverter', 'mainEngine', 1], ['automaticGearbox', 'gearbox', 'torqueConverter', 1]] },
  transfer: {
    powertrain: [
      H,
      ['rangeBox', 'rangebox', 'gearbox', 1],
      ['differential', 'transfercase', 'rangebox', 1, { diffType: 'locked' }],
      ['shaft', 'transfercase_F', 'transfercase', 2, { canDisconnect: true }],
    ],
  },
};
/** Its front suspension, which reaches the transfer case's front output by name… */
const FRONT: Record<string, JbeamObject> = {
  shaft: { powertrain: [H, ['shaft', 'driveshaft_F', 'transfercase_F', 1]] },
  diff: { powertrain: [H, ['differential', 'differential_F', 'driveshaft_F', 1], ['shaft', 'wheelaxleFL', 'differential_F', 1, { connectedWheel: 'FL' }], ['shaft', 'wheelaxleFR', 'differential_F', 2, { connectedWheel: 'FR' }]] },
};
/** …and its rear axle, whose drive shaft was a part of the frame and stayed behind. */
const REAR: Record<string, JbeamObject> = {
  diff: { powertrain: [H, ['differential', 'differential_R', 'driveshaft', 1], ['shaft', 'wheelaxleRL', 'differential_R', 1, { connectedWheel: 'RL' }], ['shaft', 'wheelaxleRR', 'differential_R', 2, { connectedWheel: 'RR' }]] },
};

describe('a gearbox that brings its own transfer case', () => {
  const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front axle', y: -1.5, parts: FRONT }, { index: 1, name: 'Rear axle', y: 1.5, parts: REAR }] });

  it('puts the axle that isn’t connected on the transfer case’s free output, not behind the switched front one', () => {
    expect(plan.problems).toEqual([]);
    expect(plan.rows!.slice(1)).toEqual([['shaft', 'jbf_driveshaft_2', 'transfercase', 1]]);
    expect(plan.rewire.get(1)!.get('differential_R')).toEqual(['jbf_driveshaft_2', 1]);
  });

  it('leaves the axle already on the transfer case as it was, and the transfer case unlocked by us', () => {
    expect(plan.rewire.has(0)).toBe(false);
    expect(plan.axles.map((a) => [a.name, a.driven, a.via])).toEqual([['Front axle', true, 'transfercase_F'], ['Rear axle', true, 'a drive shaft from transfercase']]);
    expect(plan.boxDrop.size).toBe(0);
    expect(plan.boxLock.has('transfercase')).toBe(false);
  });
});
