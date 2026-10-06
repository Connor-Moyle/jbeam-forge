import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DESIGN_PRESETS, designEngine, designName, displacementOf, editsForDesign, EngineDesignSchema, tidyDesign, type EngineDesign } from '@shared/powertrain/design';
import { designTarget } from '@shared/powertrain/edits';

const preset = (id: string): EngineDesign => ({ ...DEFAULT_DESIGN, ...DESIGN_PRESETS.find((p) => p.id === id)!.design });

describe('engine designer', () => {
  it('every preset is a valid design that makes a sensible engine', () => {
    for (const p of DESIGN_PRESETS) {
      const d = preset(p.id);
      expect(EngineDesignSchema.safeParse(d).success, p.id).toBe(true);
      const r = designEngine(d);
      expect(r.peakPower.kw, p.id).toBeGreaterThan(30);
      // Up to a drag engine's; anything past that is a broken preset.
      expect(r.peakPower.kw, p.id).toBeLessThan(2500);
      expect(r.massKg, p.id).toBeGreaterThan(30);
      expect(r.curve.every(([rpm, nm], i) => nm > 0 && (i === 0 || rpm > r.curve[i - 1]![0])), p.id).toBe(true);
    }
  });

  it('lands near real engines', () => {
    const m10 = designEngine(preset('e30-m10')); // BMW M10 1.8 (318i): 77 kW, 141 Nm
    expect(m10.displacementL).toBeCloseTo(1.77, 1);
    expect(m10.peakPower.kw).toBeGreaterThan(65);
    expect(m10.peakPower.kw).toBeLessThan(90);
    expect(m10.peakTorque.nm).toBeGreaterThan(125);
    expect(m10.peakTorque.nm).toBeLessThan(165);
    const s14 = designEngine(preset('s14')); // BMW S14 2.3 (E30 M3): 143–158 kW, 230–240 Nm
    expect(s14.peakPower.kw).toBeGreaterThan(130);
    expect(s14.peakPower.kw).toBeLessThan(175);
    const tdi = designEngine(preset('diesel')); // a 2.0 turbo diesel: 320–380 Nm low down
    expect(tdi.peakTorque.nm).toBeGreaterThan(300);
    expect(tdi.peakTorque.rpm).toBeLessThan(3000);
  });

  it('works out displacement from bore, stroke and cylinders', () => {
    expect(displacementOf({ layout: 'inline', cylinders: 4, bore: 86, stroke: 86 })).toBeCloseTo(1.998, 2);
    expect(displacementOf({ layout: 'rotary', cylinders: 2, bore: 86, stroke: 86 })).toBeCloseTo(1.308, 2);
    expect(designName(preset('hot-hatch'))).toBe('2.0 L inline-4 turbo');
  });

  it('moves the numbers the way each choice should', () => {
    const base = designEngine(DEFAULT_DESIGN);
    const turbo = designEngine({ ...DEFAULT_DESIGN, aspiration: 'turbo', boost: 15 });
    expect(turbo.peakTorque.nm).toBeGreaterThan(base.peakTorque.nm * 1.5);
    expect(turbo.massKg).toBeGreaterThan(base.massKg);
    const race = designEngine({ ...DEFAULT_DESIGN, cam: 1 });
    expect(race.peakTorque.rpm).toBeGreaterThan(base.peakTorque.rpm);
    const ali = designEngine({ ...DEFAULT_DESIGN, block: 'aluminium' });
    expect(ali.massKg).toBeLessThan(base.massKg);
    const light = designEngine({ ...DEFAULT_DESIGN, flywheel: 'light' });
    expect(light.inertia).toBeLessThan(base.inertia);
    // A small turbo boosts earlier than a big one.
    const small = designEngine({ ...DEFAULT_DESIGN, aspiration: 'turbo', boost: 15, turboSize: 0 }).curve;
    const big = designEngine({ ...DEFAULT_DESIGN, aspiration: 'turbo', boost: 15, turboSize: 1 }).curve;
    const at = (c: [number, number][], rpm: number) => c.find(([r]) => r >= rpm)![1];
    expect(at(small, 2500)).toBeGreaterThan(at(big, 2500));
  });

  it('warns about knock, piston speed and valve float', () => {
    expect(designEngine({ ...DEFAULT_DESIGN, compression: 14, fuel: 'petrol' }).warnings.join(' ')).toMatch(/knock/);
    expect(designEngine({ ...DEFAULT_DESIGN, stroke: 100, redline: 9000 }).warnings.join(' ')).toMatch(/piston speed/);
    expect(designEngine({ ...DEFAULT_DESIGN, valvetrain: 'ohv', redline: 8500 }).warnings.join(' ')).toMatch(/floats/);
    expect(designEngine(preset('e30-m10')).warnings).toEqual([]);
  });

  it('an electric motor has flat torque then constant power', () => {
    const r = designEngine(preset('electric'));
    expect(r.curve[1]![1]).toBe(r.curve[2]![1]);
    expect(r.peakPower.kw).toBeCloseTo(200, -1);
  });

  it('keeps a design consistent when one choice changes', () => {
    expect(tidyDesign({ ...DEFAULT_DESIGN, layout: 'v', cylinders: 5 }).cylinders % 2).toBe(0);
    expect(tidyDesign({ ...DEFAULT_DESIGN, aspiration: 'turbo', boost: 0 }).boost).toBeGreaterThan(0);
    expect(tidyDesign({ ...DEFAULT_DESIGN, aspiration: 'na', boost: 12 }).boost).toBe(0);
  });

  it('becomes edits on the base engine: curve, revs, weight, and its own turbo when it has one', () => {
    const parts = {
      engine: { mainEngine: { torque: [['rpm', 'torque'], [0, 100], [6000, 150]], maxRPM: 6500, idleRPM: 800, inertia: 0.2, friction: 12 }, nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 25 }, ['e1', 0, 0, 0], ['e2', 0, 1, 0], ['e3', 1, 0, 0], ['e4', 1, 1, 0]] },
      engine_turbo: { turbocharger: { wastegateStart: 8, wastegateLimit: 10 } },
    };
    const target = designTarget(parts, 'engine');
    expect(target.hasTurbo).toBe(true);
    expect(target.gameMassKg).toBe(100);
    const d = { ...DEFAULT_DESIGN, aspiration: 'turbo' as const, boost: 18 };
    const e = editsForDesign(d, target, {}, '@massScale');
    expect(e.fields['engine/mainEngine/maxRPM']).toBe(e.result.maxRPM);
    expect(e.fields['engine_turbo/turbocharger/wastegateStart']).toBe(18);
    expect(e.fields['@massScale']).toBeCloseTo(e.result.massKg / 100, 2);
    // The game's turbo adds the boost, so the curve given is the engine without it.
    expect(Math.max(...e.torque.map(([, t]) => t))).toBeLessThan(e.result.peakTorque.nm * 0.7);
    // No turbo on the base engine: the boost is in the curve.
    const plain = editsForDesign(d, { ...target, hasTurbo: false }, {}, '@massScale');
    expect(Math.max(...plain.torque.map(([, t]) => t))).toBeCloseTo(e.result.peakTorque.nm, 0);
  });
});
