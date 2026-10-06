import { describe, expect, it } from 'vitest';
import { installProblems } from '../../src/shared/export/installCheck';

const file = (part: string, body: object) => ({ part, text: JSON.stringify({ [part]: body }) });

describe('the jbeam as the game assembles it', () => {
  const main = file('car', { slotType: 'main', slots: [['type', 'default'], ['car_body', 'car_body'], ['car_engine', 'car_E_engine']] });
  const body = file('car_body', { slotType: 'car_body', nodes: [['id', 'posX', 'posY', 'posZ'], ['b7r', 0, 0, 0], ['b21', 0, 1, 0]] });

  it('passes a car whose parts each own their nodes', () => {
    const engine = file('car_E_engine', { slotType: 'car_engine', nodes: [['id', 'posX', 'posY', 'posZ'], ['e_e1r', 0, 0, 1]] });
    expect(installProblems([main, body, engine], 'car', {}, 'car_')).toEqual([]);
  });

  it('finds two installed parts defining the same node', () => {
    const engine = file('car_E_engine', { slotType: 'car_engine', nodes: [['id', 'posX', 'posY', 'posZ'], ['b7r', 0, -1.9, 0.2], ['b21', 0, -1.3, 0.2]] });
    const [p] = installProblems([main, body, engine], 'car', {}, 'car_');
    expect(p).toMatch(/car_body and car_E_engine both define nodes b7r, b21/);
  });

  it('ignores parts that are not installed together (alternatives in one slot)', () => {
    const a = file('car_E_engine', { slotType: 'car_engine', nodes: [['id', 'posX', 'posY', 'posZ'], ['e1', 0, 0, 0]] });
    const b = file('car_E2_engine', { slotType: 'car_engine', nodes: [['id', 'posX', 'posY', 'posZ'], ['e1', 0, 0, 0]] });
    expect(installProblems([main, body, a, b], 'car', {}, 'car_')).toEqual([]);
    expect(installProblems([main, body, a, b], 'car', { car_engine: 'car_E2_engine' }, 'car_')).toEqual([]);
  });

  it('finds a slot that points at one of the mod’s parts that wasn’t written, not at the game’s', () => {
    const engine = file('car_E_engine', { slotType: 'car_engine', slots: [['type', 'default'], ['car_E_transaxle', 'car_E_transaxle_7DCT'], ['paint_design', 'some_game_design']] });
    expect(installProblems([main, body, engine], 'car', {}, 'car_')).toEqual(['The car_E_transaxle slot uses car_E_transaxle_7DCT, which isn’t in the mod.'.replace('’', "'")]);
  });
});

describe('the same node restated at the same place', () => {
  it('is the game’s own habit and passes; a different place does not', () => {
    const main = file('car', { slotType: 'main', slots: [['type', 'default'], ['car_susp', 'car_susp'], ['car_shock', 'car_shock']] });
    const susp = file('car_susp', { slotType: 'car_susp', nodes: [['id', 'posX', 'posY', 'posZ'], ['fsf1ll', 0.31649, -1.8046, 0.46351]] });
    const same = file('car_shock', { slotType: 'car_shock', nodes: [['id', 'posX', 'posY', 'posZ'], ['fsf1ll', 0.31649, -1.8046, 0.46351]] });
    const moved = file('car_shock', { slotType: 'car_shock', nodes: [['id', 'posX', 'posY', 'posZ'], ['fsf1ll', 0.4, -1.5, 0.5]] });
    expect(installProblems([main, susp, same], 'car', {}, 'car_')).toEqual([]);
    expect(installProblems([main, susp, moved], 'car', {}, 'car_')).toHaveLength(1);
  });
});

describe('a borrowed set restating its own node somewhere else', () => {
  it('is the game’s override and passes; across sets or against ours it is a clash', () => {
    const main = file('car', { slotType: 'main', slots: [['type', 'default'], ['car_F_susp', 'car_F_susp'], ['car_F_coil', 'car_F_coil'], ['car_E_eng', 'car_E_eng']] });
    const susp = file('car_F_susp', { slotType: 'car_F_susp', nodes: [['id', 'posX', 'posY', 'posZ'], ['f_fsm1r', -0.5, -1.4, 0.6]] });
    const coil = file('car_F_coil', { slotType: 'car_F_coil', nodes: [['id', 'posX', 'posY', 'posZ'], ['f_fsm1r', -0.5, -1.4, 0.7]] });
    const eng = file('car_E_eng', { slotType: 'car_E_eng', nodes: [['id', 'posX', 'posY', 'posZ'], ['f_fsm1r', 0, -1, 0.3]] });
    expect(installProblems([main, susp, coil, file('car_E_eng', { slotType: 'car_E_eng' })], 'car', {}, 'car_')).toEqual([]);
    expect(installProblems([main, susp, file('car_F_coil', { slotType: 'car_F_coil' }), eng], 'car', {}, 'car_')).toHaveLength(1);
  });
});
