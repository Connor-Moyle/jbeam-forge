import { create } from 'zustand';
import { applyPatch, EXTENSION_BOOTSTRAP, extensionTemplate, PatchOpSchema, type ExtensionInfo, type FromExtension, type ToExtension } from '@shared/extensions/api';
import { ProjectSchema } from '@shared/project/schema';
import { projectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { useTemplates } from '@renderer/scripts/registry';

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
      answer(ext, msg.reqId, msg.method, msg.args);
      return;
    default:
      return;
  }
}

function answer(ext: RunningExtension, reqId: number, method: string, args: unknown[]): void {
  try {
    let value: unknown;
    if (method === 'project.get') value = projectStore.getState().doc ?? null;
    else if (method === 'settings.get') value = useSettingsStore.getState().settings ?? null;
    else if (method === 'project.update') {
      const doc = projectStore.getState().doc;
      if (!doc) throw new Error('No project is open.');
      const label = (typeof args[0] === 'string' && args[0] ? args[0] : 'Extension edit').slice(0, 80);
      const ops = PatchOpSchema.array().max(10_000).parse(args[1]);
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
    } else throw new Error(`Unknown request ${method}`);
    send(ext.id, { type: 'reply', reqId, ok: true, value });
  } catch (err) {
    send(ext.id, { type: 'reply', reqId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function start(info: ExtensionInfo, enabled: boolean): RunningExtension {
  const m = info.manifest;
  const ext: RunningExtension = { id: m?.id ?? info.folder, name: m?.name ?? info.folder.split(/[\\/]/).pop() ?? 'Extension', version: m?.version ?? '', description: m?.description ?? '', folder: info.folder, enabled, running: false, commands: [], templates: [], error: info.error };
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
