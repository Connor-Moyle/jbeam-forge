import { describe, expect, it } from 'vitest';
import { wheelSlotEnds } from '../../src/shared/suspension/wheels';

describe('which end’s wheels a set takes', () => {
  it('reads it from its wheel slots: a caravan’s axle takes front wheels, like a pickup’s front axle', () => {
    const caravan = { caravan_axle: { slotType: 'caravan_axle', slots2: [['name', 'allowTypes', 'default'], ['wheel_F_5', ['wheel_F_5'], 'steelwheel_01a_15x7_F']] } };
    const pickup = { pickup_SFA: { slotType: 'pickup_SFA', slots: [['type', 'default', 'description'], ['wheel_F_6', 'offroadwheel_04a_F', 'Front Wheels'], ['pickup_hub_F', 'pickup_hub_F', 'Hubs']] } };
    expect(wheelSlotEnds(caravan)).toEqual(['F']);
    expect(wheelSlotEnds(pickup)).toEqual(['F']);
    expect(wheelSlotEnds({ x: { slotType: 'x' } })).toEqual([]);
  });
});
