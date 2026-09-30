import { shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { pickDirectory, pickOpenFile } from '../dialogs';
import { registerInvoke } from '../ipc/register';
import { formatFromPath } from '../import/access';
import type { ProjectFiles } from '../services/projectFiles';
import type { ExtensionFiles } from './files';
import type { ExtensionService } from './service';

const extId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
const path = z.string().min(1).max(4096);

export function registerExtensionHandlers(ext: ExtensionService, files: ExtensionFiles, projects: ProjectFiles): void {
  registerInvoke('extensions:list', () => ext.list());
  registerInvoke('extensions:create', async () => {
    const folder = await ext.create();
    return folder;
  });
  registerInvoke('extensions:install', async (_req, event) => {
    const from = await pickDirectory(event.sender, { title: 'Pick the extension’s folder (with extension.json)' });
    return from ? ext.install(from) : null;
  });
  registerInvoke('extensions:examples', async () => (await ext.examples()).map((e) => ({ ...e, code: null })));
  registerInvoke('extensions:installExample', ({ id }) => ext.installExample(id), z.object({ id: extId }));
  registerInvoke('extensions:reveal', async () => {
    await mkdir(ext.dir, { recursive: true });
    await shell.openPath(ext.dir);
    return undefined;
  });

  // ---- file access for extensions that ask for it (only folders the user picked for them) ----
  registerInvoke(
    'extfs:pickFolder',
    async ({ id, title }, event) => {
      const picked = await pickDirectory(event.sender, { title: title || 'Pick a folder for the extension to read' });
      return picked ? files.grant(id, picked) : null;
    },
    z.object({ id: extId, title: z.string().max(200) }),
  );
  registerInvoke(
    'extfs:pickFile',
    async ({ id, title, extensions }, event) => {
      const picked = await pickOpenFile(event.sender, { title: title || 'Pick a file for the extension to read', properties: ['openFile'], ...(extensions.length ? { filters: [{ name: extensions.map((e) => `.${e}`).join(', '), extensions }] } : {}) });
      if (!picked) return null;
      // A single file: its folder becomes readable (models keep their textures beside them).
      await files.grant(id, picked.replace(/[\\/][^\\/]*$/, ''));
      return picked;
    },
    z.object({ id: extId, title: z.string().max(200), extensions: z.array(z.string().regex(/^[A-Za-z0-9]{1,10}$/)).max(20) }),
  );
  registerInvoke('extfs:folders', ({ id }) => files.folders(id), z.object({ id: extId }));
  registerInvoke('extfs:forget', async ({ id }) => void (await files.revoke(id)), z.object({ id: extId }));
  registerInvoke('extfs:list', ({ id, path: p }) => files.list(id, p), z.object({ id: extId, path }));
  registerInvoke('extfs:read', ({ id, path: p, maxBytes }) => files.read(id, p, maxBytes), z.object({ id: extId, path, maxBytes: z.number().int().positive().optional() }));
  registerInvoke('extfs:zipList', ({ id, path: p }) => files.zipList(id, p), z.object({ id: extId, path }));
  registerInvoke('extfs:zipRead', ({ id, path: p, entry }) => files.zipRead(id, p, entry), z.object({ id: extId, path, entry: z.string().min(1).max(1024) }));
  registerInvoke('extfs:zipExtract', ({ id, path: p, prefixes }) => files.zipExtract(id, p, prefixes), z.object({ id: extId, path, prefixes: z.array(z.string().max(1024)).max(100) }));
  registerInvoke(
    'extfs:writeModel',
    async ({ id, name, files: list }) => {
      const obj = await files.writeModel(id, name, list);
      projects.grantFile(obj);
      return obj;
    },
    z.object({
      id: extId,
      name: z.string().min(1).max(200),
      files: z.array(z.object({ name: z.string().min(1).max(200), text: z.string().max(512 * 1024 * 1024).optional(), bytes: z.instanceof(Uint8Array).optional(), from: path.optional() })).max(2000),
    }),
  );
  registerInvoke(
    'extfs:importable',
    async ({ id, path: p }) => {
      const real = await files.check(id, p);
      const format = formatFromPath(real);
      if (!format) throw new Error('Not a model the app imports (DAE, FBX, OBJ, glTF, GLB, STL, KN5).');
      projects.grantFile(real);
      return { path: real, format };
    },
    z.object({ id: extId, path }),
  );
}
