import { checkLua } from './check';
import { controllerData, scriptActions, type ScriptTemplate } from './templates';
import type { VehicleScript } from './types';

/**
 * Vehicle scripts on export (fork). Each enabled script becomes:
 *   lua/vehicle/controller/jbf_<slug>/<name>.lua        the controller
 *   a controller row on its part's jbeam, with its settings as jbeam data
 *   vehicles/<slug>/input_actions.json                   its keys, bindable in Options → Controls
 *   vehicles/<slug>/inputmaps/keyboard.json               default keys
 * plus any files and jbeam its template needs (a head unit's page, a sound).
 */

export interface ScriptFile {
  /** From the mod's root. */
  path: string;
  text?: string;
  base64?: string;
}

export interface PartScripts {
  /** Rows for the part's `controller` section (after its header). */
  rows: [string, Record<string, unknown>][];
  /** More sections on the part. */
  sections: Record<string, unknown>;
}

export interface ScriptExport {
  files: ScriptFile[];
  /** Carrier part id → what goes on it. */
  parts: Map<string, PartScripts>;
  /** Meshes that become live screens: their material shows this dynamic texture. */
  screens: { meshKey: string; texture: string; name: string }[];
  errors: string[];
  warnings: string[];
}

export const controllerFile = (slug: string, name: string) => `jbf_${slug}/${name}`;

export function exportScripts(scripts: readonly VehicleScript[], opts: { slug: string; bodyPartId: string | null; partIds: ReadonlySet<string>; template: (id: string) => ScriptTemplate | undefined }): ScriptExport {
  const out: ScriptExport = { files: [], parts: new Map(), screens: [], errors: [], warnings: [] };
  const actions: Record<string, unknown> = {};
  const bindings: { control: string; action: string }[] = [];
  const names = new Set<string>();
  const shipped = new Set<string>();
  let order = 1;
  for (const script of scripts) {
    if (!script.enabled) continue;
    if (names.has(script.name)) {
      out.errors.push(`Two scripts are called ${script.name}: rename one (Scripts tab).`);
      continue;
    }
    names.add(script.name);
    const template = script.templateId ? opts.template(script.templateId) : undefined;
    if (script.templateId && !template) {
      out.errors.push(`${script.label} is made from a template this copy of JBeam Forge doesn't have (${script.templateId}).`);
      continue;
    }
    const code = script.code ?? template?.lua ?? '';
    const check = checkLua(code, { controller: true });
    if (!check.ok) {
      const first = check.diagnostics.find((d) => d.severity === 'error')!;
      out.errors.push(`${script.label} (${script.name}.lua) line ${first.line}: ${first.message}`);
      continue;
    }
    const partId = script.partId && opts.partIds.has(script.partId) ? script.partId : opts.bodyPartId;
    if (!partId) {
      out.errors.push(`${script.label} needs a part to ride on: give the car a body first.`);
      continue;
    }
    if (script.partId && script.partId !== partId) out.warnings.push(`${script.label}: its part is gone, so it rides on the body.`);
    const ctx = { slug: opts.slug, name: script.name, params: script.params };
    out.files.push({ path: `lua/vehicle/controller/${controllerFile(opts.slug, script.name)}.lua`, text: code.endsWith('\n') ? code : `${code}\n` });
    const part = out.parts.get(partId) ?? { rows: [], sections: {} };
    out.parts.set(partId, part);
    part.rows.push([controllerFile(opts.slug, script.name), controllerData(template ?? null, script, opts.slug)]);
    const extra = template?.jbeam?.(ctx);
    if (extra) {
      part.rows.push(...(extra.controllers ?? []));
      Object.assign(part.sections, extra.sections ?? {});
    }
    for (const f of template?.files?.(ctx) ?? []) {
      const path = `vehicles/${opts.slug}/${f.path}`;
      if (shipped.has(path)) continue;
      shipped.add(path);
      out.files.push({ path, ...(f.base64 !== undefined ? { base64: f.base64 } : { text: f.text ?? '' }) });
    }
    if (template?.screen) {
      const mesh = script.params[template.screen.param];
      if (typeof mesh === 'string' && mesh) out.screens.push({ meshKey: mesh, texture: template.screen.texture(ctx), name: `${opts.slug}_${script.name}_screen` });
      else out.warnings.push(`${script.label}: pick the screen mesh, or there's nowhere to show it.`);
    }
    for (const a of scriptActions(template ?? null, script)) {
      const id = `jbf_${opts.slug}_${script.name}_${a.id}`;
      const desc = template?.actions.find((x) => x.id === a.id)?.desc ?? a.label;
      actions[id] = { cat: 'vehicle_specific', order: order++, ctx: 'vlua', onDown: `controller.getControllerSafe("${script.name}").${a.call}`, title: a.label, desc };
      if (a.key.trim()) bindings.push({ control: a.key.trim(), action: id });
    }
  }
  if (Object.keys(actions).length) {
    out.files.push({ path: `vehicles/${opts.slug}/input_actions.json`, text: `${JSON.stringify(actions, null, 2)}\n` });
    if (bindings.length) out.files.push({ path: `vehicles/${opts.slug}/inputmaps/keyboard.json`, text: `${JSON.stringify({ bindings }, null, 2)}\n` });
    const seen = new Map<string, string>();
    for (const b of bindings) {
      const other = seen.get(b.control);
      if (other) out.warnings.push(`Two script keys are both ${b.control} (${other} and ${b.action}).`);
      seen.set(b.control, b.action);
    }
  }
  return out;
}
