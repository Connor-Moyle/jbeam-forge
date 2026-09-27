import { create } from 'zustand';
import type { VehicleConfig } from '@shared/project/schema';
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
  const config: VehicleConfig = { id, name, description: from?.description ?? '', type: from?.type ?? 'Custom', parts: { ...(from?.parts ?? {}) }, vars: { ...(from?.vars ?? {}) } };
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
  projectStore.getState().execute({ label: 'Delete configuration', apply: (d) => void (d.configs = d.configs.filter((c) => c.id !== id)) });
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
