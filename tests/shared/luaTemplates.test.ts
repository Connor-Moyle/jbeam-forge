import { describe, expect, it } from 'vitest';
import { checkLua } from '../../src/shared/lua/check';
import { BUILT_IN_TEMPLATES } from '../../src/shared/lua/library';
import { controllerData, defaultParams, outputName } from '../../src/shared/lua/templates';
import { exportScripts } from '../../src/shared/lua/export';
import { ScriptActionSchema, type VehicleScript } from '../../src/shared/lua/types';
import { headUnitHtml } from '../../src/shared/lua/library/display';
import { windNoiseWav, base64Of } from '../../src/shared/lua/sound';

const script = (templateId: string, over: Partial<VehicleScript> = {}): VehicleScript => {
  const t = BUILT_IN_TEMPLATES.find((x) => x.id === templateId)!;
  return { id: `s_${templateId}`, name: t.name0, label: t.name, templateId, enabled: true, params: defaultParams(t), code: null, partId: null, ...over };
};

describe('script templates', () => {
  it('have unique ids and names', () => {
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(BUILT_IN_TEMPLATES.length);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.name0)).size).toBe(BUILT_IN_TEMPLATES.length);
  });

  for (const t of BUILT_IN_TEMPLATES) {
    it(`${t.name}: clean Lua, hooks, and keys that call its own functions`, () => {
      const r = checkLua(t.lua, { controller: true });
      expect(r.diagnostics.map((d) => `${d.line}: ${d.message}`)).toEqual([]);
      expect(r.hooks).toContain('init');
      expect(r.hooks.some((h) => h === 'updateGFX' || h === 'update')).toBe(true);
      for (const a of t.actions) {
        expect(ScriptActionSchema.safeParse({ id: a.id, label: a.label, key: a.key, call: a.call }).success).toBe(true);
        const fn = a.call.slice(0, a.call.indexOf('('));
        expect(t.lua, `${a.id} calls M.${fn}`).toMatch(new RegExp(`M\\.${fn}\\s*=`));
      }
      // Every output it declares is read from its jbeam data under the name the export gives it.
      const data = controllerData(t, { name: t.name0, params: defaultParams(t) }, 'car');
      for (const o of t.outputs) expect(data[`out${o.suffix ? `_${o.suffix}` : ''}`]).toBe(outputName(t.name0, o.suffix));
      for (const p of t.params) if (p.kind !== 'meshes' && p.kind !== 'mesh' && !p.scope) expect(t.lua, `reads ${p.id}`).toContain(`jbeamData.${p.id}`);
      for (const tr of t.test.presses) expect(t.actions.some((a) => a.id === tr.action)).toBe(true);
    });
  }
});

describe('script export', () => {
  it('writes controllers, their rows on the body, keys and files', () => {
    const out = exportScripts([script('wipers'), script('wind_noise'), script('head_unit', { params: { ...defaultParams(BUILT_IN_TEMPLATES.find((t) => t.id === 'head_unit')!), screen: 'src:screen' } })], { slug: 'car', bodyPartId: 'p_body', partIds: new Set(['p_body']), template: (id) => BUILT_IN_TEMPLATES.find((t) => t.id === id) });
    expect(out.errors).toEqual([]);
    const paths = out.files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['lua/vehicle/controller/jbf_car/wipers.lua', 'lua/vehicle/controller/jbf_car/windnoise.lua', 'vehicles/car/sounds/jbf_wind_loop.wav', 'vehicles/car/ui/headunit/index.html', 'vehicles/car/input_actions.json', 'vehicles/car/inputmaps/keyboard.json']));
    const body = out.parts.get('p_body')!;
    expect(body.rows.map((r) => r[0])).toEqual(['jbf_car/wipers', 'jbf_car/windnoise', 'jbf_car/headunit', 'gauges/genericGauges']);
    expect(body.rows[0]![1]).toMatchObject({ name: 'wipers', out: 'jbf_wipers', lowSeconds: 1.4 });
    expect(body.rows[1]![1]).toMatchObject({ defaultSound: 'vehicles/car/sounds/jbf_wind_loop.wav' });
    expect(body.sections.headunit_screen).toMatchObject({ configuration: { materialName: '@car_headunit', htmlPath: 'local://local/vehicles/car/ui/headunit/index.html' } });
    expect(out.screens).toEqual([{ meshKey: 'src:screen', texture: '@car_headunit', name: 'car_headunit_screen' }]);
    const actions = JSON.parse(out.files.find((f) => f.path.endsWith('input_actions.json'))!.text!);
    expect(actions.jbf_car_wipers_cycle).toMatchObject({ ctx: 'vlua', onDown: 'controller.getControllerSafe("wipers").cycle()', cat: 'vehicle_specific' });
    expect(JSON.parse(out.files.find((f) => f.path.endsWith('keyboard.json'))!.text!).bindings).toContainEqual({ control: 'lctrl w', action: 'jbf_car_wipers_cycle' });
  });

  it('refuses broken Lua, duplicate names and missing templates', () => {
    const tpl = (id: string) => BUILT_IN_TEMPLATES.find((t) => t.id === id);
    const opts = { slug: 'car', bodyPartId: 'p_body', partIds: new Set(['p_body']), template: tpl };
    expect(exportScripts([script('wipers', { code: 'local M = {}\nM.init = function( end\nreturn M' })], opts).errors[0]).toMatch(/wipers\.lua\) line 2: Syntax/);
    expect(exportScripts([script('wipers'), script('wipers', { id: 'x' })], opts).errors[0]).toMatch(/Two scripts are called wipers/);
    expect(exportScripts([script('wipers', { templateId: 'gone' })], opts).errors[0]).toMatch(/doesn't have/);
    expect(exportScripts([script('wipers', { enabled: false })], opts).files).toEqual([]);
    expect(exportScripts([script('head_unit')], opts).warnings[0]).toMatch(/pick the screen mesh/);
    // Its part is gone: it rides on the body.
    const moved = exportScripts([script('mirrors', { partId: 'p_gone' })], opts);
    expect(moved.parts.has('p_body')).toBe(true);
    expect(moved.warnings[0]).toMatch(/rides on the body/);
  });

  it('makes a head unit page with its settings and a looping wind sound', () => {
    const html = headUnitHtml({ name: 'headunit', params: { theme: 'carplay', accent: '#ff0000', units: 'mph', brand: '<b>x</b>', tracks: 'A - B' } });
    expect(html).toContain('"theme":"carplay"');
    expect(html).toContain('"accent":"#ff0000"');
    expect(html).toContain('\\u003cb>x\\u003c/b>');
    expect(html).toContain('window.updateData');
    const wav = windNoiseWav(1, 8000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(44 + 8000 * 2);
    expect(base64Of(new Uint8Array([1, 2, 3, 4]))).toBe('AQIDBA==');
  });
});

describe('script templates in the game', () => {
  for (const t of BUILT_IN_TEMPLATES) {
    it(`${t.name}: survives a vehicle reset without its jbeam data (Ctrl+R), keeping its settings`, async () => {
      const { runSandbox } = await import('../../src/shared/lua/sandbox');
      const data = controllerData(t, { name: t.name0, params: defaultParams(t) }, 'car');
      const r = runSandbox({ code: t.lua, jbeamData: data, scenario: { seconds: 3, tracks: t.test.tracks, presses: [...(/M\.reset\s*=/.test(t.lua) ? [{ at: 1, call: 'reset()' }] : []), ...t.test.presses.filter((p) => p.at < 3).map((p) => ({ at: p.at + 1.2, call: t.actions.find((a) => a.id === p.action)!.call }))] } });
      expect(r.error?.message ?? null).toBeNull();
      expect(r.ok).toBe(true);
    });
  }
});
