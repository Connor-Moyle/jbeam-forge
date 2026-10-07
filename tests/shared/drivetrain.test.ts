import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { applyDrivetrainToAxle, applyDrivetrainToGearbox, planDrivetrain, powertrainRows } from '../../src/shared/powertrain/drivetrain';

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

  describe('a gearbox set that brings its own car’s driveline', () => {
    // A live rear axle as the game cuts it: its own driveshaft, differential and wheel shafts, fed by the transfer case.
    const liveAxle = (): Record<string, JbeamObject> => ({
      shaft_R: { powertrain: [H, ['torsionReactor', 'torsionReactorR', 'transfercase', 1, {}], ['shaft', 'driveshaft', 'torsionReactorR', 1]] },
      diff_R: { powertrain: [H, ['differential', 'differential_R', 'driveshaft', 1, { diffType: 'lsd' }]] },
      wheels_R: { powertrain: [H, ['shaft', 'wheelaxleRL', 'differential_R', 1, { connectedWheel: 'RL' }], ['shaft', 'wheelaxleRR', 'differential_R', 2, { connectedWheel: 'RR' }]] },
    });
    const axles = (rear: Record<string, JbeamObject>) => [{ index: 0, name: 'Front', y: -1.4, parts: undriven('F') }, { index: 1, name: 'Rear', y: 1.3, parts: rear }];

    it('keeps the axle’s differential and half-shafts where a transaxle brings ones of the same name', () => {
      // The Scintilla's transaxle behind a crawler's rear axle: two differential_R and two of each wheel shaft.
      const box: Record<string, JbeamObject> = {
        transaxle: { powertrain: [H, ['dctGearbox', 'gearbox', 'mainEngine', 1]] },
        transfer: { powertrain: [H, ['shaft', 'transfercase', 'gearbox', 1, { uiName: 'Rear Output Shaft' }]] },
        diff: { powertrain: [H, ['differential', 'differential_R', 'transfercase', 1, { diffType: 'open', gearRatio: 3.07 }]] },
        halfshafts: { powertrain: [H, ['shaft', 'wheelaxleRL', 'differential_R', 1], ['shaft', 'wheelaxleRR', 'differential_R', 2]] },
      };
      const plan = planDrivetrain({ engine: ENGINE, gearbox: box, axles: axles(liveAxle()) });
      expect([...plan.boxDrop].sort()).toEqual(['differential_R', 'wheelaxleRL', 'wheelaxleRR']);
      expect(plan.rows).toBeNull();
      expect(applyDrivetrainToGearbox(box, plan).sort()).toEqual(['diff', 'halfshafts']);
      expect(powertrainRows(box).map((r) => r.name)).toEqual(['gearbox', 'transfercase']);
      expect(box.diff!.powertrain).toBeUndefined();
    });

    it('drops the branches that feed nothing and locks a centre differential left with one output', () => {
      // The Bolide's four-wheel-drive gearbox behind one driven axle: its centre differential sent the power to a front shaft that turned nothing.
      const box: Record<string, JbeamObject> = {
        auto: { powertrain: [H, ['torqueConverter', 'torqueConverter', 'mainEngine', 1], ['automaticGearbox', 'gearbox', 'torqueConverter', 1]] },
        transfer: { powertrain: [H, ['rangeBox', 'rangebox', 'gearbox', 1], ['differential', 'transfercase', 'rangebox', 1, { diffType: ['lsd', 'locked'], diffTorqueSplit: 0.3 }]] },
        middle: { powertrain: [H, ['torsionReactor', 'torsionReactorF', 'transfercase', 2], ['differential', 'differential_M', 'torsionReactorF', 1, { diffType: 'open' }]] },
        shaft: { powertrain: [H, ['torsionReactor', 'torsionReactorRR', 'transfercase', 1, {}], ['shaft', 'driveshaft', 'torsionReactorRR', 1]] },
        diff: { powertrain: [H, ['differential', 'differential_RR', 'driveshaft', 1, { diffType: 'open' }]] },
        halfshafts: { powertrain: [H, ['shaft', 'wheelaxleRRL', 'differential_RR', 1], ['shaft', 'wheelaxleRRR', 'differential_RR', 2]] },
      };
      const plan = planDrivetrain({ engine: ENGINE, gearbox: box, axles: axles(liveAxle()) });
      expect([...plan.boxDrop].sort()).toEqual(['differential_M', 'differential_RR', 'driveshaft', 'torsionReactorF', 'torsionReactorRR', 'wheelaxleRRL', 'wheelaxleRRR']);
      expect([...plan.boxLock]).toEqual(['transfercase']);
      applyDrivetrainToGearbox(box, plan);
      expect(powertrainRows(box).map((r) => r.name)).toEqual(['torqueConverter', 'gearbox', 'rangebox', 'transfercase']);
      expect((box.transfer!.powertrain as unknown[][])[2]![4]).toEqual({ diffType: 'locked', diffTorqueSplit: 0.3 });
    });

    it('ends at the gearbox when the axles take nothing from it, and feeds them from there', () => {
      const box: Record<string, JbeamObject> = {
        manual: { powertrain: [H, ['frictionClutch', 'clutch', 'mainEngine', 1], ['manualGearbox', 'gearbox', 'clutch', 1]] },
        diff: { powertrain: [H, ['differential', 'differential_F', 'gearbox', 1, { diffType: 'open' }]] },
      };
      const plan = planDrivetrain({ engine: ENGINE, gearbox: box, axles: axles(axle('R', 'driveshaft')) });
      expect([...plan.boxDrop]).toEqual(['differential_F']);
      expect(plan.source).toBe('gearbox');
      expect(plan.rows).toEqual([H, ['shaft', 'jbf_driveshaft_2', 'gearbox', 1]]);
    });

    it('keeps a transaxle’s differential for a suspension that only has the wheel shafts', () => {
      const box: Record<string, JbeamObject> = {
        manual: { powertrain: [H, ['frictionClutch', 'clutch', 'mainEngine', 1], ['manualGearbox', 'gearbox', 'clutch', 1]] },
        diff: { powertrain: [H, ['differential', 'differential_F', 'gearbox', 1, { diffType: 'open' }]] },
      };
      const plan = planDrivetrain({ engine: ENGINE, gearbox: box, axles: [{ index: 0, name: 'Front', y: -1.4, parts: axle('F', null) }, { index: 1, name: 'Rear', y: 1.3, parts: undriven('R') }] });
      expect(plan.boxDrop.size).toBe(0);
      expect(plan.boxLock.size).toBe(0);
      expect(plan.drop.size).toBe(0);
    });
  });

  it('warns when two axles have the same devices', () => {
    const plan = planDrivetrain({ engine: ENGINE, gearbox: BOX, axles: [{ index: 0, name: 'Rear 1', y: 1, parts: axle('R', 'driveshaft') }, { index: 1, name: 'Rear 2', y: 2, parts: axle('R', 'driveshaft') }] });
    expect(plan.problems.some((p) => /Rear 1 and Rear 2 both have a device named differential_R/.test(p))).toBe(true);
  });
});
