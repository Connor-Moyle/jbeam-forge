import { describe, expect, it } from 'vitest';
import { checkLines, checksMessage, poleComparison } from '../../src/shared/ingame/checks';

// As the game reported them for a test car: the doors work, the boot lid doesn't lift.
const run = {
  doors: { latches: 4, pass: false, list: [{ name: 'door_FL_coupler', opened: true, shutAgain: true, moved: 32 }, { name: 'door_FR_coupler', opened: true, shutAgain: true, moved: 33 }, { name: 'hoodLatchCoupler', opened: true, shutAgain: false, moved: 43 }, { name: 'trunkCoupler', opened: false, shutAgain: true, moved: 0 }] },
  skidpad: { pass: true, g: 0.76, broke: 0, kmh: 42 },
  pole: { pass: true, hit: true, kmh: 49, peakG: 9.8, broke: 41, latches: 4, stillShut: 3 },
};

describe('the in-game checks, as told to the modder', () => {
  it('names the lid that stayed put and the one that didn’t shut', () => {
    const lines = checkLines(run);
    expect(lines.map((l) => [l.name, l.pass])).toEqual([['Doors and lids', false], ['Skidpad', true], ['50 km/h pole', true]]);
    expect(lines[0]!.text).toBe('trunk did not move when unlatched; hood did not shut again');
    expect(lines[1]!.text).toBe('held 0.76 g');
    expect(lines[2]!.text).toBe('hit at 49 km/h, 9.8 g at the worst, 41 beams broke, 3 of 4 doors and lids still shut');
    expect(checksMessage(run).tone).toBe('warning');
  });

  it('sets the game’s pole beside the sandbox’s', () => {
    const text = poleComparison({ kmh: 50, broke: 12, beams: 3000 }, run.pole)!;
    expect(text).toContain('hit the pole at 49 km/h: 9.8 g at the worst and 41 beams broke');
    expect(text).toContain('12 of the structure\'s own 3000 beams broke (0.4%)');
    expect(poleComparison({ kmh: 50, broke: 0, beams: 3000 }, run.pole)).toContain('trust the game');
    expect(poleComparison({ kmh: 50, broke: 3, beams: 3000 }, { hit: false })).toBeNull();
    expect(poleComparison({ kmh: 50, broke: 3, beams: 3000 }, undefined)).toBeNull();
  });

  it('passes a car whose doors work, and says when a check could not run or the pole was missed', () => {
    const good = { ...run, doors: { latches: 2, pass: true, list: run.doors.list.slice(0, 2) } };
    expect(checkLines(good)[0]).toEqual({ name: 'Doors and lids', pass: true, text: 'all 2 opened and shut again' });
    expect(checksMessage(good).tone).toBe('success');
    expect(checkLines({ pole: { pass: false, hit: false, kmh: 52 } })[0]!.text).toContain('never reached the pole');
    expect(checkLines({ skidpad: { error: 'no input' } })[0]).toMatchObject({ pass: false });
  });
});
