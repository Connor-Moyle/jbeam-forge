import { create } from 'zustand';
import type { Project, VehicleConfig } from '@shared/project/schema';
import { configFileName, configFromPc, resolveConfig } from '@shared/export/configs';
import { call } from '@renderer/diagnostics/ipc';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { useSetData } from '@renderer/suspension/commands';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';

/**
 * Vehicle configurations (Phase 13): named sets of part choices and in-game
 * values, exported as the game's .pc files next to the default.
 */

/** The configuration the panel is on (null = the default) and whether the viewport previews it. */
export const useConfigUi = create<{ selected: string | null; preview: boolean; select: (id: string | null) => void; setPreview: (on: boolean) => void }>()((set) => ({
  selected: null,
  preview: false,
  select: (selected) => set({ selected }),
  setPreview: (preview) => set({ preview }),
}));

export function addConfig(from: VehicleConfig | null): string {
  const doc = projectStore.getState().doc;
  const id = `cfg_${crypto.randomUUID().slice(0, 8)}`;
  const taken = new Set((doc?.configs ?? []).map((c) => c.name.toLowerCase()));
  let name = from ? `${from.name} copy` : 'New configuration';
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${from ? `${from.name} copy` : 'New configuration'} ${i}`;
  const config: VehicleConfig = { id, name, description: from?.description ?? '', type: from?.type ?? 'Custom', parts: { ...(from?.parts ?? {}) }, vars: { ...(from?.vars ?? {}) }, paints: [...(from?.paints ?? [null, null, null])] as VehicleConfig['paints'] };
  projectStore.getState().execute({ label: 'Add configuration', apply: (d) => void d.configs.push(config) });
  useConfigUi.getState().select(id);
  return id;
}

export function updateConfig(id: string, patch: Partial<Pick<VehicleConfig, 'name' | 'description' | 'type'>>): void {
  projectStore.getState().execute({
    label: 'Edit configuration',
    coalesce: `cfg:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const c = d.configs.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
  });
}

export function deleteConfig(id: string): void {
  projectStore.getState().execute({
    label: 'Delete configuration',
    apply: (d) => {
      d.configs = d.configs.filter((c) => c.id !== id);
      if (d.defaultConfigId === id) d.defaultConfigId = null;
    },
  });
  if (useConfigUi.getState().selected === id) useConfigUi.getState().select(null);
}

/** What a slot takes in a configuration; null goes back to the default part. */
export function setConfigPart(id: string, slot: string, part: string | null): void {
  projectStore.getState().execute({
    label: 'Change configuration part',
    apply: (d) => {
      const c = d.configs.find((x) => x.id === id);
      if (!c) return;
      if (part === null) delete c.parts[slot];
      else c.parts[slot] = part;
    },
  });
}

export function setConfigVar(id: string, name: string, value: number | null): void {
  projectStore.getState().execute({
    label: 'Change configuration value',
    coalesce: `cfgvar:${id}:${name}`,
    apply: (d) => {
      const c = d.configs.find((x) => x.id === id);
      if (!c) return;
      if (value === null) delete c.vars[name];
      else c.vars[name] = value;
    },
  });
}

/** The paint in one of a configuration's three slots (null: the factory default). */
export function setConfigPaint(id: string, slot: 0 | 1 | 2, paintId: string | null): void {
  projectStore.getState().execute({
    label: 'Change configuration paint',
    apply: (d) => {
      const c = d.configs.find((x) => x.id === id);
      if (c) c.paints[slot] = paintId;
    },
  });
}

/** Meshes hidden for the configuration preview (so turning it off only shows what it hid). */
let previewHidden: string[] = [];

/** Show only the parts on the car in this configuration (null: show everything again). */
export function applyConfigPreview(included: ReadonlySet<string> | null): void {
  const scene = useSceneStore.getState();
  if (previewHidden.length) scene.setHidden(previewHidden, false);
  previewHidden = [];
  const doc = projectStore.getState().doc;
  if (!included || !doc) return;
  previewHidden = Object.keys(doc.assignments).filter((k) => !included.has(doc.assignments[k]!) && !scene.hidden[k]);
  if (previewHidden.length) scene.setHidden(previewHidden, true);
}

/** Move a configuration up or down the list (the order the game lists them in is by name, but ours is the user's). */
export function moveConfig(id: string, by: -1 | 1): void {
  projectStore.getState().execute({
    label: 'Reorder configurations',
    apply: (d) => {
      const i = d.configs.findIndex((c) => c.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= d.configs.length) return;
      const [c] = d.configs.splice(i, 1);
      d.configs.splice(j, 0, c!);
    },
  });
}

/** The configuration the game spawns by default (null: the base one). */
export function setDefaultConfig(id: string | null): void {
  projectStore.getState().execute({ label: 'Set default configuration', apply: (d) => void (d.defaultConfigId = id) });
}

/** A configuration's vehicle-selector details (undefined clears one). */
export function updateConfigInfo(id: string, patch: Partial<NonNullable<VehicleConfig['info']>>): void {
  projectStore.getState().execute({
    label: 'Edit configuration details',
    coalesce: `cfginfo:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const c = d.configs.find((x) => x.id === id);
      if (!c) return;
      const info = { ...(c.info ?? {}), ...patch };
      for (const k of Object.keys(info) as (keyof typeof info)[]) if (info[k] === undefined) delete info[k];
      c.info = Object.keys(info).length ? info : undefined;
      if (!c.info) delete c.info;
    },
  });
}

/** The model's vehicle-selector details: body style, country, years. */
export function updateModelInfo(patch: Partial<Pick<Project['meta'], 'bodyStyle' | 'country' | 'years'>>): void {
  projectStore.getState().execute({
    label: 'Edit vehicle details',
    coalesce: `modelinfo:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      for (const [k, v] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
        if (v === undefined || v === '') delete d.meta[k];
        else (d.meta as Record<string, unknown>)[k] = v;
      }
    },
  });
}

/** Bring in .pc files as configurations; returns how many came in and what was skipped. */
export async function importPcFiles(): Promise<{ added: number; skipped: string[] } | null> {
  const files = await call('file:openText', { kind: 'pc', multiple: true });
  const doc = projectStore.getState().doc;
  if (!files.length || !doc) return null;
  const tax = currentTaxonomy();
  const sets = useSetData.getState().data;
  const made: VehicleConfig[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const { config, skipped: s } = configFromPc(doc, tax, f.text, f.name, sets);
    const taken = new Set([...doc.configs, ...made].map((c) => c.name.toLowerCase()));
    let name = config.name;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${config.name} ${i}`;
    made.push({ ...config, name, id: `cfg_${crypto.randomUUID().slice(0, 8)}` });
    skipped.push(...s.map((x) => `${f.name}: ${x}`));
  }
  projectStore.getState().execute({ label: made.length > 1 ? `Import ${made.length} configurations` : 'Import configuration', apply: (d) => void d.configs.push(...made) });
  useConfigUi.getState().select(made[made.length - 1]!.id);
  return { added: made.length, skipped };
}

/** Save one configuration as a .pc where the user picks. */
export async function exportPcFile(config: VehicleConfig | null): Promise<string | null> {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const pc = resolveConfig(doc, currentTaxonomy(), config, useSetData.getState().data);
  return call('file:saveText', { kind: 'pc', suggestedName: `${configFileName(config)}.pc`, text: `${JSON.stringify(pc, null, 2)}\n` });
}
