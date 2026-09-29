import { create } from 'zustand';
import { couplerFor } from '@shared/hinges/schema';
import { syncScriptProps, type MeshBounds } from '@shared/lua/animate';
import { BLANK_SCRIPT, libraryToScript, scriptToLibrary, uniqueScriptName, parseLibraryScript } from '@shared/lua/library/share';
import { defaultParams, outputName, type ScriptTemplate } from '@shared/lua/templates';
import type { LibraryScript, ScriptParamValue, VehicleScript } from '@shared/lua/types';
import type { Project } from '@shared/project/schema';
import type { SandboxResult } from '@shared/lua/sandbox';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { templateById } from './registry';

/**
 * The Scripts tab's commands (fork): add scripts from templates, the
 * library or by hand; change settings (keeping the animated parts the
 * settings make in step); edit code; save and share.
 */

interface ScriptUiState {
  selected: string | null;
  view: 'list' | 'gallery' | 'library';
  mode: 'easy' | 'code';
  result: SandboxResult | null;
  running: boolean;
  /** Playback time in the viewport (null: not playing). */
  playT: number | null;
}

export const useScriptUi = create<ScriptUiState & { set: (patch: Partial<ScriptUiState>) => void }>()((set) => ({ selected: null, view: 'list', mode: 'easy', result: null, running: false, playT: null, set: (patch) => set(patch) }));

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

function meshBounds(key: string): MeshBounds | null {
  for (const src of Object.values(useSceneStore.getState().sources)) {
    const m = src.meshes.find((x) => x.key === key);
    if (!m) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    return b ? { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] } : null;
  }
  return null;
}

/** Electrics that are 1 while each door is open (from the car's hinged doors). */
export function doorSignals(doc: Pick<Project, 'hinges'> | null): string[] {
  return (doc?.hinges ?? []).filter((h) => /^door/i.test(h.action)).map((h) => `${couplerFor(h.action)}_notAttached`);
}

/** Door settings filled in from the car's own doors. */
function fitToCar(t: ScriptTemplate, params: Record<string, ScriptParamValue>, doc: Project): Record<string, ScriptParamValue> {
  const doors = doorSignals(doc);
  if (!doors.length) return params;
  const out = { ...params };
  if (t.params.some((p) => p.id === 'doors')) out.doors = doors.join(',');
  if (t.params.some((p) => p.id === 'door')) out.door = doors.find((d) => /FL/i.test(d)) ?? doors[0]!;
  return out;
}

function takenNames(): Set<string> {
  return new Set((projectStore.getState().doc?.scripts ?? []).map((s) => s.name));
}

function add(script: VehicleScript, label: string): void {
  projectStore.getState().execute({ label, apply: (d) => void (d.scripts = [...(d.scripts ?? []), script]) });
  useScriptUi.getState().set({ selected: script.id, view: 'list', mode: script.templateId ? 'easy' : 'code', result: null, playT: null });
}

export function addFromTemplate(templateId: string): void {
  const t = templateById(templateId);
  const doc = projectStore.getState().doc;
  if (!t || !doc) return;
  add({ id: newId('script'), name: uniqueScriptName(t.name0, takenNames()), label: t.name, templateId: t.id, enabled: true, params: fitToCar(t, defaultParams(t), doc), code: null, partId: null }, `Add ${t.name.toLowerCase()}`);
}

export function addBlankScript(): void {
  add({ id: newId('script'), name: uniqueScriptName('myscript', takenNames()), label: 'My script', templateId: null, enabled: true, params: {}, code: BLANK_SCRIPT, partId: null, actions: [{ id: 'toggle', label: 'My script: toggle', key: '', call: 'toggle()' }] }, 'Add script');
}

export function addFromLibrary(entry: LibraryScript): void {
  const t = entry.templateId ? templateById(entry.templateId) : undefined;
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const s = libraryToScript(entry, t, takenNames(), newId('script'));
  add(t ? { ...s, params: fitToCar(t, s.params, doc) } : s, `Add ${entry.label}`);
}

export function updateScript(id: string, patch: Partial<Omit<VehicleScript, 'id'>>, label = 'Change script'): void {
  projectStore.getState().execute({
    label,
    coalesce: `script:${id}:${Object.keys(patch).join(',')}`,
    apply: (d) => {
      const s = d.scripts?.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    },
  });
}

/** One setting; mesh settings also make or update the animated parts. */
export function setScriptParam(id: string, key: string, value: ScriptParamValue): void {
  const doc = projectStore.getState().doc;
  const script = doc?.scripts?.find((s) => s.id === id);
  if (!doc || !script) return;
  const t = script.templateId ? templateById(script.templateId) : undefined;
  const params = { ...script.params, [key]: value };
  const props = t ? syncScriptProps(t, { name: script.name, params }, doc.props ?? [], meshBounds, () => newId('prop')) : null;
  projectStore.getState().execute({
    label: 'Change script setting',
    coalesce: Array.isArray(value) ? undefined : `script:${id}:param:${key}`,
    apply: (d) => {
      const s = d.scripts?.find((x) => x.id === id);
      if (!s) return;
      s.params[key] = value;
      if (props) d.props = props;
    },
  });
}

/** Rename the controller (its electrics follow, and so do the props they drive). */
export function renameScript(id: string, name: string): boolean {
  const doc = projectStore.getState().doc;
  const script = doc?.scripts?.find((s) => s.id === id);
  if (!doc || !script || script.name === name) return false;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || doc.scripts!.some((s) => s.id !== id && s.name === name)) return false;
  const t = script.templateId ? templateById(script.templateId) : undefined;
  const renames = new Map((t?.outputs ?? []).map((o) => [outputName(script.name, o.suffix), outputName(name, o.suffix)]));
  projectStore.getState().execute({
    label: 'Rename script',
    apply: (d) => {
      const s = d.scripts?.find((x) => x.id === id);
      if (!s) return;
      s.name = name;
      for (const p of d.props ?? []) {
        const to = renames.get(p.func);
        if (to) p.func = to;
      }
    },
  });
  return true;
}

export function removeScript(id: string): void {
  const doc = projectStore.getState().doc;
  const script = doc?.scripts?.find((s) => s.id === id);
  if (!script) return;
  const t = script.templateId ? templateById(script.templateId) : undefined;
  const outputs = new Set((t?.outputs ?? []).map((o) => outputName(script.name, o.suffix)));
  projectStore.getState().execute({
    label: `Remove ${script.label}`,
    apply: (d) => {
      d.scripts = (d.scripts ?? []).filter((s) => s.id !== id);
      // The animations it drove go with it.
      d.props = (d.props ?? []).filter((p) => !outputs.has(p.func));
    },
  });
  if (useScriptUi.getState().selected === id) useScriptUi.getState().set({ selected: null, result: null, playT: null });
}

/** Edit the code: start from the template's own. */
export function customiseCode(id: string): void {
  const s = projectStore.getState().doc?.scripts?.find((x) => x.id === id);
  const t = s?.templateId ? templateById(s.templateId) : undefined;
  if (!s || s.code !== null || !t) return;
  updateScript(id, { code: t.lua }, 'Customise script code');
}

/** Back to the template's code (the edits are dropped). */
export function resetCode(id: string): void {
  updateScript(id, { code: null }, 'Use the template’s code');
}

export async function saveToLibrary(id: string, description = ''): Promise<void> {
  const s = projectStore.getState().doc?.scripts?.find((x) => x.id === id);
  if (!s) return;
  const t = s.templateId ? templateById(s.templateId) : undefined;
  const path = await call('scripts:save', { entry: scriptToLibrary(s, t, description, projectStore.getState().doc?.meta.author || undefined) });
  useUiStore.getState().pushStatus(`Saved ${s.label} to your scripts library.`, 'success');
  void path;
  void useScriptLibrary.getState().load();
}

export async function exportLua(id: string): Promise<void> {
  const s = projectStore.getState().doc?.scripts?.find((x) => x.id === id);
  if (!s) return;
  const code = s.code ?? (s.templateId ? templateById(s.templateId)?.lua : '') ?? '';
  const path = await call('file:saveText', { kind: 'lua', suggestedName: `${s.name}.lua`, text: code });
  if (path) useUiStore.getState().pushStatus(`Saved ${path}`, 'success');
}

export async function shareScript(id: string): Promise<void> {
  const s = projectStore.getState().doc?.scripts?.find((x) => x.id === id);
  if (!s) return;
  const t = s.templateId ? templateById(s.templateId) : undefined;
  const path = await call('file:saveText', { kind: 'jbscript', suggestedName: `${s.name}.jbscript`, text: `${JSON.stringify(scriptToLibrary(s, t, ''), null, 2)}\n` });
  if (path) useUiStore.getState().pushStatus(`Saved ${path}: anyone can add it with Scripts → Import.`, 'success');
}

/** Bring in .lua (as hand-written scripts) or .jbscript files. */
export async function importScripts(kind: 'lua' | 'jbscript'): Promise<void> {
  const files = await call('file:openText', { kind, multiple: true });
  for (const f of files) {
    try {
      if (kind === 'jbscript') addFromLibrary(parseLibraryScript(f.text, f.name));
      else {
        const base = f.name.replace(/\.lua$/i, '');
        add({ id: newId('script'), name: uniqueScriptName(base, takenNames()), label: base.replace(/[_-]+/g, ' '), templateId: null, enabled: true, params: {}, code: f.text, partId: null, actions: [] }, `Import ${f.name}`);
      }
    } catch (err) {
      useUiStore.getState().pushStatus(err instanceof Error ? err.message : String(err), 'danger', 8000);
    }
  }
}

/** The user's saved scripts and downloaded ones. */
export const useScriptLibrary = create<{ scripts: { path: string; source: 'mine' | 'downloaded'; entry: LibraryScript }[]; errors: string[]; loaded: boolean; load: () => Promise<void> }>()((set) => ({
  scripts: [],
  errors: [],
  loaded: false,
  load: async () => {
    try {
      const r = await call('scripts:library');
      set({ scripts: r.scripts, errors: r.errors, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

export async function deleteFromLibrary(path: string): Promise<void> {
  await call('scripts:delete', { path });
  await useScriptLibrary.getState().load();
}
