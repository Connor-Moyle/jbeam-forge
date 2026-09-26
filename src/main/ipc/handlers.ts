import { isAbsolute, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { BrowserWindow, dialog, shell } from 'electron';
import { z } from 'zod';
import { SettingsPatchSchema } from '@shared/settings-schema';
import { StoredLayoutSchema } from '@shared/layout-schema';
import { parseProject } from '@shared/project/io';
import type { SettingsService } from '../services/settings';
import type { LayoutService } from '../services/layout';
import type { BeamngService } from '../beamng/service';
import { atomicWrite } from '../services/atomicWrite';
import { collectDiagnostics, copyDiagnosticsToClipboard } from '../diagnostics';
import { getLogFolder } from '../log';
import { registerInvoke } from './register';

const MAX_EXTRA_CHARS = 20_000;

const ProjectPath = z
  .string()
  .refine((p) => isAbsolute(p), 'project path must be absolute')
  .refine((p) => extname(p).toLowerCase() === '.jbforge', 'project path must end in .jbforge');

export function registerIpcHandlers(services: { settings: SettingsService; layout: LayoutService; beamng: BeamngService }): void {
  const { settings, layout, beamng } = services;

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

  registerInvoke('beamng:detect', () => beamng.detect());
  registerInvoke('beamng:validate', ({ dir }) => beamng.validate(dir), z.object({ dir: z.string().min(1).max(1024) }));

  registerInvoke(
    'dialog:pickDirectory',
    async (req, event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: req?.title ?? 'Choose folder',
        properties: ['openDirectory'],
        ...(req?.defaultPath ? { defaultPath: req.defaultPath } : {}),
      };
      const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return res.canceled ? null : (res.filePaths[0] ?? null);
    },
    z.object({ title: z.string().max(200).optional(), defaultPath: z.string().max(1024).optional() }).optional(),
  );

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
