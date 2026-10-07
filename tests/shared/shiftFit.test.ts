import { describe, expect, it } from 'vitest';
import { engineRevRange, fitShiftingToEngine } from '../../src/shared/powertrain/shiftFit';

const bus = { idle: 650, limit: 2200 };
// The Autobello's race transaxle, as the game has it.
const transaxle = {
  box: {
    vehicleController: {
      calculateOptimalLoadShiftPoints: true,
      lowShiftDownRPM: [0, 0, 0, 1900, 2600, 2600, 2600, 2600],
      lowShiftUpRPM: [0, 0, 4300, 4200, 4050, 3850, 3750],
      clutchLaunchStartRPM: 3500,
      clutchLaunchTargetRPM: 4000,
    },
    gearbox: { gearRatios: [-2.95, 0, 3.91, 2.32] },
  },
};
const section = (parts: Record<string, unknown>, name = 'box') => (parts[name] as { vehicleController: Record<string, unknown> }).vehicleController;

describe('an engine’s rev range', () => {
  it('is the lower of the torque curve’s end and the limiter, with $variables read from their defaults', () => {
    const parts = [{ mainEngine: { idleRPM: 800, maxRPM: 7000, revLimiterRPM: '$revLimiterRPM' } }, { variables: [['name', 'type', 'unit', 'category', 'default'], ['$revLimiterRPM', 'range', 'rpm', 'Engine', 6500]] }];
    expect(engineRevRange(parts as never)).toEqual({ idle: 800, limit: 6500 });
  });

  it('is none for an electric motor', () => {
    expect(engineRevRange([{ mainEngine: { maxRPM: 12000, torque: [] } }] as never)).toBeNull();
  });
});

describe('a gearbox’s shifting fitted to the engine', () => {
  it('brings the launch clutch into a bus engine’s revs (it never let the clutch in at 3500)', () => {
    const { parts, changed } = fitShiftingToEngine(transaxle, 'box', bus);
    const vc = section(parts);
    const start = vc.clutchLaunchStartRPM as number;
    const target = vc.clutchLaunchTargetRPM as number;
    // Fully in, at full throttle, before the engine runs out of revs.
    expect(start - bus.idle + target).toBeLessThanOrEqual(bus.limit * 0.8 + 50);
    expect(start).toBeGreaterThan(bus.idle);
    expect(changed).toEqual(['box']);
    // The game's part itself is untouched.
    expect(transaxle.box.vehicleController.clutchLaunchStartRPM).toBe(3500);
  });

  it('brings the shift points down together, keeping a gear’s 0', () => {
    const vc = section(fitShiftingToEngine(transaxle, 'box', bus).parts);
    const up = vc.lowShiftUpRPM as number[];
    const down = vc.lowShiftDownRPM as number[];
    expect(Math.max(...up)).toBeLessThanOrEqual(bus.limit);
    expect(up.slice(0, 2)).toEqual([0, 0]);
    expect(down.slice(0, 3)).toEqual([0, 0, 0]);
    for (const [i, rpm] of down.entries()) {
      if (!rpm) continue;
      expect(rpm).toBeGreaterThan(bus.idle);
      expect(rpm).toBeLessThan(up[Math.min(i, up.length - 1)] || Infinity);
    }
    // The high-load points are the game's to work out from the torque curve.
    expect(vc.highShiftUpRPM).toBeUndefined();
  });

  it('leaves a gearbox that suits the engine as the game has it', () => {
    const fitted = fitShiftingToEngine(transaxle, 'box', { idle: 1000, limit: 8500 });
    expect(fitted.changed).toEqual([]);
    expect(fitted.parts.box).toBe(transaxle.box);
  });

  it('writes the game’s defaults down when they don’t fit and the gearbox gives none', () => {
    const bare = { box: { vehicleController: { transmissionShiftDelay: 0.2 } } };
    const vc = section(fitShiftingToEngine(bare, 'box', bus).parts);
    expect(vc.clutchLaunchStartRPM as number).toBeLessThan(2000);
    expect(vc.highShiftUpRPM as number).toBeLessThanOrEqual(bus.limit);
    expect(vc.lowShiftUpRPM as number).toBeLessThan(vc.highShiftUpRPM as number);
  });

  it('keeps what the modder set by hand', () => {
    const vc = section(fitShiftingToEngine(transaxle, 'box', bus, new Set(['box/vehicleController/clutchLaunchStartRPM'])).parts);
    expect(vc.clutchLaunchStartRPM).toBe(3500);
    expect(vc.clutchLaunchTargetRPM as number).toBeLessThan(4000);
  });
});
