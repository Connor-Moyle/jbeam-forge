import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app, shell, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { CONTENT_KINDS, type ContentKind } from '@shared/content/manifest';
import type { ContentInfo } from '@shared/content/types';
import type { Logger } from '@shared/logger';
import type { Settings } from '@shared/settings-schema';
import { registerInvoke, sendEvent } from '../ipc/register';
import type { SettingsService } from '../services/settings';
import { assertRef } from './github';
import { addFolder, addMaterial, addScript, cloneContentRepo, publish, publishStatus } from './publish';
import { MaterialDefSchema } from '@shared/materials/schema';
import { LibraryScriptSchema } from '@shared/lua/types';
import type { Packs } from './packs';
import { type ContentService } from './service';
import { assetRole, compareVersions, type UpdateService } from './updates';

/**
 * Downloads IPC: textures and meshes from their repositories, and app
 * versions from GitHub Releases. The content service is rebuilt when the
 * content folder setting changes.
 */

const Kind = z.enum(CONTENT_KINDS);
const Ids = z.union([z.literal('all'), z.array(z.string().min(1).max(128)).max(50_000)]);

export interface ContentContext {
  settings: SettingsService;
  updates: UpdateService;
  packs: Packs;
  logger: Logger;
  getWindow: () => BrowserWindow | null;
  /** The content service for the current folder (rebuilt on a folder change). */
  content: () => ContentService;
  /** The folder in use, the one wanted, and whether it fell back. */
  where: () => { root: string; preferred: string; fallback: boolean };
  /** Running as the portable exe: its folder. */
  portableDir: string | undefined;
}

/** The repository each kind downloads from. */
export const repoFor = (kind: ContentKind, s: Settings) => ({ textures: s.texturesRepo, meshes: s.meshesRepo, scripts: s.scriptsRepo })[kind];

export function registerContentHandlers(ctx: ContentContext): void {
  const { settings, updates } = ctx;
  const repoOf = (kind: ContentKind, s: Settings = settings.get()) => repoFor(kind, s);
  const send = <E extends 'content:changed' | 'content:progress' | 'updates:progress'>(channel: E, payload: Parameters<typeof sendEvent<E>>[2]) => {
    const w = ctx.getWindow();
    if (w && !w.isDestroyed()) sendEvent(w.webContents, channel, payload);
  };

  registerInvoke('content:info', async (): Promise<ContentInfo> => {
    const c = ctx.content();
    const [textures, meshes, scripts] = await Promise.all([c.status('textures'), c.status('meshes'), c.status('scripts')]);
    return { ...ctx.where(), textures, meshes, scripts };
  });
  registerInvoke('content:manifest', ({ kind, ref }) => ctx.content().manifest(kind, repoOf(kind), ref ?? settings.get().contentBranch), z.object({ kind: Kind, ref: z.string().min(1).max(100).optional() }));
  registerInvoke('content:refs', ({ kind }) => ctx.content().refs(repoOf(kind), settings.get().contentBranch), z.object({ kind: Kind }));
  registerInvoke(
    'content:download',
    ({ kind, ref, ids }) => {
      assertRef(ref);
      return ctx.content().download(kind, repoOf(kind), ref, ids, settings.get().downloadConcurrency);
    },
    z.object({ kind: Kind, ref: z.string().min(1).max(100), ids: Ids }),
  );
  registerInvoke(
    'content:cancel',
    ({ kind }) => {
      ctx.content().cancel(kind);
      return undefined;
    },
    z.object({ kind: Kind }),
  );
  registerInvoke('content:remove', ({ kind, ids }) => ctx.content().remove(kind, ids), z.object({ kind: Kind, ids: Ids }));
  registerInvoke(
    'content:reveal',
    async ({ kind }) => {
      const dir = kind ? ctx.content().dir(kind) : ctx.content().root;
      await mkdir(dir, { recursive: true });
      const err = await shell.openPath(dir);
      if (err) throw new Error(err);
      return undefined;
    },
    z.object({ kind: Kind.optional() }),
  );

  // ---- publishing new content (whoever looks after the download library)
  const repoDir = () => {
    const dir = settings.get().contentRepoDir;
    if (!dir) throw new Error('Choose your copy of the content repository first (Settings → Downloads → Publishing).');
    return dir;
  };
  registerInvoke('publish:status', () => publishStatus(settings.get().contentRepoDir));
  registerInvoke(
    'publish:clone',
    async ({ parent }) => {
      const dir = await cloneContentRepo(parent);
      await settings.update({ contentRepoDir: dir });
      return publishStatus(dir);
    },
    z.object({ parent: z.string().min(1).max(1000) }),
  );
  registerInvoke('publish:addMaterial', ({ name, category, def }) => addMaterial(repoDir(), name, category, def), z.object({ name: z.string().min(1).max(100), category: z.string().max(60), def: MaterialDefSchema }));
  registerInvoke('publish:addScript', ({ entry }) => addScript(repoDir(), entry), z.object({ entry: LibraryScriptSchema }));
  registerInvoke('publish:addFolder', ({ kind, source, category }) => addFolder(repoDir(), kind, source, category), z.object({ kind: Kind, source: z.string().min(1).max(1000), category: z.string().min(1).max(60) }));
  registerInvoke('publish:push', ({ message }) => publish(repoDir(), message), z.object({ message: z.string().max(500) }));
  registerInvoke('publish:reveal', async () => {
    const err = await shell.openPath(repoDir());
    if (err) throw new Error(err);
    return undefined;
  });

  registerInvoke('updates:info', async () => {
    const s = settings.get();
    const [releases, downloaded] = await Promise.all([updates.releases(s.appRepo, s.includePrereleases), updates.downloaded()]);
    return { current: app.getVersion(), portable: !!ctx.portableDir, platform: process.platform, releases, downloaded };
  });
  registerInvoke(
    'updates:download',
    ({ tag, asset }) => updates.download(settings.get().appRepo, tag, asset, (done, total) => send('updates:progress', { asset, done, total })),
    z.object({ tag: z.string().min(1).max(60), asset: z.string().min(1).max(200) }),
  );
  registerInvoke('updates:cancel', () => {
    updates.cancel();
    return undefined;
  });
  registerInvoke(
    'updates:run',
    async ({ asset }) => {
      // Checked against the release right before it runs: size and SHA-256.
      const path = await updates.verifyDownloaded(settings.get().appRepo, asset);
      const role = assetRole(asset);
      if (role === 'installer' && process.platform === 'win32') {
        const err = await shell.openPath(path);
        if (err) throw new Error(err);
        // The installer replaces this app: close so it can (the unsaved-work guard still asks first).
        setTimeout(() => app.quit(), 1500);
        return 'installing' as const;
      }
      // A portable exe goes next to the one running, when that folder can be written; then it's shown.
      let shown = path;
      if (role === 'portable' && ctx.portableDir) {
        const beside = join(ctx.portableDir, asset);
        try {
          await copyFile(path, beside);
          shown = beside;
        } catch {
          // read-only folder: show the downloaded copy instead
        }
      }
      shell.showItemInFolder(shown);
      return 'shown' as const;
    },
    z.object({ asset: z.string().min(1).max(200) }),
  );
  registerInvoke('updates:clear', async () => {
    await updates.clear();
    return undefined;
  });
  registerInvoke('app:revealSettings', () => {
    shell.showItemInFolder(settings.path);
    return undefined;
  });
}

/** On startup: say when a newer app version (or content) is out. Quiet on any failure. */
export async function checkOnStartup(ctx: ContentContext, notify: (text: string) => void): Promise<void> {
  const s = ctx.settings.get();
  if (!s.checkUpdatesOnStartup) return;
  try {
    const releases = await ctx.updates.releases(s.appRepo, s.includePrereleases);
    const newest = releases[0];
    if (newest && compareVersions(newest.version, app.getVersion()) > 0) notify(`JBeam Forge ${newest.version} is out. Open Downloads to get it.`);
  } catch (err) {
    ctx.logger.info('update check skipped:', err instanceof Error ? err.message : String(err));
  }
  for (const kind of CONTENT_KINDS) {
    try {
      const c = ctx.content();
      const installed = await c.installed(kind);
      // Only items that follow the latest content (not ones picked from an older version).
      const following = new Set(Object.entries(installed.items).flatMap(([id, it]) => ((it.ref ?? installed.ref) === s.contentBranch ? [id] : [])));
      if (!following.size) continue;
      const manifest = await c.manifest(kind, repoFor(kind, s), s.contentBranch);
      const updated = (await c.changes(kind, manifest)).updated.filter((id) => following.has(id));
      const versions = new Set([...following].map((id) => installed.items[id]!.version ?? installed.version));
      const added = versions.has(manifest.version) ? 0 : manifest.items.filter((i) => !installed.items[i.id]).length;
      if (updated.length || added) notify(`New ${kind} are available (${updated.length} updated, ${added} not downloaded). Open Downloads to get them.`);
    } catch (err) {
      ctx.logger.info(`${kind} check skipped:`, err instanceof Error ? err.message : String(err));
    }
  }
}

export function contentHooks(ctx: Pick<ContentContext, 'packs' | 'getWindow'>) {
  const send = <E extends 'content:changed' | 'content:progress'>(channel: E, payload: Parameters<typeof sendEvent<E>>[2]) => {
    const w = ctx.getWindow();
    if (w && !w.isDestroyed()) sendEvent(w.webContents, channel, payload);
  };
  return {
    onChange: (kind: ContentKind) => {
      ctx.packs.reload(kind);
      send('content:changed', { kind });
    },
    onProgress: (p: Parameters<typeof sendEvent<'content:progress'>>[2]) => send('content:progress', p),
  };
}
