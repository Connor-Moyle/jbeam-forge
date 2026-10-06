import type { EventChannel, ExportBundle, ForgeApi, InvokeChannel, IpcResult, RecentProject } from '@shared/ipc-contract';
import { measuredFigures } from '@shared/export/performance';
import { LAYOUT_VERSION, StoredLayoutSchema } from '@shared/layout-schema';
import { DEFAULT_SETTINGS, mergeSettings, SettingsPatchSchema, type Settings } from '@shared/settings-schema';

/**
 * JBeam Forge inside BeamNG.drive: the same `window.forge` the desktop app gets from Electron,
 * answered by the game instead. Settings, layouts and projects live in the user folder
 * (settings/jbeamForge/), files are read through the game's own file system (so a game car's
 * files are reachable), and mods are written to mods/unpacked/. Everything goes through
 * jbeamForge.lua; what has no in-game version yet says so.
 */

/** What the game side answers with (jbeamForge.lua → M.call). */
export interface LuaReply {
  ok: boolean;
  value?: unknown;
  error?: { message: string };
}

/** How the screen talks to the game: given by the Vue component that mounts JBeam Forge. */
export interface GameBridge {
  /** Folder the mod's UI files are served from (…/mods/jbeamForge/). */
  base: string;
  call: (channel: string, req: unknown) => Promise<LuaReply>;
  on: (name: string, listener: (payload: unknown) => void) => () => void;
}

/** The car being driven, as the game built it (jbeamForge.lua → currentVehicle). */
export interface GameVehicle {
  id: number;
  model: string;
  dir: string;
  config: { file?: string; parts?: Record<string, string>; vars?: Record<string, number>; paints?: unknown };
  jbeamFiles: string[];
  models: string[];
  nodes: { id: string; pos: [number, number, number] | null; weight?: number; part?: string; collision?: boolean }[];
  /** [node1, node2, spring, damp, strength, deform, part, type] */
  beams: [string, string, number?, number?, number?, number?, string?, number?][];
  flexbodies: { mesh: string; nodes?: string[]; part?: string }[];
  refNodes?: Record<'ref' | 'back' | 'left' | 'up' | 'leftCorner' | 'rightCorner', string | undefined>;
}

/** A list from Lua: an empty Lua table comes over as {} rather than []. */
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The car as Lua sends it, with every list a list. */
export function gameVehicle(raw: GameVehicle | null): GameVehicle | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    ...raw,
    jbeamFiles: list(raw.jbeamFiles),
    models: list(raw.models),
    nodes: list<GameVehicle['nodes'][number]>(raw.nodes).map((n) => ({ ...n, pos: Array.isArray(n.pos) && n.pos.length === 3 ? n.pos : null })),
    beams: list(raw.beams),
    flexbodies: list<GameVehicle['flexbodies'][number]>(raw.flexbodies).map((f) => ({ ...f, nodes: list<string>(f.nodes) })),
  };
}

const PROJECTS = '/settings/jbeamForge/projects/';
const NOT_HERE = 'ENOSYS';

type Handler = (req: never) => unknown;

export function createGameForge(bridge: GameBridge): ForgeApi & { ingame: true; game: { vehicle: () => Promise<GameVehicle | null>; spawn: (model: string, config?: string) => Promise<void>; close: () => Promise<void>; draw: (structure: { nodes: [number, number, number][]; beams: [number, number][] } | null) => Promise<void> } } {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (channel: EventChannel, payload: unknown) => listeners.get(channel)?.forEach((l) => l(payload));

  const lua = async <T>(channel: string, req: unknown = null): Promise<T> => {
    const r = await bridge.call(channel, req);
    if (!r.ok) throw new Error(r.error?.message ?? `${channel} failed`);
    return r.value as T;
  };
  const store = {
    read: async <T>(key: string): Promise<T | null> => {
      const text = await lua<string | null>('store:read', { key });
      if (!text) return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
    write: (key: string, value: unknown) => lua('store:write', { key, text: JSON.stringify(value, null, 1) }),
  };

  let settings: Settings | null = null;
  const loadSettings = async (): Promise<Settings> => {
    if (!settings) settings = mergeSettings((await store.read('settings.json')) ?? DEFAULT_SETTINGS);
    return settings;
  };

  const recent = {
    list: async () => (await store.read<RecentProject[]>('recent.json')) ?? [],
    touch: async (path: string, text: string, thumbnail?: string | null) => {
      let meta: { name: string; slug: string } = { name: 'Untitled', slug: 'untitled' };
      try {
        const doc = JSON.parse(text) as { meta?: { name?: string; slug?: string } };
        meta = { name: doc.meta?.name ?? meta.name, slug: doc.meta?.slug ?? meta.slug };
      } catch {
        // not JSON: keep the defaults
      }
      const list = (await recent.list()).filter((r) => r.path !== path);
      list.unshift({ path, ...meta, openedAt: new Date().toISOString(), exists: true, thumbnail: thumbnail ?? null });
      await store.write('recent.json', list.slice(0, 12));
    },
  };

  const bytesOf = (base64: string): Uint8Array => {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mod';

  const handlers: Partial<Record<InvokeChannel, Handler>> = {
    'settings:get': () => loadSettings(),
    'settings:update': async (patch: unknown) => {
      const next = mergeSettings({ ...(await loadSettings()), ...SettingsPatchSchema.parse(patch) });
      settings = next;
      await store.write('settings.json', next);
      emit('settings:changed', next);
      return next;
    },
    'layout:load': async () => {
      const raw = await store.read('layout.json');
      const parsed = StoredLayoutSchema.safeParse(raw);
      return parsed.success && parsed.data.version === LAYOUT_VERSION ? parsed.data : null;
    },
    'layout:save': (layout: unknown) => store.write('layout.json', layout),
    'layout:reset': () => store.write('layout.json', null),
    'window:setDirty': () => undefined,
    'recent:list': () => recent.list(),
    'recent:remove': async (req: { path: string }) => {
      await store.write('recent.json', (await recent.list()).filter((r) => r.path !== req.path));
    },
    // No file dialogs in the game: projects keep to the projects folder, named after the mod.
    'project:open': async () => {
      const latest = (await recent.list())[0];
      if (!latest) return null;
      return { path: latest.path, text: await lua<string>('fs:read', { path: latest.path }), pendingFolders: [] };
    },
    'project:openRecent': async (req: { path: string }) => {
      const text = await lua<string>('fs:read', { path: req.path });
      await recent.touch(req.path, text);
      return { path: req.path, text, pendingFolders: [] };
    },
    'project:save': async (req: { path: string; text: string; thumbnail?: string | null }) => {
      await lua('fs:writeMany', { files: [{ path: req.path, text: req.text }] });
      await recent.touch(req.path, req.text, req.thumbnail);
    },
    'project:saveAs': async (req: { text: string; suggestedName: string; thumbnail?: string | null }) => {
      const path = `${PROJECTS}${slugify(req.suggestedName.replace(/\.jbforge$/i, ''))}.jbforge`;
      await lua('fs:writeMany', { files: [{ path, text: req.text }] });
      await recent.touch(path, req.text, req.thumbnail);
      return path;
    },
    'project:allowFolders': () => undefined,
    'project:readHistory': async (req: { path: string }) => ((await lua<boolean[]>('fs:exists', { paths: [`${req.path}.history`] }))[0] ? lua<string>('fs:read', { path: `${req.path}.history` }) : null),
    'project:writeHistory': (req: { path: string; text: string }) => lua('fs:writeMany', { files: [{ path: `${req.path}.history`, text: req.text }] }).then(() => undefined),
    // The game is the install: its file system is the one being read.
    'beamng:detect': () => ({ installs: [], userDir: null }),
    // What the game's performance tests wrote for the car (its info files, as the game sees them).
    'beamng:measuredFigures': async (req: { vehicle: string }) => {
      const out: Record<string, Record<string, unknown>> = {};
      for (const path of list<string>(await lua<string[]>('fs:list', { dir: `/vehicles/${req.vehicle}/`, pattern: 'info_*.json' }))) {
        const config = /info_(.+)\.json$/i.exec(path)?.[1];
        if (!config) continue;
        try {
          const figures = measuredFigures(JSON.parse(await lua<string>('fs:read', { path })));
          if (Object.keys(figures).length) out[config] = figures;
        } catch {
          // not readable: skip
        }
      }
      return out;
    },
    'tutorial:demoModel': () => ({ path: `${bridge.base}demo-car/demo_car.obj` }),
    'import:readFile': async (req: { path: string }) => bytesOf(await lua<string>('fs:read', { path: req.path, binary: true })),
    'import:resolveTextures': async (req: { sourcePath: string; refs: string[]; textureDirs: string[] }) => {
      const dirs = [dirOf(req.sourcePath), ...req.textureDirs.map((d) => (d.endsWith('/') ? d : `${d}/`))];
      const resolved: Record<string, string | null> = {};
      for (const ref of req.refs) {
        const name = ref.replace(/\\/g, '/');
        const candidates = name.startsWith('/') ? [name] : dirs.flatMap((d) => [d + name, d + name.split('/').pop()!]);
        const found = list<boolean>(await lua<boolean[]>('fs:exists', { paths: candidates }));
        resolved[ref] = candidates[found.indexOf(true)] ?? null;
      }
      return { resolved, truncated: false };
    },
    'sources:watch': () => undefined,
    'library:status': () => ({ scanning: false, folders: [] }),
    'library:rescan': () => ({ ok: true }),
    'materials:library': () => [],
    'materials:pack': () => [],
    'objects:list': () => [],
    'scripts:library': () => ({ scripts: [], errors: [] }),
    'extensions:list': () => [],
    'taxonomy:getUser': () => [],
    'suspension:catalogue': () => [],
    'powertrain:catalogue': () => [],
    'panels:catalogue': () => [],
    // Export → Install: straight into the game's mods folder, mounted at once.
    'export:install': async (bundle: ExportBundle) => {
      const root = `/mods/unpacked/jbeam_forge_${slugify(bundle.slug)}/`;
      const bytes = await lua<number>('fs:writeMany', {
        files: bundle.files.map((f) => ({ path: root + f.path, ...(f.base64 !== undefined ? { base64: f.base64 } : { text: f.text ?? '' }) })),
        copies: bundle.copies.map((c) => ({ from: c.from, to: root + c.to })),
      });
      await lua('mods:refresh');
      return { path: root, bytes };
    },
  };

  const game = {
    vehicle: () => lua<GameVehicle | null>('vehicle:current').then(gameVehicle),
    spawn: (model: string, config?: string) => lua<void>('vehicle:spawn', { model, ...(config ? { config } : {}) }),
    measure: (model: string, config?: string) => lua<{ model: string; config: string }>('vehicle:measure', { model, ...(config ? { config } : {}) }),
    telemetry: () => lua<Record<string, unknown> | null>('vehicle:telemetry'),
    close: () => lua<void>('ui:close'),
    draw: (structure: { nodes: [number, number, number][]; beams: [number, number][] } | null) => lua<void>('world:draw', structure),
  };

  bridge.on('JBeamForgeEvent', (payload) => {
    const p = payload as { event?: string } | null;
    if (p?.event === 'vehicle:changed') emit('status:message', { text: 'The car in the game changed.', tone: 'info' });
    if (p?.event === 'measured') emit('status:message', { text: 'The game measured the car: export again to put its figures in the mod.', tone: 'success' });
  });

  return {
    async invoke(channel: InvokeChannel, req?: unknown): Promise<IpcResult<never>> {
      const handler = handlers[channel];
      if (!handler) return { ok: false, error: { message: `Not in the in-game version of JBeam Forge yet (${channel}).`, code: NOT_HERE } };
      try {
        return { ok: true, value: (await handler(req as never)) as never };
      } catch (err) {
        return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
      }
    },
    on(channel: EventChannel, listener: (payload: never) => void) {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener as (payload: unknown) => void);
      listeners.set(channel, set);
      return () => set.delete(listener as (payload: unknown) => void);
    },
    harness: false,
    isDev: false,
    ingame: true,
    game,
  };
}
