import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { firstSlotType, fittingDefaults, slotTypesOf } from '../../src/shared/jbeam/slots';

describe('the slot types a part fits', () => {
  it('reads one, several or none', () => {
    expect(slotTypesOf({ slotType: 'a' })).toEqual(['a']);
    expect(slotTypesOf({ slotType: ['a', 'b', 3] })).toEqual(['a', 'b']);
    expect(slotTypesOf({})).toEqual([]);
    expect(firstSlotType({ slotType: ['a', 'b'] })).toBe('a');
    expect(firstSlotType(undefined)).toBe('');
  });
});

describe('slot defaults that can be fitted', () => {
  const pool: Record<string, JbeamObject> = {
    etk_finaldrive_F_323: { slotType: 'etk_finaldrive_F' },
    etk_finaldrive_R_323: { slotType: 'etk_finaldrive_R' },
    etk_finaldrive_R_race: { slotType: 'etk_finaldrive_R' },
    etk_finaldrive_R_291: { slotType: 'etk_finaldrive_R' },
    sunburst2_intake: { slotType: ['sunburst2_engine_1_6_intake', 'sunburst2_engine_2_0_intake'] },
  };
  const find = (n: string) => pool[n];
  const fitting = (t: string) => Object.keys(pool).filter((n) => slotTypesOf(pool[n]).includes(t));
  const HEAD = ['name', 'allowTypes', 'denyTypes', 'default', 'description'];

  it('swaps a default made for another slot for the nearest-named part of the right one (the ETK’s rear final drive)', () => {
    const diff: JbeamObject = { slots2: [HEAD, ['etk_finaldrive_R', ['etk_finaldrive_R'], [], 'etk_finaldrive_F_323', 'Rear Final Drive']] };
    expect((fittingDefaults(diff, find, fitting).slots2 as unknown[][])[1]![3]).toBe('etk_finaldrive_R_323');
  });

  it('keeps a default that fits one of several slot types, and one that fits by the old table’s type column', () => {
    const engine: JbeamObject = { slots2: [HEAD, ['sunburst2_engine_1_6_intake', ['sunburst2_engine_1_6_intake'], [], 'sunburst2_intake', 'Intake']] };
    expect(fittingDefaults(engine, find, fitting)).toBe(engine);
    const old: JbeamObject = { slots: [['type', 'default', 'description'], ['etk_finaldrive_F', 'etk_finaldrive_F_323', 'Front Final Drive']] };
    expect(fittingDefaults(old, find, fitting)).toBe(old);
  });

  it('empties a default no file defines, and one nothing can replace', () => {
    const part: JbeamObject = { slots2: [HEAD, ['bumpstop', ['bumpstop'], [], 'missing_part', 'Bump stop'], ['strange', ['strange'], [], 'etk_finaldrive_F_323', 'Odd']] };
    const rows = fittingDefaults(part, find, fitting).slots2 as unknown[][];
    expect([rows[1]![3], rows[2]![3]]).toEqual(['', '']);
  });
});
