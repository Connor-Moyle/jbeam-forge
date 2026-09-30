import { create } from 'zustand';
import { z } from 'zod';
import { applyPatch, EXTENSION_BOOTSTRAP, ExtensionModelSchema, extensionTemplate, METHOD_PERMISSION, modelToObj, PatchOpSchema, type ExtensionInfo, type ExtensionMethod, type ExtensionModel, type FromExtension, type ToExtension } from '@shared/extensions/api';
import { SLUG_PATTERN, type SourceFormat } from '@shared/project/schema';
import { slugify } from '@shared/text';
import { newProject } from '@renderer/project/actions';
import { confirmImport } from '@renderer/import/importFlow';
import { defaultSettings, stageImport } from '@renderer/import/pipeline';
import { useSceneStore } from '@renderer/app/stores/scene';
import { ProjectSchema } from '@shared/project/schema';
import { projectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { useTemplates } from '@renderer/scripts/registry';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { parseJbeam } from '@shared/jbeam/parse';
import { autoClassifyNow } from '@renderer/parts/commands';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { createPart } from '@shared/parts/ops';

/**
 * Runs the user's extensions (fork), each in a worker of its own made from
 * its code: no DOM, no Node, no network (the app's security policy), so all
 * it can do is what `forge` offers. Project edits are JSON Patch operations,
 * checked against the project format before they're applied as one undoable
 * step.
 */

const logger = rlog('extensions');

export interface RunningExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  folder: string;
  enabled: boolean;
  running: boolean;
  commands: { id: string; label: string }[];
  templates: string[];
  /** What more it may do (extension.json permissions). */
  permissions: ('files' | 'import')[];
  error: string | null;
}

export const useExtensions = create<{ list: RunningExtension[]; loading: boolean }>()(() => ({ list: [], loading: false }));

const workers = new Map<string, { worker: Worker; url: string }>();
/** Bumped by every stop: a start whose list arrives after a newer stop or start gives up. */
let generation = 0;
let docTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeDoc: (() => void) | null = null;

function patch(id: string, fn: (e: RunningExtension) => Partial<RunningExtension>): void {
  useExtensions.setState((s) => ({ list: s.list.map((e) => (e.id === id ? { ...e, ...fn(e) } : e)) }));
}

function send(id: string, msg: ToExtension): void {
  workers.get(id)?.worker.postMessage(msg);
}

function handle(ext: RunningExtension, msg: FromExtension): void {
  switch (msg.type) {
    case 'command':
      patch(ext.id, (e) => ({ commands: [...e.commands.filter((c) => c.id !== msg.id), { id: String(msg.id).slice(0, 60), label: String(msg.label).slice(0, 120) }] }));
      return;
    case 'template':
      try {
        const t = extensionTemplate(ext.id, msg.template);
        useTemplates.getState().register(t);
        patch(ext.id, (e) => ({ templates: [...new Set([...e.templates, t.id])] }));
      } catch (err) {
        patch(ext.id, () => ({ error: `Template not added: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}` }));
      }
      return;
    case 'notify':
      useUiStore.getState().pushStatus(`${ext.name}: ${String(msg.message).slice(0, 300)}`, msg.tone ?? 'info', 6000);
      return;
    case 'log':
      logger.info(`[${ext.id}] ${String(msg.message).slice(0, 2000)}`);
      return;
    case 'error':
      logger.warn(`[${ext.id}] ${msg.message}`);
      patch(ext.id, () => ({ error: String(msg.message).slice(0, 500) }));
      return;
    case 'request':
      void answer(ext, msg.reqId, msg.method, msg.args);
      return;
    default:
      return;
  }
}

async function answer(ext: RunningExtension, reqId: number, method: ExtensionMethod, args: unknown[]): Promise<void> {
  try {
    const needs = METHOD_PERMISSION[method];
    if (needs && !ext.permissions.includes(needs)) throw new Error(`${method} needs "${needs}" in the permissions of extension.json.`);
    let value: unknown;
    const id = ext.id;
    switch (method) {
      case 'project.get':
        value = projectStore.getState().doc ?? null;
        break;
      case 'settings.get':
        value = useSettingsStore.getState().settings ?? null;
        break;
      case 'project.update': {
        const doc = projectStore.getState().doc;
        if (!doc) throw new Error('No project is open.');
        const label = (typeof args[0] === 'string' && args[0] ? args[0] : 'Extension edit').slice(0, 80);
        const ops = PatchOpSchema.array().max(100_000).parse(args[1]);
        const next = applyPatch(doc, ops);
        const checked = ProjectSchema.safeParse(next);
        if (!checked.success) throw new Error(`That edit would break the project: ${checked.error.issues[0]?.path.join('/')} ${checked.error.issues[0]?.message}`);
        projectStore.getState().execute({
          label: `${ext.name}: ${label}`,
          apply: (d) => {
            const target = d as unknown as Record<string, unknown>;
            for (const [k, v] of Object.entries(checked.data)) target[k] = v;
            for (const k of Object.keys(target)) if (!(k in checked.data)) delete target[k];
          },
        });
        value = { applied: ops.length };
        break;
      }
      case 'project.create': {
        const m = z.object({ name: z.string().min(1).max(120), slug: z.string().optional(), brand: z.string().max(120).optional(), description: z.string().max(4000).optional(), author: z.string().max(120).optional() }).parse(args[0]);
        const slug = (m.slug ?? slugify(m.name)).slice(0, 64);
        if (!SLUG_PATTERN.test(slug)) throw new Error(`"${slug}" isn't a usable mod folder name.`);
        value = await newProject({ name: m.name, slug, brand: m.brand ?? '', description: m.description ?? '', author: m.author ?? useSettingsStore.getState().settings?.author ?? '' });
        break;
      }
      case 'project.declarePort': {
        // The declaration is the user's to make, never the extension's: ask, and stop the import on no.
        const info = z.object({ game: z.string().min(1).max(120), credit: z.string().max(200).optional() }).parse(args[0]);
        if (!projectStore.getState().doc) throw new Error('Open or create a project first (forge.project.create).');
        const yes = await useDialogStore
          .getState()
          .askConfirm(
            `Porting from ${info.game}`,
            `${ext.name} brings a car over from ${info.game}. That is only fair if you own ${info.game}, the mod credits it, and the mod is free: never sold or put behind a paywall. The mod will say “Ported from ${info.game}” in its description and a ported_from.txt.`,
            `I own ${info.game}; the mod will be free`,
            'primary',
          );
        if (!yes) throw new Error('The porting declaration was declined.');
        projectStore.getState().execute({ label: `Ported from ${info.game}`, apply: (d) => void (d.meta.portedFrom = { game: info.game, credit: info.credit, owned: true, free: true }) });
        value = true;
        break;
      }
      case 'project.setReference': {
        const r = z.object({ game: z.string().min(1).max(120), carId: z.string().min(1).max(200), folder: z.string().max(4096).default(''), files: z.record(z.string().max(300), z.string().max(4 * 1024 * 1024)).default({}), specs: z.record(z.string().max(80), z.string().max(400)).default({}) }).parse(args[0]);
        const size = Object.values(r.files).reduce((n, t) => n + t.length, 0);
        if (size > 32 * 1024 * 1024) throw new Error('Too much text to keep with the project (32 MB at most).');
        if (!projectStore.getState().doc) throw new Error('Open or create a project first (forge.project.create).');
        projectStore.getState().execute({
          label: `Keep ${r.carId}'s data`,
          apply: (d) => void (d.reference = { kind: 'game', game: r.game, carId: r.carId, folder: r.folder, skin: null, files: r.files, specs: r.specs, importedAt: new Date().toISOString() }),
        });
        value = { files: Object.keys(r.files).length };
        break;
      }
      case 'parts.autoClassify':
        if (!projectStore.getState().doc) throw new Error('Open or create a project first (forge.project.create).');
        value = autoClassifyNow(`${ext.name}: sort meshes into parts`);
        break;
      case 'parts.create': {
        const kind = z.string().min(1).max(80).parse(args[0]);
        const keys = z.array(z.string().max(300)).max(20_000).parse(args[1] ?? []);
        const position = z.string().max(20).nullable().parse(args[2] ?? null);
        const tax = currentTaxonomy();
        if (!tax.entry(kind)) throw new Error(`Unknown part kind "${kind}" (see Parts → Add part for the kinds).`);
        let created: { id: string; name: string } | null = null;
        projectStore.getState().execute({
          label: `${ext.name}: add a part`,
          apply: (d) => {
            const part = createPart(d, tax, { taxonomyId: kind, position });
            for (const k of keys) d.assignments[k] = part.id;
            created = { id: part.id, name: part.name };
          },
        });
        value = created;
        break;
      }
      case 'jbeam.parse': {
        const text = typeof args[0] === 'string' ? args[0] : '';
        if (text.length > 64 * 1024 * 1024) throw new Error('That jbeam text is too big.');
        value = parseJbeam(text).value;
        break;
      }
      case 'files.zipList':
        value = await call('extfs:zipList', { id, path: String(args[0]) });
        break;
      case 'files.zipRead':
        value = await call('extfs:zipRead', { id, path: String(args[0]), entry: String(args[1]) });
        break;
      case 'files.zipExtract':
        value = await call('extfs:zipExtract', { id, path: String(args[0]), prefixes: z.array(z.string().max(1024)).max(100).parse(args[1] ?? []) });
        break;
      case 'files.pickFolder':
        value = await call('extfs:pickFolder', { id, title: (typeof args[0] === 'string' ? args[0] : '').slice(0, 200) });
        break;
      case 'files.pickFile':
        value = await call('extfs:pickFile', { id, title: (typeof args[0] === 'string' ? args[0] : '').slice(0, 200), extensions: z.array(z.string()).max(20).parse(args[1] ?? []) });
        break;
      case 'files.folders':
        value = await call('extfs:folders', { id });
        break;
      case 'files.list':
        value = await call('extfs:list', { id, path: String(args[0]) });
        break;
      case 'files.read':
        value = await call('extfs:read', { id, path: String(args[0]) });
        break;
      case 'files.readText':
        value = new TextDecoder().decode(await call('extfs:read', { id, path: String(args[0]) }));
        break;
      case 'import.model':
        value = await importModel(ext, ExtensionModelSchema.parse(args[0]));
        break;
      case 'import.file': {
        const opts = z.object({ scale: z.number().positive().optional(), upAxis: AxisSchema.optional(), forwardAxis: AxisSchema.optional() }).parse(args[1] ?? {});
        const f = await call('extfs:importable', { id, path: String(args[0]) });
        value = await importPath(f.path, f.format, opts);
        break;
      }
      default:
        throw new Error(`Unknown request ${String(method)}`);
    }
    send(ext.id, { type: 'reply', reqId, ok: true, value });
  } catch (err) {
    send(ext.id, { type: 'reply', reqId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

interface ImportResult {
  sourceId: string;
  meshes: { key: string; name: string }[];
  bounds: { min: number[]; max: number[]; size: number[] } | null;
}

const AxisSchema = z.enum(['+x', '-x', '+y', '-y', '+z', '-z']);

/** Import a model file into the open project; returns its source id and mesh names. */
async function importPath(path: string, format: SourceFormat, opts: { scale?: number; upAxis?: z.infer<typeof AxisSchema>; forwardAxis?: z.infer<typeof AxisSchema> }): Promise<ImportResult> {
  if (!projectStore.getState().doc) throw new Error('Open or create a project first (forge.project.create).');
  const staged = await stageImport(path, format);
  const settings = { ...defaultSettings(format), ...opts };
  const sourceId = await confirmImport(staged, settings, { classify: false });
  if (!sourceId) throw new Error('The model could not be imported.');
  const loaded = useSceneStore.getState().sources[sourceId];
  // Bounds in BeamNG space (metres), so an importer can check the model's size and units.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of loaded?.meshes ?? []) {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    if (!b) continue;
    [b.min.x, b.min.y, b.min.z].forEach((v, i) => (lo[i] = Math.min(lo[i]!, v)));
    [b.max.x, b.max.y, b.max.z].forEach((v, i) => (hi[i] = Math.max(hi[i]!, v)));
  }
  const bounds = Number.isFinite(lo[0]) ? { min: lo, max: hi, size: hi.map((v, i) => v - lo[i]!) } : null;
  return { sourceId, meshes: (loaded?.meshes ?? []).map((m) => ({ key: m.key, name: m.name })), bounds };
}

/** A model built by an extension: written as OBJ (with its textures), then imported like any file. */
async function importModel(ext: RunningExtension, m: ExtensionModel): Promise<ImportResult> {
  const { obj, mtl, textures } = modelToObj(m);
  const files: { name: string; text?: string; bytes?: Uint8Array; from?: string }[] = [
    { name: 'model.obj', text: obj },
    { name: 'model.mtl', text: mtl },
  ];
  for (const t of textures) {
    const tex = m.materials.find((x) => x.name === t.material)?.texture;
    if (!tex) continue;
    files.push('path' in tex ? { name: t.file, from: tex.path } : { name: t.file, bytes: tex.bytes });
  }
  const path = await call('extfs:writeModel', { id: ext.id, name: m.name, files });
  return importPath(path, 'obj', { scale: m.scale, upAxis: m.upAxis, forwardAxis: m.forwardAxis });
}

function start(info: ExtensionInfo, enabled: boolean): RunningExtension {
  const m = info.manifest;
  const ext: RunningExtension = { id: m?.id ?? info.folder, name: m?.name ?? info.folder.split(/[\\/]/).pop() ?? 'Extension', version: m?.version ?? '', description: m?.description ?? '', folder: info.folder, enabled, running: false, commands: [], templates: [], permissions: m?.permissions ?? [], error: info.error };
  if (!m || info.code === null || !enabled || info.error) return ext;
  const url = URL.createObjectURL(new Blob([EXTENSION_BOOTSTRAP, '\n;\n', info.code], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: `extension:${m.id}` });
  worker.addEventListener('message', (e: MessageEvent<FromExtension>) => handle(ext, e.data));
  worker.addEventListener('error', (e) => patch(m.id, () => ({ error: e.message || 'failed to start' })));
  workers.set(m.id, { worker, url });
  ext.running = true;
  return ext;
}

export function stopExtensions(): void {
  generation++;
  for (const [id, w] of workers) {
    w.worker.terminate();
    URL.revokeObjectURL(w.url);
    for (const t of useExtensions.getState().list.find((e) => e.id === id)?.templates ?? []) useTemplates.getState().unregister(t);
  }
  workers.clear();
  unsubscribeDoc?.();
  unsubscribeDoc = null;
  useExtensions.setState({ list: [] });
}

/** (Re)start every enabled extension. */
export async function startExtensions(): Promise<void> {
  stopExtensions();
  const token = generation;
  useExtensions.setState({ loading: true });
  let infos: ExtensionInfo[] = [];
  try {
    infos = await call('extensions:list');
  } catch (err) {
    logger.warn('extensions not listed:', err);
  }
  if (token !== generation) return; // stopped or restarted meanwhile
  const settings = useSettingsStore.getState().settings;
  const on = settings?.extensionsEnabled ?? true;
  const off = new Set(settings?.disabledExtensions ?? []);
  const list = infos.map((i) => start(i, on && !off.has(i.manifest?.id ?? '')));
  useExtensions.setState({ list, loading: false });
  if (list.some((e) => e.running)) logger.info(`extensions running: ${list.filter((e) => e.running).map((e) => e.id).join(', ')}`);
  // Tell them when the project changes (at most twice a second) or another opens.
  let lastCreated = projectStore.getState().doc?.meta.createdAt ?? null;
  unsubscribeDoc = projectStore.subscribe((s, prev) => {
    if (s.doc === prev.doc) return;
    const created = s.doc?.meta.createdAt ?? null;
    if (created !== lastCreated) {
      lastCreated = created;
      for (const id of workers.keys()) send(id, { type: 'event', name: 'projectOpened' });
    }
    if (docTimer) return;
    docTimer = setTimeout(() => {
      docTimer = null;
      for (const id of workers.keys()) send(id, { type: 'event', name: 'projectChanged' });
    }, 500);
  });
}

export function runExtensionCommand(extensionId: string, commandId: string): void {
  send(extensionId, { type: 'run', id: commandId });
}
