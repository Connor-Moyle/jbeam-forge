import { describe, expect, it } from 'vitest';
import { suspensionLoad, suspensionLoadWarning } from '../../src/shared/suspension/load';

const covet = { name: 'Front Suspension', vehicleName: 'Ibishu Covet', vehicleWeight: 995 };

describe('a suspension under a car of another weight', () => {
  it('is fine near the weight it was made for, and unknown without both weights', () => {
    expect(suspensionLoad(1100, 995)?.state).toBe('fine');
    expect(suspensionLoadWarning(covet, 'front', 1100)).toBeNull();
    expect(suspensionLoad(null, 995)).toBeNull();
    expect(suspensionLoadWarning({ name: 'x', vehicleName: 'y' }, 'front', 1400)).toBeNull();
  });

  it('warns when the car is much heavier (the Covet’s under the practice car)', () => {
    const text = suspensionLoadWarning(covet, 'front', 1420)!;
    expect(text).toContain('Ibishu Covet, about 1000 kg');
    expect(text).toContain('about 1420 kg, 43% more');
    expect(text).toContain('sit low');
  });

  it('warns when the car is much lighter', () => {
    expect(suspensionLoadWarning({ ...covet, vehicleWeight: 2600 }, 'rear', 1300)).toContain('50% less: it will sit high');
  });
});
