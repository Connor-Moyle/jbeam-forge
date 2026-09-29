import { describe, expect, it } from 'vitest';
import { axleSpecs } from '../../src/renderer/sim/simSession';

describe('suspension drop springs from tuning', () => {
  it('takes the main spring and bump damping, not anti-roll bars, rebound or heights', () => {
    const [a] = axleSpecs([{ name: 'Front', y: -1.4, track: 1.5, tuning: { $arb_spring_F: 30000, $springheight_F: 0.05, $damp_rebound_F: 9000, $spring_F: 60000, $damp_bump_F: 4000 } }]);
    expect(a).toMatchObject({ spring: 60000, damp: 4000 });
  });

  it('leaves them to the car when the tuning has none', () => {
    const [a] = axleSpecs([{ name: 'Rear', y: 1.3, track: 1.5, tuning: { $arb_spring_R: 30000, $damp_rebound_R: 9000 } }]);
    expect(a).toEqual({ name: 'Rear', y: 1.3, track: 1.5 });
  });
});
