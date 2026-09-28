import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { applyDrivelineEdits, differentials, settingValue } from '../../src/shared/powertrain/driveline';
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
