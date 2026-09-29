import { shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import { pickDirectory } from '../dialogs';
import { registerInvoke } from '../ipc/register';
import type { ExtensionService } from './service';

export function registerExtensionHandlers(ext: ExtensionService): void {
  registerInvoke('extensions:list', () => ext.list());
  registerInvoke('extensions:create', async () => {
    const folder = await ext.create();
    return folder;
  });
  registerInvoke('extensions:install', async (_req, event) => {
    const from = await pickDirectory(event.sender, { title: 'Pick the extension’s folder (with extension.json)' });
    return from ? ext.install(from) : null;
  });
  registerInvoke('extensions:reveal', async () => {
    await mkdir(ext.dir, { recursive: true });
    await shell.openPath(ext.dir);
    return undefined;
  });
}
