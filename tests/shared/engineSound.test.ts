import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { applyPowertrainEdits, cylindersOf, fieldKey, soundConfigs } from '../../src/shared/powertrain/edits';
import { emptyEdits } from '../../src/shared/project/schema';
import { blendSamples } from '../../src/main/beamng/engineSounds';
import { blendWeights, firingHz } from '../../src/shared/powertrain/revMath';

const parts: Record<string, JbeamObject> = {
  v8: { soundConfig: { sampleName: 'V8_engine', mainGain: -2 }, soundConfigExhaust: { sampleName: 'V8_exhaust', mainGain: 1 } },
};

describe('engine sounds', () => {
  it('finds the sound configs and switches their blend on export', () => {
    const c = soundConfigs(parts);
    expect(c.map((x) => [x.section, x.sampleName])).toEqual([
      ['soundConfig', 'V8_engine'],
      ['soundConfigExhaust', 'V8_exhaust'],
    ]);
    const out = applyPowertrainEdits(parts, 'v8', { ...emptyEdits(), texts: { [fieldKey('v8', 'soundConfigExhaust', 'sampleName')]: 'I6_2_exhaust', [fieldKey('v8', 'soundConfig', 'nope')]: 'x' } });
    expect((out.v8!.soundConfigExhaust as JbeamObject).sampleName).toBe('I6_2_exhaust');
    // Only words the game already has are changed.
    expect((out.v8!.soundConfig as JbeamObject).nope).toBeUndefined();
    expect((parts.v8!.soundConfigExhaust as JbeamObject).sampleName).toBe('V8_exhaust');
  });

  it('reads cylinders from engine names', () => {
    expect(cylindersOf('5.5L V8')).toBe(8);
    expect(cylindersOf('2.0 I4 Turbo')).toBe(4);
    expect(cylindersOf('Flat 6')).toBe(6);
    expect(cylindersOf('Electric motor')).toBeNull();
  });

  it('reads samples from a sound blend, rows or objects', () => {
    const rows = blendSamples('{"samples": [["art/sound/v8/on_2000.ogg", 2000, 1], ["art/sound/v8/on_4000.ogg", 4000, 1], ["art/sound/v8/off_2000.ogg", 2000, 0]]}');
    expect(rows.map((r) => [r.rpm, r.load])).toEqual([
      [2000, 0],
      [2000, 1],
      [4000, 1],
    ]);
    const objs = blendSamples('{"a": {"layers": [{"file": "art/x_3000.wav", "rpm": 3000}]}}');
    expect(objs).toEqual([{ path: 'art/x_3000.wav', rpm: 3000, load: 1 }]);
  });

  it('crossfades the two samples around the rpm, equal power', () => {
    expect(blendWeights([2000, 4000, 6000], 1000)).toEqual([[0, 1]]);
    const w = blendWeights([2000, 4000, 6000], 3000);
    expect(w.map(([i]) => i)).toEqual([0, 1]);
    expect(w[0]![1] ** 2 + w[1]![1] ** 2).toBeCloseTo(1, 6);
    expect(firingHz(6000, 8)).toBe(400);
  });
});
