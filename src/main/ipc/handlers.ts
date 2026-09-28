import { shell } from 'electron';
import { z } from 'zod';
import { SettingsPatchSchema } from '@shared/settings-schema';
import { StoredLayoutSchema } from '@shared/layout-schema';
import { parseProject } from '@shared/project/io';
import { TaxonomyEntrySchema } from '@shared/taxonomy/schema';
import type { SettingsService } from '../services/settings';
import type { UserTaxonomyService } from '../services/userTaxonomy';
import type { MaterialLibraryService } from '../services/materialLibrary';
import type { LibraryItem, ObjectItem } from '@shared/ipc-contract';
import { MaterialDefSchema } from '@shared/materials/schema';
import type { LayoutService } from '../services/layout';
import type { RecentService } from '../services/recent';
import { AccessError, readHistory, withProjectExtension, writeHistory, type ProjectFiles } from '../services/projectFiles';
import type { BeamngService } from '../beamng/service';
import { collectDiagnostics, copyDiagnosticsToClipboard } from '../diagnostics';
import { pickDirectory, pickOpenFile, pickSaveFile, queueHarnessDialogAnswers } from '../dialogs';
import { getLogFolder, scoped } from '../log';
import { assertReadable, formatFromPath, locateSource, MODEL_FILTERS, projectResourceFolders, type FolderTrust } from '../import/access';
import { resolveTextureRefs } from '../import/textures';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { kn5TextureDir } from '../import/kn5Textures';
import { readAcCar } from '../import/acCar';
import type { JbeamObject } from '@shared/jbeam/parse';
import type { UserLibrary } from '../library/userLibrary';
import { checkBundle, ExportError, installUnpacked, writeZip } from '../export/writer';
import { describeError } from '@shared/logger';

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
  /** The bundled material pack (loaded in the background at startup). */
  materialPack: Promise<LibraryItem[]>;
  /** The bundled objects pack. */
  objectPack: Promise<ObjectItem[]>;
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
  const { settings, layout, beamng, recent, projects, windowState, trust, userTaxonomy, materialLibrary, materialPack, objectPack } = services;
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
      const r = await installUnpacked(await modsDir(), bundle);
      lastExport = r.path;
      logger.info(`exported ${bundle.slug} unpacked to ${r.path} (${bundle.files.length} files, ${bundle.copies.length} textures, ${r.bytes} bytes)`);
      return r;
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
      const zip = await writeZip(join(out, `${bundle.slug}_${safeVersion}.zip`), bundle);
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
      const r = await writeZip(picked.toLowerCase().endsWith('.zip') ? picked : `${picked}.zip`, bundle);
      lastExport = r.path;
      logger.info(`exported ${bundle.slug} as ${r.path} (${r.bytes} bytes)`);
      return r;
    },
    ExportBundleSchema,
  );
  registerInvoke(
    'export:saveModel',
    async ({ suggestedName, format, data }, event) => {
      const filters = format === 'glb' ? [{ name: 'glTF binary (.glb)', extensions: ['glb'] }] : [{ name: 'COLLADA (.dae)', extensions: ['dae'] }];
      const picked = await pickSaveFile(event.sender, { title: 'Export model', defaultPath: suggestedName, filters });
      if (!picked) return null;
      const path = picked.toLowerCase().endsWith(`.${format}`) ? picked : `${picked}.${format}`;
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      await writeFile(path, bytes);
      lastExport = path;
      logger.info(`exported model ${path} (${bytes.byteLength} bytes)`);
      return { path, bytes: bytes.byteLength };
    },
    z.object({ suggestedName: z.string().min(1).max(255), format: z.enum(['glb', 'dae']), data: z.union([z.instanceof(Uint8Array), z.string()]) }),
  );
  registerInvoke('export:reveal', () => {
    if (lastExport) shell.showItemInFolder(lastExport);
    return undefined;
  });

  registerInvoke('beamng:detect', () => beamng.detect());
  registerInvoke('beamng:validate', ({ dir }) => beamng.validate(dir), z.object({ dir: z.string().min(1).max(1024) }));

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
    const path = await pickOpenFile(event.sender, { title: 'Open project', filters: PROJECT_FILTERS, properties: ['openFile'] });
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
      const info = await projects.write(path, text);
      await touchRecent(path, info, thumbnail);
      return undefined;
    },
    z.object({ path: z.string().min(1).max(4096), text: z.string(), thumbnail: Thumbnail }),
  );

  registerInvoke(
    'project:saveAs',
    async ({ text, suggestedName, thumbnail }, event) => {
      const chosen = await pickSaveFile(event.sender, { title: 'Save project', defaultPath: suggestedName, filters: PROJECT_FILTERS });
      if (!chosen) return null;
      const path = withProjectExtension(chosen);
      projects.grantFile(path);
      const info = await projects.write(path, text);
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
  registerInvoke('materials:pack', async () => [...(await materialPack), ...services.userLibrary.items.materials]);
  registerInvoke('objects:list', async () => [...(await objectPack), ...services.userLibrary.items.objects]);
  registerInvoke('suspension:catalogue', () => services.userLibrary.items.sets.filter((s) => s.kind === 'suspension'));
  registerInvoke('powertrain:catalogue', () => services.userLibrary.items.sets.filter((s) => s.kind !== 'suspension'));
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
      return { parts, anchors, root: set.part };
    },
    z.object({ id: z.string().min(1).max(300) }),
  );
  const libraryStatus = () => ({ scanning: services.userLibrary.items.scanning, folders: services.userLibrary.items.folders });
  registerInvoke('library:status', libraryStatus);
  registerInvoke('library:rescan', async () => {
    const s = settings.get();
    await services.userLibrary.scan({ materials: s.materialFolders, objects: s.objectFolders, beamngInstall: s.beamngInstallDir });
    return libraryStatus();
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
