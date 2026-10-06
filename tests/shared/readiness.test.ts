import { describe, expect, it } from 'vitest';
import { readiness, type ReadinessInput } from '../../src/shared/readiness';

const ready: ReadinessInput = {
  ungenerated: [],
  exportErrors: 0,
  exportWarnings: 0,
  game: { found: true, errors: 0, noController: false, unstable: false },
  openable: { total: 4, hinged: 4 },
  lights: 6,
  configs: 2,
  previews: { with: 3, of: 3 },
  measured: true,
};

describe('is the mod ready to share', () => {
  it('ticks everything off for a finished car', () => {
    expect(readiness(ready).every((i) => i.state === 'done')).toBe(true);
  });

  it('says what is left, in plain words', () => {
    const items = readiness({ ...ready, ungenerated: ['Hood', 'Trunk'], exportErrors: 1, game: { found: true, errors: 0, noController: false, unstable: true }, openable: { total: 4, hinged: 2 } });
    const by = (id: string) => items.find((i) => i.id === id)!;
    expect(by('structure')).toMatchObject({ state: 'todo', detail: 'Not generated yet: Hood, Trunk.' });
    expect(by('export').detail).toBe('1 thing to fix before it can be exported (Export lists them).');
    expect(by('spawns').detail).toMatch(/came apart/);
    expect(by('opens').detail).toMatch(/^2 of 4/);
  });

  it('doesn’t claim anything about the game before the car has been spawned', () => {
    const items = readiness({ ...ready, game: null, measured: false });
    expect(items.filter((i) => i.state === 'unknown').map((i) => i.id)).toEqual(['spawns', 'drives', 'measured']);
  });
});
