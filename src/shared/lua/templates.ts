import type { ScriptAction, ScriptParamValue, VehicleScript } from './types';

/**
 * Script templates (fork): ready-made vehicle functions (wipers, windows,
 * mirrors, roofs, aero, sounds, a head unit…) that easy mode sets up from a
 * form. A template's Lua is a fixed controller; its settings reach it as the
 * controller's jbeam data (jbeamData.speed…), the way the game's own
 * controllers are configured, so one file serves every car and the settings
 * stay editable in the jbeam. Mesh settings are animated through the app's
 * animated parts (props) driven by the electrics values the script writes.
 */

export type TemplateCategory = 'Body' | 'Windows & roof' | 'Lights' | 'Comfort' | 'Performance' | 'Sound' | 'Display' | 'Driving aids';

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Body', 'Windows & roof', 'Lights', 'Comfort', 'Performance', 'Sound', 'Display', 'Driving aids'];

export interface ParamDef {
  id: string;
  label: string;
  hint?: string;
  kind: 'number' | 'boolean' | 'choice' | 'text' | 'meshes' | 'mesh' | 'electrics';
  default: ScriptParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /**
   * Meshes: animate each picked mesh by one of the script's outputs, as an
   * animated part (prop) the user can fine-tune in the Inspector.
   */
  animate?: {
    /** Output suffix ("" for the script's main value). */
    output: string;
    motion: 'rotate' | 'slide';
    /** Degrees (rotate) or metres (slide) at output 0 and 1. */
    from: number;
    to: number;
    /** Axis (BeamNG space) it turns about or slides along. */
    axis: [number, number, number];
    /** Where on the mesh's bounds the pivot goes. */
    pivot: 'centre' | 'top' | 'bottom' | 'front' | 'rear' | 'left' | 'right' | 'inner';
    /** Mirror the motion for meshes on the car's right side (x < 0). */
    mirror?: boolean;
    /** A number parameter that sets `to` (e.g. the sweep angle). */
    toParam?: string;
  };
  /** Shown under "More settings". */
  advanced?: boolean;
  /** Only sets the animation or the template's files, so it isn't passed to the Lua. */
  scope?: 'animation' | 'files';
}

export interface OutputDef {
  /** Suffix after the script's name ("" = the name itself). */
  suffix: string;
  label: string;
  min: number;
  max: number;
}

export interface ActionDef extends Omit<ScriptAction, 'key'> {
  /** Default key. */
  key: string;
  desc: string;
}

/** A driving scenario the test runner plays: values over time, and key presses. */
export interface TestScenario {
  seconds: number;
  /** Electrics and inputs at points in time (linear in between). */
  tracks: { name: string; points: [number, number][] }[];
  /** Actions pressed at a time. */
  presses: { at: number; action: string }[];
}

export interface ScriptTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  /** What it needs from the car, in words ("wiper arm meshes"). */
  needs?: string;
  /** Default controller name. */
  name0: string;
  params: ParamDef[];
  outputs: OutputDef[];
  actions: ActionDef[];
  /** The controller's Lua. */
  lua: string;
  /** Extra files under vehicles/<slug>/ (a head unit's page, a sound). */
  files?: (ctx: TemplateContext) => { path: string; text?: string; base64?: string }[];
  /** More settings for its jbeam data that depend on the car (paths of its files). */
  extraData?: (ctx: TemplateContext) => Record<string, ScriptParamValue>;
  /** Other controllers and jbeam sections it needs on the carrier part (a screen's gauges controller). */
  jbeam?: (ctx: TemplateContext) => { controllers?: [string, Record<string, unknown>][]; sections?: Record<string, unknown> };
  /** A mesh parameter whose mesh becomes a live screen (dynamic texture): its material is replaced on export. */
  screen?: { param: string; texture: (ctx: TemplateContext) => string };
  test: TestScenario;
}

export interface TemplateContext {
  slug: string;
  /** Controller name. */
  name: string;
  params: Record<string, ScriptParamValue>;
  /** Material names for meshes (for a screen). */
  materialOf?: (meshKey: string) => string | null;
}

/** An electrics value name for a script's output. */
export const outputName = (scriptName: string, suffix: string) => `jbf_${scriptName}${suffix ? `_${suffix}` : ''}`;

/** Settings for the controller's jbeam data: every non-mesh parameter, plus the names of its outputs. */
export function controllerData(template: ScriptTemplate | null, script: Pick<VehicleScript, 'name' | 'params'>, slug = ''): Record<string, ScriptParamValue> {
  const data: Record<string, ScriptParamValue> = { name: script.name };
  if (!template) {
    for (const [k, v] of Object.entries(script.params)) if (!Array.isArray(v)) data[k] = v;
    return data;
  }
  for (const p of template.params) {
    if (p.kind === 'meshes' || p.kind === 'mesh' || p.scope) continue;
    const v = script.params[p.id] ?? p.default;
    data[p.id] = v;
  }
  for (const o of template.outputs) data[`out${o.suffix ? `_${o.suffix}` : ''}`] = outputName(script.name, o.suffix);
  if (template.extraData) Object.assign(data, template.extraData({ slug, name: script.name, params: script.params }));
  return data;
}

/** Default settings of a template. */
export function defaultParams(t: ScriptTemplate): Record<string, ScriptParamValue> {
  return Object.fromEntries(t.params.map((p) => [p.id, Array.isArray(p.default) ? [...p.default] : p.default]));
}

/** The template's actions with the script's keys. */
export function scriptActions(template: ScriptTemplate | null, script: Pick<VehicleScript, 'actions'>): ScriptAction[] {
  if (!template) return script.actions ?? [];
  return template.actions.map((a) => ({ id: a.id, label: a.label, call: a.call, key: script.actions?.find((x) => x.id === a.id)?.key ?? a.key }));
}

/** Shared Lua helpers every template can paste in (kept small: vehicle Lua has clamp built in). */
export const LUA_HELPERS = `local function approach(current, target, rate, dt)
  if current < target then return math.min(target, current + rate * dt) end
  return math.max(target, current - rate * dt)
end`;
