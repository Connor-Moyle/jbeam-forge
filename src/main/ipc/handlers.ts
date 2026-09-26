import { isAbsolute, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { shell } from 'electron';
import { z } from 'zod';
import { SettingsPatchSchema } from '@shared/settings-schema';
import { StoredLayoutSchema } from '@shared/layout-schema';
import { parseProject } from '@shared/project/io';
import type { SettingsService } from '../services/settings';
import type { LayoutService } from '../services/layout';
import { atomicWrite } from '../services/atomicWrite';
import { collectDiagnostics, copyDiagnosticsToClipboard } from '../diagnostics';
import { getLogFolder } from '../log';
import { registerInvoke } from './register';

const MAX_EXTRA_CHARS = 20_000;

const ProjectPath = z
  .string()
  .refine((p) => isAbsolute(p), 'project path must be absolute')
  .refine((p) => extname(p).toLowerCase() === '.jbforge', 'project path must end in .jbforge');

export function registerIpcHandlers(services: { settings: SettingsService; layout: LayoutService }): void {
  const { settings, layout } = services;

  registerInvoke('settings:get', () => settings.get());
  registerInvoke('settings:update', (patch) => settings.update(patch), SettingsPatchSchema);

  registerInvoke('layout:load', () => layout.load());
  registerInvoke('layout:save', async (req) => {
    await layout.save(req);
    return undefined;
  }, StoredLayoutSchema);

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

  // Paths come from native dialogs once the project UI lands (Phase 3); until
  // then these are constrained to absolute *.jbforge paths.
  registerInvoke(
    'project:read',
    async ({ path }) => ({ path, text: await readFile(path, 'utf8') }),
    z.object({ path: ProjectPath }),
  );
  registerInvoke(
    'project:write',
    async ({ path, text }) => {
      parseProject(text); // never write a document we could not load back
      await atomicWrite(path, text);
      return undefined;
    },
    z.object({ path: ProjectPath, text: z.string() }),
  );
}
