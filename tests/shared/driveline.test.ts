import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { applyDrivelineEdits, differentials, settingValue, wheelSettings } from '../../src/shared/powertrain/driveline';
import { emptyEdits } from '../../src/shared/project/schema';

const parts: Record<string, JbeamObject> = {
  car_diff_R: {
    slotType: 'car_diff_R',
    powertrain: [
      ['type', 'name', 'inputName', 'inputIndex'],
      ['differential', 'differential_R', 'driveshaft', 1, { diffType: 'open', gearRatio: '$=$finaldrive_R', friction: 3 }],
      ['shaft', 'wheelaxleRL', 'differential_R', 1],
    ],
  },
  car_diff_F: {
    slotType: 'car_diff_F',
    powertrain: [['type', 'name', 'inputName', 'inputIndex'], ['differential', 'differential_F', 'transfercase', 2]],
    differential_F: { diffType: 'lsd', gearRatio: 3.9, lsdPreload: 120 },
  },
};

describe('differentials', () => {
  it('finds them in row options or their own section', () => {
    const d = differentials(parts);
    expect(d.map((x) => x.device)).toEqual(['differential_R', 'differential_F']);
    expect(d[0]!.diffType).toEqual({ key: 'car_diff_R/powertrain:differential_R/diffType', value: 'open' });
    const ratio = d[0]!.settings.find((s) => s.name === 'gearRatio')!;
    expect(ratio.value).toBe('$=$finaldrive_R'); // tuned in game, not here
    expect(settingValue(ratio, undefined)).toBeNull();
    const f = d[1]!.settings.find((s) => s.name === 'lsdPreload')!;
    expect(f.key).toBe('car_diff_F/differential_F/lsdPreload');
    expect(settingValue(f, undefined)).toBe(120);
  });
});

describe('applyDrivelineEdits', () => {
  it('writes types and numbers where the game keeps them, adding LSD settings to an open diff', () => {
    const edits = { ...emptyEdits(), fields: { 'car_diff_R/powertrain:differential_R/lsdPreload': 80, 'car_diff_F/differential_F/gearRatio': 4.1 }, texts: { 'car_diff_R/powertrain:differential_R/diffType': 'lsd' } };
    const out = applyDrivelineEdits(parts, edits);
    const row = (out.car_diff_R!.powertrain as unknown[][])[1]!;
    expect(row[4]).toEqual({ diffType: 'lsd', gearRatio: '$=$finaldrive_R', friction: 3, lsdPreload: 80 });
    expect((out.car_diff_F!.differential_F as JbeamObject).gearRatio).toBe(4.1);
    // The game's data is untouched.
    expect(((parts.car_diff_R!.powertrain as unknown[][])[1]![4] as JbeamObject).diffType).toBe('open');
  });

  it('adds an options object to a row without one', () => {
    const out = applyDrivelineEdits(parts, { ...emptyEdits(), texts: { 'car_diff_F/powertrain:differential_F/diffType': 'locked' } });
    expect((out.car_diff_F!.powertrain as unknown[][])[1]).toEqual(['differential', 'differential_F', 'transfercase', 2, { diffType: 'locked' }]);
  });
});

describe('brakes and wheels', () => {
  const SUSP: Record<string, JbeamObject> = {
    car_hub_F: {
      pressureWheels: [
        ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
        { brakeTorque: 2500, parkingTorque: 0, pressurePSI: 30 },
        ['FR', 'wheel_FR', 'tire_FR', 'fw1r', 'fw1rr', 9999, 'fs1r', -1],
        { brakeTorque: 2400 },
        ['FL', 'wheel_FL', 'tire_FL', 'fw1l', 'fw1ll', 9999, 'fs1l', 1, { pressurePSI: 31 }],
      ],
    },
  };

  it('lists each setting once, from the first wheel row that sets it', () => {
    expect(wheelSettings(SUSP).map((w) => [w.name, w.value])).toEqual([
      ['brakeTorque', 2500],
      ['parkingTorque', 0],
      ['pressurePSI', 30],
    ]);
  });

  it('sets it on every wheel row that has it, leaving the game’s data alone', () => {
    const out = applyDrivelineEdits(SUSP, { ...emptyEdits(), fields: { 'car_hub_F/pressureWheels/brakeTorque': 4000, 'car_hub_F/pressureWheels/pressurePSI': 28 } });
    const rows = out.car_hub_F!.pressureWheels as unknown[];
    expect(rows[1]).toEqual({ brakeTorque: 4000, parkingTorque: 0, pressurePSI: 28 });
    expect(rows[3]).toEqual({ brakeTorque: 4000 });
    expect((rows[4] as unknown[])[8]).toEqual({ pressurePSI: 28 });
    expect((SUSP.car_hub_F!.pressureWheels as unknown[])[1]).toEqual({ brakeTorque: 2500, parkingTorque: 0, pressurePSI: 30 });
  });
});
