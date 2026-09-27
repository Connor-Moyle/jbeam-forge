import type { Draft } from 'immer';
import { defaultLayer, defaultMaterial, type MaterialDef, type MaterialLayer, type TextureSlot } from '@shared/materials/schema';
import { projectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { create } from 'zustand';

/** Undoable material edits. Each call is one history entry. */

/** Drag-and-drop type for a material dragged from the Materials panel. */
export const MIME_MATERIAL = 'application/x-jbf-material';

/** Which material the Materials panel is editing, and which layer. */
export const useMaterialUi = create<{ selected: string | null; layer: number; select: (id: string | null) => void; setLayer: (i: number) => void }>()((set) => ({
  selected: null,
  layer: 0,
  select: (selected) => set({ selected, layer: 0 }),
  setLayer: (layer) => set({ layer }),
}));

function edit(id: string, label: string, apply: (m: Draft<MaterialDef>) => void, coalesce?: string): void {
  projectStore.getState().execute({
    label,
    coalesce,
    apply: (d) => {
      const m = d.materials.find((x) => x.id === id);
      if (m) apply(m);
    },
  });
}

export function updateMaterial(id: string, patch: Partial<Omit<MaterialDef, 'id' | 'layers'>>, label = 'Edit material'): void {
  edit(id, label, (m) => void Object.assign(m, patch), `mat:${id}:${Object.keys(patch).join(',')}`);
}

export function updateLayer(id: string, layer: number, patch: Partial<MaterialLayer>, label = 'Edit material'): void {
  edit(
    id,
    label,
    (m) => {
      const l = m.layers[layer];
      if (l) Object.assign(l, patch);
    },
    `mat:${id}:${layer}:${Object.keys(patch).join(',')}`,
  );
}

export function setTexture(id: string, layer: number, slot: TextureSlot, path: string | null): void {
  edit(id, path ? `Set ${slot}` : `Clear ${slot}`, (m) => {
    const l = m.layers[layer];
    if (!l) return;
    if (path) l.maps[slot] = path;
    else delete l.maps[slot];
  });
}

export async function pickTexture(id: string, layer: number, slot: TextureSlot): Promise<void> {
  const path = await call('materials:pickTexture');
  if (path) setTexture(id, layer, slot, path);
}

export function addLayer(id: string): void {
  edit(id, 'Add material layer', (m) => {
    if (m.layers.length < 4) m.layers.push(defaultLayer());
  });
}

export function removeLayer(id: string, layer: number): void {
  edit(id, 'Remove material layer', (m) => {
    if (m.layers.length > 1) m.layers.splice(layer, 1);
  });
  useMaterialUi.getState().setLayer(0);
}

function uniqueName(base: string): string {
  const taken = new Set((projectStore.getState().doc?.materials ?? []).map((m) => m.name.toLowerCase()));
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}_${i}`;
  return name;
}

export function createMaterial(from?: Partial<MaterialDef>, name = 'material'): string {
  const id = `mat_${crypto.randomUUID().slice(0, 8)}`;
  const def = defaultMaterial(id, name, { ...from, id, origin: null, name: uniqueName(from?.name ?? name) });
  projectStore.getState().execute({ label: `New material ${def.name}`, apply: (d) => void d.materials.push(def) });
  useMaterialUi.getState().select(id);
  return id;
}

export function duplicateMaterial(id: string): string | null {
  const src = projectStore.getState().doc?.materials.find((m) => m.id === id);
  if (!src) return null;
  return createMaterial(structuredClone(src), `${src.name}_copy`);
}

export function renameMaterial(id: string, name: string): string | null {
  const clean = name.trim().replace(/[^A-Za-z0-9_.-]+/g, '_');
  if (!clean) return 'A material needs a name.';
  const taken = (projectStore.getState().doc?.materials ?? []).some((m) => m.id !== id && m.name.toLowerCase() === clean.toLowerCase());
  if (taken) return `There's already a material called ${clean}.`;
  updateMaterial(id, { name: clean }, `Rename material to ${clean}`);
  return null;
}

/** Meshes (by key) using a material, in any slot. */
export function meshesUsing(doc: { materialSlots: Readonly<Record<string, readonly string[]>> }, id: string): string[] {
  return Object.entries(doc.materialSlots)
    .filter(([, ids]) => ids.includes(id))
    .map(([k]) => k);
}

/** Put a material on meshes: every slot of each mesh (single-material meshes are the norm in car models). */
export function assignMaterial(id: string, meshKeys: readonly string[]): void {
  if (!meshKeys.length) return;
  projectStore.getState().execute({
    label: `Apply material to ${meshKeys.length} mesh${meshKeys.length === 1 ? '' : 'es'}`,
    apply: (d) => {
      for (const key of meshKeys) {
        const slots = d.materialSlots[key] ?? d.materialSlots[key.slice(0, key.indexOf('/'))] ?? [id];
        d.materialSlots[key] = slots.map(() => id);
      }
    },
  });
}

/** Delete a material; meshes using it go to `replacement` (or are left without, keeping their imported look). */
export function deleteMaterial(id: string, replacement: string | null): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const used = meshesUsing(doc, id).length;
  projectStore.getState().execute({
    label: 'Delete material',
    apply: (d) => {
      d.materials = d.materials.filter((m) => m.id !== id);
      for (const [key, ids] of Object.entries(d.materialSlots)) {
        if (!ids.includes(id)) continue;
        if (replacement) d.materialSlots[key] = ids.map((x) => (x === id ? replacement : x));
        else delete d.materialSlots[key];
      }
    },
  });
  useMaterialUi.getState().select(replacement);
  if (used) useUiStore.getState().pushStatus(`Deleted; ${used} mesh${used === 1 ? '' : 'es'} ${replacement ? 'moved to the replacement' : 'went back to their imported look'}`);
}
