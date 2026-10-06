import { describe, expect, it } from 'vitest';
import { powertrainChain } from '../../src/shared/powertrain/chain';

const H = ['type', 'name', 'inputName', 'inputIndex'];
const engine = { powertrain: [H, ['combustionEngine', 'mainEngine', 'dummy', 0]] };
const gearbox = { powertrain: [H, ['frictionClutch', 'clutch', 'mainEngine', 1], ['manualGearbox', 'gearbox', 'clutch', 1], ['shaft', 'driveshaft', 'gearbox', 1]] };

describe('following the powertrain to the wheels', () => {
  it('reaches the wheels through the axle’s differential and half-shafts', () => {
    const axle = { powertrain: [H, ['differential', 'differential_R', 'driveshaft', 1], ['shaft', 'wheelaxleRL', 'differential_R', 1, { connectedWheel: 'RL' }], ['shaft', 'wheelaxleRR', 'differential_R', 2, { connectedWheel: 'RR' }]] };
    expect(powertrainChain([engine, gearbox, axle] as never)).toEqual({ wheels: ['RL', 'RR'], endsAt: null });
  });

  it('says where it stops when the axle has no differential (a rear-engined buggy’s, behind a front engine)', () => {
    const buggyAxle = { powertrain: [H, ['shaft', 'wheelaxleRL', 'differential_R', 1, { connectedWheel: 'RL' }]] };
    expect(powertrainChain([engine, gearbox, buggyAxle] as never)).toEqual({ wheels: [], endsAt: 'driveshaft' });
  });
});
