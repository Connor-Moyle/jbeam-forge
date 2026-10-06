import { describe, expect, it } from 'vitest';
import { editableFields, readableName } from '../../src/shared/powertrain/edits';

describe('settings without a label of their own', () => {
  it('read as words, keeping acronyms', () => {
    expect(readableName('oilpanMaximumSafeG')).toBe('Oilpan maximum safe g');
    expect(readableName('idleRPM')).toBe('Idle RPM');
    expect(readableName('max_rpm_change')).toBe('Max rpm change');
    expect(readableName('ABSPulseRate')).toBe('ABS pulse rate');
    expect(readableName('friction')).toBe('Friction');
  });

  it('are listed by their words, still found by their game name', () => {
    const [f] = editableFields({ eng: { mainEngine: { someNewThing: 3 } } });
    expect(f!.label).toBe('Some new thing');
    expect(f!.name).toBe('someNewThing');
  });
});
