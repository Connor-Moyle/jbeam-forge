import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { applyDrivetrainToAxle, planDrivetrain, powertrainRows } from '../../src/shared/powertrain/drivetrain';

const H = ['type', 'name', 'inputName', 'inputIndex'];
const ENGINE: Record<string, JbeamObject> = { eng: { powertrain: [H, ['combustionEngine', 'mainEngine', 'dummy', 0]] } };
const BOX: Record<string, JbeamObject> = { box: { powertrain: [H, ['frictionClutch', 'clutch', 'mainEngine', 1], ['manualGearbox', 'gearbox', 'clutch', 1]] } };
const axle = (end: string, input: string | null): Record<string, JbeamObject> => ({
  [`susp_${end}`]: { powertrain: [H, ['shaft', `wheelaxle${end}L`, `differential_${end}`, 1], ['shaft', `wheelaxle${end}R`, `differential_${end}`, 2]] },
  ...(input ? { [`diff_${end}`]: { powertrain: [H, ['differential', `differential_${end}`, input, 1, { diffType: 'open' }]] }, [`diff_${end}_lsd`]: { powertrain: [H, ['differential', `differential_${end}`, input, 1, { diffType: 'lsd' }]] } } : {}),
});
const undriven = (end: 'F' | 'R'): Record<string, JbeamObject> => ({ [`susp_${end}`]: { nodes: [] } });

describe('drive shafts', () => {
  it('reads powertrain rows', () => {
    expect(powertrainRows(BOX).map((r) => [r.name, r.input])).toEqual([['clutch', 'mainEngine'], ['gearbox', 'clutch']]);
  });

  it('adds a drive shaft from the gearbox to a rear axle from another car', () => {
    const rear = axle('R', 'driveshaft');
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front', y: -1.4, parts: undriven('F') }, { index: 1, name: 'Rear', y: 1.3, parts: rear }] });
    expect(plan.source).toBe('gearbox');
    expect(plan.rows).toEqual([H, ['shaft', 'jbf_driveshaft_2', 'gearbox', 1]]);
    expect(plan.axles.map((a) => [a.name, a.driven])).toEqual([['Front', false], ['Rear', true]]);
    expect(plan.problems).toEqual([]);
    const changed = applyDrivetrainToAxle(rear, plan, 1);
    expect(changed.sort()).toEqual(['diff_R', 'diff_R_lsd']);
    // Both differential choices are fed by our shaft; the wheel axles are untouched.
    for (const p of ['diff_R', 'diff_R_lsd']) expect(powertrainRows({ p: rear[p]! })[0]).toMatchObject({ name: 'differential_R', input: 'jbf_driveshaft_2', index: 1 });
    expect(powertrainRows({ s: rear.susp_R! })[0]!.input).toBe('differential_R');
  });

  it('leaves an axle the gearbox already feeds (a transaxle)', () => {
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front', y: -1.4, parts: axle('F', 'gearbox') }, { index: 1, name: 'Rear', y: 1.3, parts: undriven('R') }] });
    expect(plan.rows).toBeNull();
    expect(plan.rewire.size).toBe(0);
    expect(plan.axles[0]!.via).toBe('gearbox');
  });

  it('splits torque front and rear with a centre differential', () => {
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front', y: -1.4, parts: axle('F', 'transfercase') }, { index: 1, name: 'Rear', y: 1.3, parts: axle('R', 'driveshaft') }] }, { layout: 'auto', frontShare: 0.35, centre: 'viscous' });
    expect(plan.rows!.slice(1)).toEqual([
      ['differential', 'jbf_centre_diff', 'gearbox', 1, { diffType: 'viscous', diffTorqueSplit: 0.35, gearRatio: 1, friction: 1, viscousCoef: 25, viscousTorque: 1500 }],
      ['shaft', 'jbf_driveshaft_1', 'jbf_centre_diff', 1],
      ['shaft', 'jbf_driveshaft_2', 'jbf_centre_diff', 2],
    ]);
  });

  it('drives only the chosen end, and the other end rolls freely', () => {
    const front = axle('F', 'transfercase');
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front', y: -1.4, parts: front }, { index: 1, name: 'Rear', y: 1.3, parts: axle('R', 'driveshaft') }] }, { layout: 'rwd', frontShare: 0.4, centre: 'viscous' });
    expect(plan.axles.map((a) => a.driven)).toEqual([false, true]);
    expect(plan.drop.has(0)).toBe(true);
    applyDrivetrainToAxle(front, plan, 0);
    expect(powertrainRows(front)).toEqual([]);
  });

  it("doesn't drive an axle whose differential stayed behind, and drops its dangling wheel shafts", () => {
    // The ETK 800's front suspension on a rear-drive car: wheel shafts on differential_F, whose part is an empty slot.
    const front = axle('F', null);
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front', y: -1.4, parts: front }, { index: 1, name: 'Rear', y: 1.3, parts: axle('R', 'driveshaft') }] });
    expect(plan.axles.map((a) => [a.name, a.driveable, a.driven])).toEqual([['Front', false, false], ['Rear', true, true]]);
    // No centre differential sending torque to nothing: one shaft to the rear.
    expect(plan.rows).toEqual([H, ['shaft', 'jbf_driveshaft_2', 'gearbox', 1]]);
    expect(plan.drop.has(0)).toBe(true);
    applyDrivetrainToAxle(front, plan, 0);
    expect(powertrainRows(front)).toEqual([]);
  });

  it('says what is wrong', () => {
    expect(planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front', y: -1.4, parts: undriven('F') }] }).problems[0]).toMatch(/no wheel is driven/);
    expect(planDrivetrain({ engine: ENGINE, gearbox: null, axles: [{ index: 0, name: 'Rear', y: 1, parts: axle('R', 'driveshaft') }] }).problems[0]).toMatch(/Fit a gearbox/);
    expect(planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'F', y: -1, parts: undriven('F') }, { index: 1, name: 'R', y: 1, parts: axle('R', 'driveshaft') }] }, { layout: 'fwd', frontShare: 0.4, centre: 'open' }).problems[0]).toMatch(/front axle has no differential/);
  });

  it('shares an end between tandem axles', () => {
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Front', y: -2, parts: undriven('F') }, { index: 1, name: 'Rear 1', y: 1, parts: axle('R', 'driveshaft') }, { index: 2, name: 'Rear 2', y: 2.4, parts: axle('R2', 'driveshaft_2') }] });
    expect(plan.rows!.slice(1).map((r) => r.slice(0, 4))).toEqual([
      ['differential', 'jbf_centre_diff', 'gearbox', 1],
      ['shaft', 'jbf_driveshaft_2', 'jbf_centre_diff', 1],
      ['shaft', 'jbf_driveshaft_3', 'jbf_centre_diff', 2],
    ]);
  });

  it('warns when two axles have the same devices', () => {
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Rear 1', y: 1, parts: axle('R', 'driveshaft') }, { index: 1, name: 'Rear 2', y: 2, parts: axle('R', 'driveshaft') }] });
    expect(plan.problems.some((p) => /Rear 1 and Rear 2 both have a device named differential_R/.test(p))).toBe(true);
  });
});
