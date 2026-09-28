import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { applyChoices, findOptions, slotRows } from '../../src/shared/suspension/options';
import { transplantSuspension } from '../../src/shared/suspension/transplant';

const game: Record<string, JbeamObject> = {
  car_suspension_F: {
    slotType: 'car_suspension_F',
    information: { name: 'Front Suspension' },
    slots: [
      ['type', 'default', 'description'],
      ['car_brake_F', 'car_brake_F', 'Front Brakes'],
      ['car_steering', 'car_steering', 'Steering'],
    ],
    nodes: [['id', 'posX', 'posY', 'posZ'], ['fh1', 0.7, -1.3, 0.3]],
    beams: [['id1:', 'id2:'], ['fh1', 'f1']],
  },
  car_brake_F: { slotType: 'car_brake_F', information: { name: 'Stock Brakes' } },
  car_brake_F_sport: { slotType: 'car_brake_F', information: { name: 'Sport Brakes' }, slots: [['type', 'default', 'description'], ['car_brakepad_F', 'car_brakepad_F_race', 'Pads']] },
  car_brakepad_F_race: { slotType: 'car_brakepad_F', information: { name: 'Race Pads' } },
  car_brake_F_race: { slotType: 'car_brake_F', information: { name: 'Race Brakes' }, beams: [['id1:', 'id2:'], ['fh1', 'b77']] },
  car_steering: { slotType: 'car_steering', information: { name: 'Power Steering' } },
};
const find = (n: string) => game[n];
const set = ['car_suspension_F', 'car_brake_F', 'car_steering'];

describe('findOptions', () => {
  it('lists the other parts each slot takes, with their own slot defaults', () => {
    const o = findOptions(set, find, Object.entries(game));
    expect(o.slots).toEqual([{ slotType: 'car_brake_F', title: 'Front Brakes', default: 'car_brake_F', alternatives: [{ part: 'car_brake_F_sport', title: 'Sport Brakes' }, { part: 'car_brake_F_race', title: 'Race Brakes' }] }]);
    expect(Object.keys(o.parts).sort()).toEqual(['car_brake_F_race', 'car_brake_F_sport', 'car_brakepad_F_race']);
  });
});

describe('applyChoices', () => {
  const data = { parts: Object.fromEntries(set.map((n) => [n, game[n]!])), anchors: { f1: [0.5, -1.3, 0.4] as [number, number, number] }, root: 'car_suspension_F' };
  const options = { ...findOptions(set, find, Object.entries(game)), anchors: { b77: [0.6, -1.3, 0.2] as [number, number, number] } };

  it('switches the default and ships the offered parts', () => {
    const out = applyChoices(data, options, { car_brake_F: { default: 'car_brake_F_sport', offer: ['car_brake_F_race'] } });
    expect(slotRows(out.parts.car_suspension_F!).find((r) => r.key === 'car_brake_F')!.def).toBe('car_brake_F_sport');
    expect(Object.keys(out.parts).sort()).toEqual(['car_brake_F', 'car_brake_F_race', 'car_brake_F_sport', 'car_brakepad_F_race', 'car_steering', 'car_suspension_F']);
    expect(out.anchors).toEqual({ b77: [0.6, -1.3, 0.2], f1: [0.5, -1.3, 0.4] });
    // The game's data isn't changed.
    expect(slotRows(game.car_suspension_F!)[0]!.def).toBe('car_brake_F');
  });

  it('is a no-op without choices or options', () => {
    expect(applyChoices(data, options, {})).toBe(data);
    expect(applyChoices(data, undefined, { car_brake_F: { default: 'car_brake_F_sport', offer: [] } })).toBe(data);
  });

  it('transplants into one slot the game offers every choice for', () => {
    const chosen = applyChoices(data, options, { car_brake_F: { default: 'car_brake_F_sport', offer: ['car_brake_F_race'] } });
    const t = transplantSuspension({ ...chosen, offset: [0, 0, 0], partPrefix: 'mod_A_', nodePrefix: 'a_', target: [{ id: 'body1', pos: [0.5, -1.3, 0.4] }, { id: 'body2', pos: [0.6, -1.3, 0.2] }], meshNames: {}, tuning: {} });
    const types = ['mod_A_car_brake_F', 'mod_A_car_brake_F_sport', 'mod_A_car_brake_F_race'].map((n) => t.parts[n]?.slotType);
    expect(types).toEqual(['mod_A_car_brake_F', 'mod_A_car_brake_F', 'mod_A_car_brake_F']);
    expect(slotRows(t.parts.mod_A_car_suspension_F!).find((r) => r.key === 'mod_A_car_brake_F')!.def).toBe('mod_A_car_brake_F_sport');
    // The race brake's own body attachment is placed too.
    expect(JSON.stringify(t.parts.mod_A_car_brake_F_race!.beams)).toContain('body2');
  });
});
