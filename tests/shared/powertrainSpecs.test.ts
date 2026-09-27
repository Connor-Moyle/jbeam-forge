import { describe, expect, it } from 'vitest';
import { engineLayout, engineSpecs, gearboxSpecs, isEnginePart, isGearboxPart, partTitle, powertrainDevices } from '@shared/powertrain/specs';

const ENGINE = {
  information: { name: '3.5L V6 Engine' },
  slotType: 'bastion_engine',
  powertrain: [
    ['type', 'name', 'inputName', 'inputIndex'],
    ['combustionEngine', 'mainEngine', 'dummy', 0],
  ],
  mainEngine: {
    torque: [
      ['rpm', 'torque'],
      [0, 0],
      [2000, 339],
      [4000, 407],
      [6000, 392],
      [7000, 310],
    ],
    idleRPM: 750,
    maxRPM: 6600,
    requiredEnergyType: 'gasoline',
  },
};

describe('powertrain specs', () => {
  it('finds engines and gearboxes by their devices', () => {
    expect(powertrainDevices(ENGINE)).toEqual(['combustionEngine']);
    expect(isEnginePart(ENGINE)).toBe(true);
    const box = { powertrain: [['type', 'name'], ['frictionClutch', 'clutch'], ['manualGearbox', 'gearbox']], gearbox: { gearRatios: [-3.5, 0, 3.6, 2.1, 1.4, 1.0, 0.8] } };
    expect(isGearboxPart(box)).toBe(true);
    expect(isEnginePart(box)).toBe(false);
    expect(gearboxSpecs(box)).toEqual({ kind: 'Manual', gears: 5, ratios: [-3.5, 0, 3.6, 2.1, 1.4, 1.0, 0.8] });
  });

  it('reads an engine spec sheet', () => {
    const turbo = { mainEngine: { turbocharger: 'x' } };
    const s = engineSpecs(ENGINE, [ENGINE, turbo], '3.5L V6 Engine');
    expect(s).toMatchObject({ layout: 'V6', displacementL: 3.5, fuel: 'petrol', forcedInduction: 'turbo', idleRPM: 750, maxRPM: 6600, peakTorque: { nm: 407, rpm: 4000 } });
    // 7000 rpm is past the limiter: the peak is at 6000 (392 Nm ≈ 246 kW).
    expect(s.peakPower?.rpm).toBe(6000);
    expect(s.peakPower?.kw).toBeCloseTo((392 * 6000 * 2 * Math.PI) / 60000);
  });

  it('names engine layouts', () => {
    expect(engineLayout('2.0L I4 Diesel Engine')).toBe('Inline-4');
    expect(engineLayout('4.4L V8')).toBe('V8');
    expect(engineLayout('2.5L Flat-4 Boxer')).toBe('Flat-4');
    expect(engineLayout('1.3L Air Cooled F4 Engine')).toBe('Flat-4');
    expect(engineLayout('1.3L Rotary')).toBe('Rotary');
    expect(engineLayout('Mystery Motor 3000')).toBe('Electric');
    expect(engineLayout('Some engine')).toBe('Other');
  });

  it('reads display names stored per language', () => {
    expect(partTitle({ information: { name: { en: '4.4L V8' } } }, 'x')).toBe('4.4L V8');
    expect(partTitle({}, 'fallback')).toBe('fallback');
    expect(partTitle({ information: { name: 'ui.vehicleconfig.information.name.BRAND TCM 8.9L Diesel Engine' } }, 'x')).toBe('TCM 8.9L Diesel Engine');
  });
});
