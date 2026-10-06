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

  it('gives an electric motor a battery, and a car without an engine no controller', () => {
    const motor = t({ slotType: 'motor', rearMotor: { requiredEnergyType: 'electricEnergy', energyStorage: 'mainBattery' } });
    const a = mainAdditions([motor], true);
    expect(a.energyStorage).toEqual([['type', 'name'], ['electricBattery', 'mainBattery']]);
    expect(a.variables.find((r) => r[0] === '$fuel')?.[2]).toBe('kWh');
    expect(mainAdditions([brakes], false).controller).toBeNull();
  });
});
