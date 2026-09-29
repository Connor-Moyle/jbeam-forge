import { describe, expect, it } from 'vitest';
import { runSandbox } from '../../src/shared/lua/sandbox';
import { BUILT_IN_TEMPLATES } from '../../src/shared/lua/library';
import { controllerData, defaultParams } from '../../src/shared/lua/templates';

const tpl = (id: string) => BUILT_IN_TEMPLATES.find((t) => t.id === id)!;
const run = (id: string) => {
  const t = tpl(id);
  return runSandbox({ code: t.lua, jbeamData: controllerData(t, { name: t.name0, params: defaultParams(t) }, 'car'), scenario: { ...t.test, presses: t.test.presses.map((p) => ({ at: p.at, call: t.actions.find((a) => a.id === p.action)!.call })) } });
};
const at = (r: ReturnType<typeof runSandbox>, name: string, t: number) => r.series[name]![r.times.findIndex((x) => x >= t)]!;

describe('script test runner', () => {
  it('runs every built-in template through its scenario without errors', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const r = run(t.id);
      expect(r.error, t.id).toBeNull();
      expect(r.ok).toBe(true);
      expect(Object.keys(r.series).length, `${t.id} writes electrics`).toBeGreaterThan(0);
    }
  }, 60_000);

  it('wipers sweep in their modes and park when switched off', () => {
    const r = run('wipers');
    expect(r.hooks).toEqual(expect.arrayContaining(['init', 'updateGFX']));
    const pos = r.series.jbf_wipers!;
    expect(Math.max(...pos)).toBeGreaterThan(0.95);
    expect(at(r, 'jbf_wipers_mode', 5)).toBe(2);
    expect(pos[pos.length - 1]).toBeLessThan(0.02);
    expect(r.log.filter((l) => l.kind === 'message').map((l) => l.msg)).toEqual(['Wipers: intermittent', 'Wipers: low', 'Wipers: high', 'Wipers: off']);
  });

  it('windows go down with one touch, and frameless ones drop while the door is open', () => {
    expect(at(run('windows'), 'jbf_windows', 1.5)).toBeGreaterThan(0.2);
    const t = tpl('windows');
    const r = runSandbox({
      code: t.lua,
      jbeamData: { ...controllerData(t, { name: 'windows', params: defaultParams(t) }), frameless: true },
      scenario: { seconds: 4, tracks: [{ name: 'doorFL_coupler_notAttached', points: [[0, 0], [1, 0], [1.01, 1], [2, 1], [2.01, 0], [4, 0]] }], presses: [] },
    });
    expect(at(r, 'jbf_windows', 0.5)).toBe(0);
    expect(at(r, 'jbf_windows', 1.5)).toBeCloseTo(0.04);
    expect(at(r, 'jbf_windows', 2.2)).toBeCloseTo(0.04);
    expect(at(r, 'jbf_windows', 3)).toBe(0);
  });

  it('convertible refuses to move at speed', () => {
    const r = run('convertible');
    expect(at(r, 'jbf_roof_open', 12)).toBe(0);
    expect(at(r, 'jbf_roof_open', 14.8)).toBe(1);
    expect(r.log.some((l) => l.kind === 'message' && /Slow down/.test(l.msg))).toBe(true);
  });

  it('launch control holds the rev limiter then gives it back', () => {
    const r = run('launch_control');
    expect(at(r, 'jbf_launch', 4)).toBe(2);
    expect(at(r, 'jbf_launch', 8)).toBe(0);
  });

  it('wind noise plays its sound louder with the window down at speed', () => {
    const r = run('wind_noise');
    const s = Object.values(r.sounds)[0]!;
    expect(s.file).toBe('vehicles/car/sounds/jbf_wind_loop.wav');
    expect(Math.max(...s.volume)).toBeGreaterThan(0.3);
    expect(s.volume[s.volume.length - 1]).toBeLessThan(0.2);
  });

  it('reports errors with their line and time, and stops endless loops', () => {
    const bad = runSandbox({ code: 'local M = {}\nfunction M.updateGFX(dt)\n  local x = nil\n  if electrics.values.wheelspeed > 5 then x.y = 1 end\nend\nreturn M', jbeamData: {}, scenario: { seconds: 3, tracks: [{ name: 'wheelspeed', points: [[0, 0], [3, 10]] }], presses: [] } });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatchObject({ line: 4 });
    expect(bad.error!.at).toBeGreaterThan(1.4);
    const loop = runSandbox({ code: 'local M = {}\nfunction M.init() while true do end end\nreturn M', jbeamData: {}, scenario: { seconds: 1, tracks: [], presses: [] }, budget: 200_000 });
    expect(loop.error?.message).toMatch(/endless loop/);
    const syntax = runSandbox({ code: 'local M = {\nreturn M', jbeamData: {}, scenario: { seconds: 1, tracks: [], presses: [] } });
    expect(syntax.error?.line).toBe(2);
    expect(runSandbox({ code: 'return 5', jbeamData: {}, scenario: { seconds: 1, tracks: [], presses: [] } }).error?.message).toMatch(/return M/);
  });

  it('supports print, dump, vec3, smoothing and LuaJIT names', () => {
    const r = runSandbox({
      code: `local M = {}
local s = newTemporalSmoothing(2, 2)
function M.init(d) print("hello", d.name) dump({ a = 1 }) end
function M.updateGFX(dt)
  local v = vec3(3, 4, 0)
  electrics.values.len = v:length()
  electrics.values.smooth = s:get(1, dt)
  electrics.values.bits = bit.band(6, 3)
  electrics.values.u = select("#", unpack({ 1, 2, 3 }))
end
return M`,
      jbeamData: { name: 'x' },
      scenario: { seconds: 1, tracks: [], presses: [] },
    });
    expect(r.error).toBeNull();
    expect(r.log.map((l) => l.msg)).toEqual(expect.arrayContaining(['hello  x', '{ a = 1 }']));
    expect(r.series.len![1]).toBe(5);
    expect(r.series.bits![1]).toBe(2);
    expect(r.series.u![1]).toBe(3);
    expect(r.series.smooth![r.times.length - 1]).toBeCloseTo(1, 1);
  });
});
