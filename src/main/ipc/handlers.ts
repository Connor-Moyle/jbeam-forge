import { app, BrowserWindow, clipboard, shell } from 'electron';
import { INGAME_ZIP, ingameStatus, installIngame } from '../beamng/ingame';
import { sendEvent } from './register';
import { z } from 'zod';
import { demoCarObj } from '@shared/tutorial/demoCar';
import { SourceWatcher } from '../services/sourceWatcher';
import { SettingsPatchSchema } from '@shared/settings-schema';
import { StoredLayoutSchema } from '@shared/layout-schema';
import { parseProject } from '@shared/project/io';
import { TaxonomyEntrySchema } from '@shared/taxonomy/schema';
import type { SettingsService } from '../services/settings';
import type { UserTaxonomyService } from '../services/userTaxonomy';
import type { MaterialLibraryService } from '../services/materialLibrary';
import { MaterialDefSchema } from '@shared/materials/schema';
import type { LayoutService } from '../services/layout';
import type { RecentService } from '../services/recent';
import { AccessError, readHistory, withProjectExtension, writeHistory, type ProjectFiles } from '../services/projectFiles';
import type { BeamngService } from '../beamng/service';
import type { Packs } from '../content/packs';
import { gameMaterialDefinitions, scanGameMaterials } from '../beamng/gameMaterials';
import { vehicleLogReport } from '@shared/beamng/logReport';
import { measuredFigures } from '@shared/export/performance';
import { vehicleClashes } from '../export/clashes';
import { engineSoundSamples, readSoundFile, scanEngineSounds } from '../beamng/engineSounds';
import type { SetOptions } from '@shared/suspension/options';
import { collectDiagnostics, copyDiagnosticsToClipboard } from '../diagnostics';
import { pickDirectory, pickOpenFile, pickOpenFiles, pickSaveFile, queueHarnessDialogAnswers } from '../dialogs';
import { getLogFolder, scoped } from '../log';
import { assertReadable, formatFromPath, locateSource, MODEL_FILTERS, projectResourceFolders, type FolderTrust } from '../import/access';
import { resolveTextureRefs } from '../import/textures';
import { copyFile, readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { kn5TextureDir } from '../import/kn5Textures';
import { readAcCar } from '../import/acCar';
import type { JbeamObject } from '@shared/jbeam/parse';
import type { UserLibrary } from '../library/userLibrary';
import { checkBundle, ExportError, installUnpacked, writeZip } from '../export/writer';
import { describeError } from '@shared/logger';
import { TEXT_FILE_KINDS, type TextFileKind } from '@shared/ipc-contract';
import { MODEL_FORMATS, MODEL_FORMAT_VALUES } from '@shared/export/modelFormatList';

const logger = scoped('ipc');
import { registerInvoke } from './register';

const MAX_EXTRA_CHARS = 20_000;
const MAX_THUMBNAIL_CHARS = 800_000;
const PROJECT_FILTERS = [{ name: 'JBeam Forge project', extensions: ['jbforge'] }];

export interface WindowState {
  dirty: boolean;
}

export interface HandlerServices {
  settings: SettingsService;
  layout: LayoutService;
  beamng: BeamngService;
  recent: RecentService;
  projects: ProjectFiles;
  windowState: WindowState;
  trust: FolderTrust;
  userTaxonomy: UserTaxonomyService;
  materialLibrary: MaterialLibraryService;
  /** The material and object packs: bundled with older installs, and downloaded (reloaded after downloads). */
  packs: Packs;
  userLibrary: UserLibrary;
  /** Where textures embedded in kn5 files are extracted. */
  kn5Cache: string;
  /** Where textures painted in the app are saved. */
  paintedTextures: string;
  harness: boolean;
}

/** Parse leniently for main's own bookkeeping; null when the file doesn't load. */
function tryParse(text: string) {
  try {
    return parseProject(text).project;
  } catch {
    return null;
  }
}

/** Name/slug for the recent list, or null when the file doesn't load (it isn't added). */
function describeProject(text: string): { name: string; slug: string } | null {
  const project = tryParse(text);
  return project ? { name: project.meta.name, slug: project.meta.slug } : null;
}

export function registerIpcHandlers(services: HandlerServices): void {
  const { settings, layout, beamng, recent, projects, windowState, trust, userTaxonomy, materialLibrary, packs } = services;
  /** Folders each opened project wants but the user hasn't allowed yet. */
  const pendingByProject = new Map<string, string[]>();

  /** Grant what an opened project may read; return the folders that need consent. */
  const grantForOpenedProject = async (path: string, text: string): Promise<string[]> => {
    projects.grantFile(path); // the project folder itself
    const project = tryParse(text);
    if (!project) return [];
    const { inside, outside } = await projectResourceFolders(path, project);
    for (const d of inside) projects.grantRoot(d);
    const pending: string[] = [];
    for (const d of outside) {
      if (trust.isTrusted(path, d)) projects.grantRoot(d);
      else pending.push(d);
    }
    pendingByProject.set(path.toLowerCase(), pending);
    return pending;
  };

  /** The recent list is a convenience: its failures are logged, never turned into open/save failures. */
  const touchRecent = async (path: string, info: { name: string; slug: string } | null, thumbnail?: string | null) => {
    if (!info) return;
    try {
      await recent.touch(path, info, thumbnail);
    } catch (err) {
      logger.warn('could not update recent projects:', describeError(err).message);
    }
  };

  registerInvoke('settings:get', () => settings.get());
  registerInvoke(
    'settings:update',
    async (patch) => {
      // Never persist an install folder that isn't a BeamNG install.
      if (patch.beamngInstallDir) {
        const v = await beamng.validate(patch.beamngInstallDir);
        if (!v.ok) throw new Error(`Not a BeamNG.drive install: ${v.problems.join(' ')}`);
        patch = { ...patch, beamngInstallDir: v.dir };
      }
      return settings.update(patch);
    },
    SettingsPatchSchema,
  );

  registerInvoke('taxonomy:getUser', () => userTaxonomy.get());
  registerInvoke('taxonomy:saveUser', (req) => userTaxonomy.save(req.entries), z.object({ entries: z.array(TaxonomyEntrySchema) }));

  registerInvoke('layout:load', () => layout.load());
  registerInvoke(
    'layout:save',
    async (req) => {
      await layout.save(req);
      return undefined;
    },
    StoredLayoutSchema,
  );
  registerInvoke('layout:reset', async () => {
    await layout.reset();
    return undefined;
  });

  registerInvoke('diagnostics:get', () => collectDiagnostics());
  registerInvoke(
    'diagnostics:copy',
    async (req) => {
      await copyDiagnosticsToClipboard(req?.extra);
      return undefined;
    },
    z.object({ extra: z.string().max(MAX_EXTRA_CHARS).optional() }).optional(),
  );

  registerInvoke('shell:openLogFolder', async () => {
    const err = await shell.openPath(getLogFolder());
    if (err) throw new Error(err);
    return undefined;
  });

  // ---------------------------------------------------------------- export (Phase 5)
  let lastExport: string | null = null;
  const ExportBundleSchema = z.object({
    slug: z.string().min(1).max(64),
    projectName: z.string().max(256),
    files: z.array(z.object({ path: z.string().min(1).max(512), text: z.string().optional(), base64: z.string().optional() })).max(20_000),
    copies: z.array(z.object({ from: z.string().min(1).max(4096), to: z.string().min(1).max(512) })).max(5_000),
  });
  const modsDir = async (): Promise<string> => {
    const userDir = settings.get().beamngUserDir ?? (await beamng.detect()).userDir;
    if (!userDir) throw new ExportError('BeamNG user folder not found: set it in Settings → BeamNG.');
    return join(userDir, 'mods');
  };
  registerInvoke(
    'export:install',
    async (bundle) => {
      checkBundle(bundle, (p) => projects.isUnderGrantedRoot(p));
      const mods = await modsDir();
      const r = await installUnpacked(mods, bundle);
      lastExport = r.path;
      const clashes = await vehicleClashes(mods, bundle.slug, r.path).catch(() => []);
      if (clashes.length) logger.warn(`other mods also carry vehicles/${bundle.slug}: ${clashes.join(', ')}`);
      logger.info(`exported ${bundle.slug} unpacked to ${r.path} (${bundle.files.length} files, ${bundle.copies.length} textures, ${r.bytes} bytes)`);
      return { ...r, clashes };
    },
    ExportBundleSchema,
  );
  registerInvoke(
    'export:publish',
    async ({ bundle, listing }, event) => {
      checkBundle(bundle, (p) => projects.isUnderGrantedRoot(p));
      const dir = await pickDirectory(event.sender, { title: 'Choose where to put the repository package' });
      if (!dir) return null;
      const safeVersion = listing.version.replace(/[^\w.-]+/g, '_') || '1.0';
      const out = join(dir, `${bundle.slug}_${safeVersion}`);
      await mkdir(join(out, 'pictures'), { recursive: true });
      const zip = await writeZip(join(out, `${bundle.slug}_${safeVersion}.zip`), bundle, settings.get().compressZip);
      // The config previews double as the listing's pictures.
      for (const f of bundle.files) if (f.base64 && /\.(jpg|png)$/i.test(f.path)) await writeFile(join(out, 'pictures', f.path.split('/').pop()!), Buffer.from(f.base64, 'base64'));
      const readme = [`# ${listing.title} ${listing.version}`, '', listing.tagline, '', listing.description, '', `Tags: ${listing.tags.join(', ')}`, '', '## Checks', '', ...listing.checklist.map((c) => `- ${c}`), ''].join('\n');
      await writeFile(join(out, 'README.md'), readme);
      await writeFile(join(out, 'description.txt'), `${listing.tagline}\n\n${listing.description}\n`);
      lastExport = out;
      logger.info(`publish package for ${bundle.slug} at ${out}`);
      return { path: out, bytes: zip.bytes };
    },
    z.object({ bundle: ExportBundleSchema, listing: z.object({ title: z.string().min(1).max(120), tagline: z.string().max(300), version: z.string().max(40), description: z.string().max(20000), tags: z.array(z.string().max(40)).max(30), checklist: z.array(z.string().max(300)).max(50) }) }),
  );

  registerInvoke(
    'export:zip',
    async (bundle, event) => {
      checkBundle(bundle, (p) => projects.isUnderGrantedRoot(p));
      const picked = await pickSaveFile(event.sender, { title: 'Save mod zip', defaultPath: `${bundle.slug}.zip`, filters: [{ name: 'BeamNG mod (.zip)', extensions: ['zip'] }] });
      if (!picked) return null;
      const r = await writeZip(picked.toLowerCase().endsWith('.zip') ? picked : `${picked}.zip`, bundle, settings.get().compressZip);
      lastExport = r.path;
      logger.info(`exported ${bundle.slug} as ${r.path} (${r.bytes} bytes)`);
      return r;
    },
    ExportBundleSchema,
  );
  registerInvoke(
    'export:saveModel',
    async ({ suggestedName, format, data, extra }, event) => {
      const info = MODEL_FORMATS.find((f) => f.value === format)!;
      const picked = await pickSaveFile(event.sender, { title: 'Export model', defaultPath: suggestedName, filters: [{ name: info.label, extensions: [format] }] });
      if (!picked) return null;
      const path = picked.toLowerCase().endsWith(`.${format}`) ? picked : `${picked}.${format}`;
      let text = typeof data === 'string' ? data : null;
      // An OBJ names its .mtl: when the file was saved under another name, the library goes with it.
      const beside = extra ? `${path.slice(0, -format.length)}${extra.ext}` : null;
      if (text !== null && beside && format === 'obj') text = text.replace(/^mtllib .*$/m, `mtllib ${basename(beside)}`);
      const bytes = text !== null ? Buffer.from(text, 'utf8') : Buffer.from((data as Uint8Array).buffer, (data as Uint8Array).byteOffset, (data as Uint8Array).byteLength);
      await writeFile(path, bytes);
      if (beside && extra) await writeFile(beside, Buffer.from(extra.data, 'utf8'));
      lastExport = path;
      logger.info(`exported model ${path} (${bytes.byteLength} bytes)`);
      return { path, bytes: bytes.byteLength };
    },
    z.object({ suggestedName: z.string().min(1).max(255), format: z.enum(MODEL_FORMAT_VALUES), data: z.union([z.instanceof(Uint8Array), z.string()]), extra: z.object({ ext: z.string().regex(/^[a-z0-9]{1,5}$/), data: z.string() }).optional() }),
  );
  registerInvoke('export:reveal', () => {
    if (lastExport) shell.showItemInFolder(lastExport);
    return undefined;
  });

  registerInvoke('beamng:detect', () => beamng.detect());
  registerInvoke(
    'clipboard:writeText',
    async ({ text }) => {
      await clipboard.writeText(text);
      return undefined;
    },
    z.object({ text: z.string().max(4_000_000) }),
  );
  // JBeam Forge inside the game: carried by this app, kept at its version.
  const ingameZip = () => (app.isPackaged ? join(process.resourcesPath, 'ingame', INGAME_ZIP) : join(app.getAppPath(), 'release', 'jbeam_forge_ingame.zip'));
  const modsDirOrNull = () => modsDir().catch(() => null);
  registerInvoke('ingame:status', async () => ingameStatus(ingameZip(), await modsDirOrNull()));
  registerInvoke('ingame:install', async () => {
    const r = await installIngame(ingameZip(), await modsDir());
    logger.info(`in-game version ${r.installed ?? '?'} installed in ${r.modsDir}`);
    return r;
  });
  registerInvoke('beamng:validate', ({ dir }) => beamng.validate(dir), z.object({ dir: z.string().min(1).max(1024) }));
  const installDir = () => settings.get().beamngInstallDir;
  registerInvoke('beamng:engineSounds', async () => {
    const dir = installDir();
    return dir ? (await scanEngineSounds(dir)).map((s) => ({ name: s.name })) : [];
  });
  registerInvoke(
    'beamng:soundSamples',
    async ({ name }) => {
      const dir = installDir();
      return dir ? engineSoundSamples(dir, name) : [];
    },
    z.object({ name: z.string().min(1).max(200) }),
  );
  registerInvoke(
    'beamng:soundFile',
    async ({ path }) => {
      const dir = installDir();
      return dir ? readSoundFile(dir, path) : null;
    },
    z.object({ path: z.string().min(1).max(500) }),
  );
  registerInvoke('beamng:gameMaterials', async () => {
    const dir = settings.get().beamngInstallDir;
    return dir ? scanGameMaterials(dir) : [];
  });
  registerInvoke(
    'beamng:logReport',
    async ({ vehicle }) => {
      const dir = settings.get().beamngUserDir;
      if (!dir) return null;
      const file = join(dir, 'beamng.log');
      try {
        const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
        return { ...vehicleLogReport(text, vehicle), logTime: info.mtimeMs };
      } catch {
        return null;
      }
    },
    z.object({ vehicle: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }),
  );
  registerInvoke(
    'beamng:gameMaterialDefs',
    async ({ names }) => {
      const dir = settings.get().beamngInstallDir;
      return dir ? gameMaterialDefinitions(dir, names) : {};
    },
    z.object({ names: z.array(z.string().min(1).max(256)).max(5000) }),
  );
  registerInvoke(
    'beamng:measuredFigures',
    async ({ vehicle }) => {
      const dir = settings.get().beamngUserDir;
      const out: Record<string, Record<string, unknown>> = {};
      if (!dir) return out;
      const folder = join(dir, 'vehicles', vehicle);
      const names = await readdir(folder).catch(() => [] as string[]);
      for (const name of names) {
        const m = /^info_(.+)\.json$/i.exec(name);
        if (!m) continue;
        try {
          const figures = measuredFigures(JSON.parse(await readFile(join(folder, name), 'utf8')));
          if (Object.keys(figures).length) out[m[1]!] = figures;
        } catch {
          // half-written or not JSON: skip
        }
      }
      return out;
    },
    z.object({ vehicle: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }),
  );

  registerInvoke(
    'dialog:pickDirectory',
    (req, event) =>
      pickDirectory(event.sender, {
        title: req?.title ?? 'Choose folder',
        ...(req?.defaultPath ? { defaultPath: req.defaultPath } : {}),
      }),
    z.object({ title: z.string().max(200).optional(), defaultPath: z.string().max(1024).optional() }).optional(),
  );

  // ---- projects: every path comes from a dialog, the recent list, or an earlier grant ----

  registerInvoke('project:open', async (_req, event) => {
    const folder = settings.get().projectFolder;
    const path = await pickOpenFile(event.sender, { title: 'Open project', filters: PROJECT_FILTERS, properties: ['openFile'], ...(folder ? { defaultPath: folder } : {}) });
    if (!path) return null;
    const text = await projects.read(path);
    const pendingFolders = await grantForOpenedProject(path, text);
    await touchRecent(path, describeProject(text));
    return { path, text, pendingFolders };
  });

  registerInvoke(
    'project:openRecent',
    async ({ path }) => {
      if (!recent.has(path)) throw new AccessError('Not in the recent projects list');
      const text = await projects.read(path);
      const pendingFolders = await grantForOpenedProject(path, text);
      await touchRecent(path, describeProject(text));
      return { path, text, pendingFolders };
    },
    z.object({ path: z.string().min(1).max(4096) }),
  );

  const Thumbnail = z.string().max(MAX_THUMBNAIL_CHARS).nullable().optional();

  registerInvoke(
    'project:save',
    async ({ path, text, thumbnail }) => {
      const info = await projects.write(path, text, settings.get().backupCount);
      await touchRecent(path, info, thumbnail);
      return undefined;
    },
    z.object({ path: z.string().min(1).max(4096), text: z.string(), thumbnail: Thumbnail }),
  );

  registerInvoke(
    'project:saveAs',
    async ({ text, suggestedName, thumbnail }, event) => {
      // Settings → Files: start in the projects folder when one is set.
      const folder = settings.get().projectFolder;
      const chosen = await pickSaveFile(event.sender, { title: 'Save project', defaultPath: folder ? join(folder, suggestedName) : suggestedName, filters: PROJECT_FILTERS });
      if (!chosen) return null;
      const path = withProjectExtension(chosen);
      projects.grantFile(path);
      const info = await projects.write(path, text, settings.get().backupCount);
      await touchRecent(path, info, thumbnail);
      return path;
    },
    z.object({ text: z.string(), suggestedName: z.string().min(1).max(255), thumbnail: Thumbnail }),
  );

  registerInvoke(
    'project:allowFolders',
    async ({ path }) => {
      const pending = pendingByProject.get(path.toLowerCase()) ?? [];
      for (const d of pending) projects.grantRoot(d);
      await trust.trust(path, pending);
      pendingByProject.set(path.toLowerCase(), []);
      return undefined;
    },
    z.object({ path: z.string().min(1).max(4096) }),
  );

  registerInvoke('project:readHistory', ({ path }) => readHistory(projects, path), z.object({ path: z.string().min(1).max(4096) }));
  registerInvoke(
    'project:writeHistory',
    async ({ path, text }) => {
      await writeHistory(projects, path, text);
      return undefined;
    },
    z.object({ path: z.string().min(1).max(4096), text: z.string() }),
  );

  registerInvoke('recent:list', () => recent.list());
  registerInvoke(
    'recent:remove',
    async ({ path }) => {
      await recent.remove(path);
      return undefined;
    },
    z.object({ path: z.string().min(1).max(4096) }),
  );

  registerInvoke(
    'shell:showItemInFolder',
    ({ path }) => {
      if (!recent.has(path) && !projects.isFileGranted(path)) throw new AccessError('Not a recent or open project');
      shell.showItemInFolder(path);
      return undefined;
    },
    z.object({ path: z.string().min(1).max(4096) }),
  );

  registerInvoke(
    'window:setDirty',
    ({ dirty }) => {
      windowState.dirty = dirty;
      return undefined;
    },
    z.object({ dirty: z.boolean() }),
  );

  // ---- import: source files, side files and textures, all inside granted folders ----

  registerInvoke('import:pickSource', async (_req, event) => {
    const path = await pickOpenFile(event.sender, { title: 'Import 3D model', filters: MODEL_FILTERS, properties: ['openFile'] });
    if (!path) return null;
    const format = formatFromPath(path);
    if (!format) throw new Error('Unsupported file type. Import DAE, FBX, OBJ, glTF/GLB or STL.');
    projects.grantFile(path); // also grants its folder: MTL, .bin and textures live next to it
    return { path, format, bytes: (await stat(path)).size };
  });

  // Auto-reimport: tell the window when a watched model file is saved again.
  const watcher = new SourceWatcher((path, kind) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) sendEvent(w.webContents, 'sources:changed', { path, kind });
  }, scoped('watch'));
  app.on('before-quit', () => watcher.close());
  registerInvoke(
    'sources:watch',
    async ({ paths, textures }) => {
      await watcher.set(
        paths.filter((p) => projects.isUnderGrantedRoot(p)),
        textures,
      );
      return undefined;
    },
    z.object({ paths: z.array(z.string().min(1).max(4096)).max(200), textures: z.boolean() }),
  );

  registerInvoke('tutorial:demoModel', async () => {
    const dir = join(dirname(services.paintedTextures), 'tutorial');
    await mkdir(dir, { recursive: true });
    // The practice car ships with the app (assets/demo-car): copied out so it can be edited and reloaded like any model.
    const shipped = app.isPackaged ? join(process.resourcesPath, 'demo-car') : join(app.getAppPath(), 'assets', 'demo-car');
    const path = join(dir, 'demo_car.obj');
    try {
      for (const f of await readdir(shipped)) await copyFile(join(shipped, f), join(dir, f));
    } catch {
      // Not found (a broken install): the simple car made in code instead.
      const { obj, mtl } = demoCarObj();
      await writeFile(path, obj);
      await writeFile(join(dir, 'demo_car.mtl'), mtl);
    }
    projects.grantFile(path);
    return { path };
  });

  registerInvoke(
    'import:readFile',
    async ({ path }) => {
      assertReadable(projects, path);
      return new Uint8Array(await readFile(path));
    },
    z.object({ path: z.string().min(1).max(4096) }),
  );

  registerInvoke(
    'import:resolveTextures',
    async ({ sourcePath, refs, textureDirs }) => {
      assertReadable(projects, sourcePath);
      const roots = textureDirs.filter((d) => projects.isUnderGrantedRoot(d));
      let result;
      if (extname(sourcePath).toLowerCase() === '.kn5') {
        // A kn5's textures live inside it. A chosen skin folder (a texture dir) overrides them;
        // the car folder itself isn't searched, or another skin's paint could be picked up.
        const embedded = await kn5TextureDir(sourcePath, services.kn5Cache);
        projects.grantRoot(embedded);
        const order = [...roots, embedded];
        result = await resolveTextureRefs(refs, order[0]!, order.slice(1));
      } else result = await resolveTextureRefs(refs, dirname(sourcePath), roots);
      // A texture that exists but isn't readable (e.g. ../textures next to an ungranted folder) is
      // "missing" to the user — that is what offers "Locate folder…", which grants it.
      for (const [ref, p] of Object.entries(result.resolved)) if (p && !projects.isUnderGrantedRoot(p)) result.resolved[ref] = null;
      return result;
    },
    z.object({ sourcePath: z.string().min(1).max(4096), refs: z.array(z.string().max(4096)).max(5000), textureDirs: z.array(z.string().max(4096)).max(50) }),
  );

  registerInvoke('ac:pickCar', async (_req, event) => {
    const dir = await pickDirectory(event.sender, { title: 'Choose an Assetto Corsa car folder (content/cars/…)' });
    if (!dir) return null;
    projects.grantRoot(dir);
    return readAcCar(dir);
  });

  registerInvoke(
    'kn5:saveBaked',
    async ({ kn5Path, name, bytes }) => {
      assertReadable(projects, kn5Path);
      const dir = await kn5TextureDir(kn5Path, services.kn5Cache);
      const path = join(dir, name);
      await writeFile(path, bytes);
      return path;
    },
    z.object({ kn5Path: z.string().min(1).max(4096), name: z.string().regex(/^[\w.-]{1,200}\.png$/), bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= 128 * 1024 * 1024) }),
  );

  registerInvoke('import:pickTextureDir', async (_req, event) => {
    const dir = await pickDirectory(event.sender, { title: 'Locate the folder containing the missing textures' });
    if (dir) projects.grantRoot(dir);
    return dir;
  });

  const LibraryEntry = z.object({ name: z.string().min(1).max(100), category: z.string().max(60), def: MaterialDefSchema });
  registerInvoke('materials:library', () => materialLibrary.get());
  registerInvoke('materials:pack', async () => [...(await packs.materials()), ...services.userLibrary.items.materials]);
  registerInvoke('objects:list', async () => [...(await packs.objects()), ...services.userLibrary.items.objects]);
  registerInvoke('suspension:catalogue', () => services.userLibrary.items.sets.filter((s) => s.kind === 'suspension'));
  registerInvoke('powertrain:catalogue', () => services.userLibrary.items.sets.filter((s) => s.kind === 'engine' || s.kind === 'gearbox'));
  registerInvoke(
    'powertrain:writeModel',
    async ({ name, obj, mtl }) => {
      // Beside the painted textures in the app's own folder; one file per build, so an open project's model is never overwritten under it.
      const dir = join(dirname(services.paintedTextures), 'engine-models');
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${name}.obj`);
      await writeFile(join(dir, `${name}.mtl`), mtl);
      await writeFile(path, obj.replace(/^mtllib .*$/m, `mtllib ${name}.mtl`));
      projects.grantFile(path);
      return { path };
    },
    z.object({ name: z.string().regex(/^[a-z0-9_-]{1,80}$/), obj: z.string().max(64 * 1024 * 1024), mtl: z.string().max(1024 * 1024) }),
  );
  registerInvoke('powertrain:importMod', async (_req, event) => {
    const settings = services.settings.get();
    const mods = settings.beamngUserDir ? join(settings.beamngUserDir, 'mods') : undefined;
    const file = await pickOpenFile(event.sender, { title: 'Choose a car exported from Automation (a .zip in BeamNG’s mods folder)', ...(mods ? { defaultPath: mods } : {}), filters: [{ name: 'Car mod', extensions: ['zip'] }], properties: ['openFile'] });
    if (!file) return null;
    const sets = await services.userLibrary.importMod(file, settings.beamngInstallDir);
    for (const s of sets) projects.grantRoot(dirname(s.jbeam));
    return { file, sets: sets.filter((s) => s.kind === 'engine' || s.kind === 'gearbox') };
  });
  registerInvoke('panels:catalogue', () => services.userLibrary.items.sets.filter((s) => s.kind === 'panel'));
  registerInvoke(
    'suspension:set',
    async ({ id }) => {
      const set = services.userLibrary.items.sets.find((s) => s.id === id);
      if (!set) return null;
      const parts = JSON.parse(await readFile(set.jbeam, 'utf8')) as Record<string, JbeamObject>;
      let anchors: Record<string, [number, number, number]> = {};
      try {
        anchors = JSON.parse(await readFile(join(dirname(set.jbeam), 'anchors.json'), 'utf8')) as typeof anchors;
      } catch {
        // cut before anchors were recorded: attachments stay on the suspension
      }
      let options: SetOptions | undefined;
      try {
        options = JSON.parse(await readFile(join(dirname(set.jbeam), 'options.json'), 'utf8')) as SetOptions;
      } catch {
        // cut before options were recorded, or none: rescan the game to offer its other parts
      }
      let held: string[] = [];
      try {
        held = JSON.parse(await readFile(join(dirname(set.jbeam), 'held.json'), 'utf8')) as string[];
      } catch {
        // cut before these were recorded
      }
      return { parts, anchors, root: set.part, held, ...(options ? { options } : {}) };
    },
    z.object({ id: z.string().min(1).max(300) }),
  );
  const libraryStatus = () => ({ scanning: services.userLibrary.items.scanning, folders: services.userLibrary.items.folders });
  registerInvoke('library:status', libraryStatus);
  registerInvoke('library:rescan', async () => {
    const s = settings.get();
    await services.userLibrary.scan({ materials: s.materialFolders, objects: s.objectFolders, beamngInstall: s.beamngInstallDir });
    // Tell the window, as a scan at startup does: the pickers reload the game's parts.
    const status = libraryStatus();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) sendEvent(w.webContents, 'library:changed', status);
    return status;
  });
  registerInvoke('materials:saveToLibrary', ({ name, category, def }) => materialLibrary.add(name, category, def), LibraryEntry);
  registerInvoke('materials:removeFromLibrary', ({ id }) => materialLibrary.remove(id), z.object({ id: z.string().min(1).max(64) }));
  registerInvoke(
    'materials:exportJbmat',
    async ({ name, category, def }, event) => {
      const picked = await pickSaveFile(event.sender, { title: 'Share material', defaultPath: `${name}.jbmat`, filters: [{ name: 'JBeam Forge material (.jbmat)', extensions: ['jbmat'] }] });
      if (!picked) return null;
      const path = picked.toLowerCase().endsWith('.jbmat') ? picked : `${picked}.jbmat`;
      await materialLibrary.exportJbmat(path, name, category, def);
      return path;
    },
    LibraryEntry,
  );
  registerInvoke('materials:importJbmat', async (_req, event) => {
    const path = await pickOpenFile(event.sender, {
      title: 'Import materials',
      filters: [{ name: 'Material or material pack (.jbmat, .zip)', extensions: ['jbmat', 'zip'] }],
      properties: ['openFile'],
    });
    return path ? materialLibrary.importFile(path) : null;
  });

  // Painted in the app: saved under userData and readable like any other texture.
  projects.grantRoot(services.paintedTextures);
  registerInvoke(
    'materials:saveTexture',
    async ({ name, bytes }) => {
      await mkdir(services.paintedTextures, { recursive: true });
      const path = join(services.paintedTextures, name);
      await writeFile(path, bytes);
      return path;
    },
    z.object({ name: z.string().regex(/^[\w.-]{1,200}\.png$/), bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= 128 * 1024 * 1024) }),
  );

  registerInvoke(
    'paint:saveImage',
    async ({ suggestedName, bytes }, event) => {
      const picked = await pickSaveFile(event.sender, { title: 'Save image', defaultPath: suggestedName, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (!picked) return null;
      const path = picked.toLowerCase().endsWith('.png') ? picked : `${picked}.png`;
      await writeFile(path, bytes);
      projects.grantRoot(dirname(path)); // so it can be brought back in
      return path;
    },
    z.object({ suggestedName: z.string().regex(/^[^\\/:*?"<>|]{1,200}$/), bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= 256 * 1024 * 1024) }),
  );

  const kindSchema = z.enum(Object.keys(TEXT_FILE_KINDS) as [TextFileKind, ...TextFileKind[]]);
  registerInvoke(
    'file:saveText',
    async ({ kind, suggestedName, text }, event) => {
      const k = TEXT_FILE_KINDS[kind];
      const picked = await pickSaveFile(event.sender, { title: `Save ${k.label}`, defaultPath: suggestedName, filters: [{ name: k.label, extensions: [k.ext] }] });
      if (!picked) return null;
      const path = picked.toLowerCase().endsWith(`.${k.ext}`) ? picked : `${picked}.${k.ext}`;
      await writeFile(path, text, 'utf8');
      return path;
    },
    z.object({ kind: kindSchema, suggestedName: z.string().regex(/^[^\\/:*?"<>|]{1,200}$/), text: z.string().max(20_000_000) }),
  );
  registerInvoke(
    'file:openText',
    async ({ kind, multiple }, event) => {
      const k = TEXT_FILE_KINDS[kind];
      const paths = await pickOpenFiles(event.sender, { title: `Open ${k.label}`, filters: [{ name: k.label, extensions: [k.ext] }], properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'] });
      const out: { path: string; name: string; text: string }[] = [];
      for (const path of paths.slice(0, 200)) {
        if ((await stat(path)).size > 5_000_000) throw new Error(`${basename(path)} is too big.`);
        out.push({ path, name: basename(path), text: await readFile(path, 'utf8') });
      }
      return out;
    },
    z.object({ kind: kindSchema, multiple: z.boolean().optional() }),
  );

  const VINYL_FILTERS = [{ name: 'JBeam Forge vinyl group (.jbvinyl)', extensions: ['jbvinyl'] }];
  registerInvoke(
    'vinyl:save',
    async ({ suggestedName, text }, event) => {
      const picked = await pickSaveFile(event.sender, { title: 'Save vinyl group', defaultPath: suggestedName, filters: VINYL_FILTERS });
      if (!picked) return null;
      const path = picked.toLowerCase().endsWith('.jbvinyl') ? picked : `${picked}.jbvinyl`;
      await writeFile(path, text, 'utf8');
      return path;
    },
    z.object({ suggestedName: z.string().regex(/^[^\\/:*?"<>|]{1,200}$/), text: z.string().max(20_000_000) }),
  );
  registerInvoke('vinyl:open', async (_req, event) => {
    const path = await pickOpenFile(event.sender, { title: 'Open vinyl group', filters: VINYL_FILTERS, properties: ['openFile'] });
    if (!path) return null;
    const size = (await stat(path)).size;
    if (size > 20_000_000) throw new Error('That file is too big to be a vinyl group.');
    return { path, text: await readFile(path, 'utf8') };
  });

  registerInvoke('materials:pickTexture', async (_req, event) => {
    const path = await pickOpenFile(event.sender, {
      title: 'Choose a texture',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'dds', 'tga', 'bmp', 'webp'] }],
      properties: ['openFile'],
    });
    if (path) projects.grantRoot(dirname(path));
    return path;
  });

  registerInvoke(
    'import:locateSource',
    async (req) => {
      const found = await locateSource(projects, req.projectPath, req);
      if (found) assertReadable(projects, found);
      return found;
    },
    z.object({ projectPath: z.string().max(4096).nullable(), path: z.string().min(1).max(4096), absolutePath: z.string().min(1).max(4096) }),
  );

  // Harness-only: scripted dialog answers. Not registered in normal runs.
  if (services.harness) {
    registerInvoke(
      'harness:queueDialog',
      ({ answers }) => {
        queueHarnessDialogAnswers(answers);
        return undefined;
      },
      z.object({ answers: z.array(z.string().max(4096).nullable()).max(20) }),
    );
  }
}
