import { describe, expect, it } from 'vitest';
import { buildGlowMap, lightFunction } from '@shared/export/lights';

describe('lights', () => {
  it('maps light kinds to the game’s electrics', () => {
    expect(lightFunction('headlight', 'L')).toBe('lowhighbeam');
    expect(lightFunction('taillight', 'R')).toEqual({ lowhighbeam: 0.4, brakelights: 1 });
    expect(lightFunction('indicator', 'FL')).toBe('signal_L');
    expect(lightFunction('indicator', 'RR')).toBe('signal_R');
    expect(lightFunction('reverse_light', null)).toBe('reverse');
    expect(lightFunction('hood', null)).toBeNull();
  });

  it('glows only materials that just lights use', () => {
    const { glowMap, shared } = buildGlowMap([
      { material: 'm_headlight', light: 'lowhighbeam' },
      { material: 'm_signal', light: 'signal_L' },
      { material: 'm_paint', light: 'brakelights' },
      { material: 'm_paint', light: null },
    ]);
    expect(glowMap).toEqual({
      m_headlight: { simpleFunction: 'lowhighbeam', off: 'm_headlight', on: 'm_headlight_on' },
      m_signal: { simpleFunction: 'signal_L', off: 'm_signal', on: 'm_signal_on' },
    });
    expect(shared).toEqual(['m_paint']);
  });
});
