import { describe, expect, it } from 'vitest';
import { mainAdditions } from '../../src/shared/export/drivable';

const t = (body: object) => JSON.stringify({ part: body });

describe('what a car’s main part must provide for borrowed game parts', () => {
  const engine = t({
    slotType: 'car_engine',
    mainEngine: { requiredEnergyType: 'gasoline', energyStorage: ['fueltank_R', 'fueltank_L'], maxRPM: 7000 },
    vehicleController: { highShiftUpRPM: '$=$revLimiterRPM - 200' },
  });
  const brakes = t({ slotType: 'car_brakes', pressureWheels: { brakeTorque: '$=$brakestrength*8000*$brakebias' } });

  it('adds the drive controller, the tanks the engine names, and the variables nothing defines', () => {
    const a = mainAdditions([engine, brakes], true);
    expect(a.controller).toEqual([['fileName'], ['vehicleController', {}]]);
    expect(a.energyStorage).toEqual([['type', 'name'], ['fuelTank', 'fueltank_R'], ['fuelTank', 'fueltank_L']]);
    expect(a.storages.fueltank_R).toMatchObject({ energyType: 'gasoline', fuelCapacity: 30, startingFuelCapacity: '$fuel' });
    const names = a.variables.map((r) => r[0]);
    expect(names).toEqual(expect.arrayContaining(['$brakebias', '$brakestrength', '$fuel', '$revLimiterRPM']));
    expect(a.variables.find((r) => r[0] === '$brakestrength')).toEqual(['$brakestrength', 'range', '', 'Brakes', 1, 0.6, 1, 'Brake Force Multiplier', 'Scales the overall brake torque for this setup']);
  });

  it('adds nothing a part already provides', () => {
    const tank = t({ slotType: 'tank', energyStorage: [['type', 'name'], ['fuelTank', 'fueltank_R'], ['fuelTank', 'fueltank_L']], variables: [['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'], ['$brakestrength', 'range', '', 'Brakes', 1, 0.6, 1, 'x', 'y'], ['$brakebias', 'range', '', 'Brakes', 0.7, 0, 1, 'x', 'y'], ['$revLimiterRPM', 'range', 'rpm', 'Engine', 7000, 1000, 9000, 'x', 'y']] });
    const ctrl = t({ slotType: 'body', controller: [['fileName'], ['vehicleController', {}]] });
    const a = mainAdditions([engine, brakes, tank, ctrl], true);
    expect(a.controller).toBeNull();
    expect(a.energyStorage).toBeNull();
    expect(a.variables).toEqual([]);
  });

  it('finds variables used in table rows too (the Hopper crawler’s rear shock)', () => {
    const shock = t({ slotType: 'shock_R', rearBypass: { bypassDampers: [['pos', 'a', 'b'], [-0.22, '$bp_6C_R', '$=$bp_1SC_F+$bp_2MC_F']] } });
    const names = mainAdditions([shock], false).variables.map((r) => r[0]);
    expect(names).toEqual(expect.arrayContaining(['$bp_6C_R', '$bp_1SC_F', '$bp_2MC_F']));
  });

  it('leaves unset a variable a part checks for being unset (the Barstow’s $trackwidth_R)', () => {
    const axle = t({ slotType: 'axle_R', slots2: [['name', 'allowTypes', 'default', 'description'], ['wheel_R_5', ['wheel_R_5'], 'steelwheel', 'Rear Wheels', { nodeOffset: { x: '$=case($trackwidth_R == nil, $trackoffset_R+0.25, $trackwidth_R)', y: 1.4, z: 0.29 } }]] });
    const names = mainAdditions([axle], false).variables.map((r) => r[0]);
    expect(names).toContain('$trackoffset_R');
    expect(names).not.toContain('$trackwidth_R');
  });

  it('gives an electric motor a battery, and a car without an engine no controller', () => {
    const motor = t({ slotType: 'motor', rearMotor: { requiredEnergyType: 'electricEnergy', energyStorage: 'mainBattery' } });
    const a = mainAdditions([motor], true);
    expect(a.energyStorage).toEqual([['type', 'name'], ['electricBattery', 'mainBattery']]);
    expect(a.variables.find((r) => r[0] === '$fuel')?.[2]).toBe('kWh');
    expect(mainAdditions([brakes], false).controller).toBeNull();
  });
});

import { drivetrainIssues } from '../../src/shared/export/validate';

describe('the drivetrain end to end', () => {
  const run = (doc: Parameters<typeof drivetrainIssues>[0]) => {
    const out: string[] = [];
    drivetrainIssues(doc, (code) => out.push(code));
    return out;
  };
  const set = (name: string) => ({ name }) as never;
  const axle = (fitted: boolean) => ({ fitted: fitted ? {} : null }) as never;

  it('names the missing link', () => {
    expect(run({ powertrain: { engine: set('V8'), gearbox: null }, axles: [axle(true), axle(true)] })).toEqual(['drivetrain-no-gearbox']);
    expect(run({ powertrain: { engine: null, gearbox: set('5M') }, axles: [] })).toEqual(['drivetrain-no-engine']);
    expect(run({ powertrain: { engine: set('V8'), gearbox: set('5M'), drivetrain: { layout: 'rwd', frontShare: 0, centre: 'open' } }, axles: [axle(true), axle(false)] } as never)).toEqual(['drivetrain-no-axle']);
    expect(run({ powertrain: { engine: set('V8'), gearbox: set('5M') }, axles: [axle(false), axle(false)] })).toEqual(['drivetrain-no-axle']);
  });

  it('passes a complete one, and a car without an engine', () => {
    expect(run({ powertrain: { engine: set('V8'), gearbox: set('5M') }, axles: [axle(true), axle(true)] })).toEqual([]);
    expect(run({ powertrain: { engine: null, gearbox: null }, axles: [] })).toEqual([]);
  });
});
