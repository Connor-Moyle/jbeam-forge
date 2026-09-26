import { shell } from 'electron';
import { z } from 'zod';
import { SettingsPatchSchema } from '@shared/settings-schema';
import { StoredLayoutSchema } from '@shared/layout-schema';
import { parseProject } from '@shared/project/io';
import type { SettingsService } from '../services/settings';
import type { LayoutService } from '../services/layout';
import type { RecentService } from '../services/recent';
import { AccessError, withProjectExtension, type ProjectFiles } from '../services/projectFiles';
import type { BeamngService } from '../beamng/service';
import { collectDiagnostics, copyDiagnosticsToClipboard } from '../diagnostics';
import { pickDirectory, pickOpenFile, pickSaveFile, queueHarnessDialogAnswers } from '../dialogs';
import { getLogFolder, scoped } from '../log';
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
  harness: boolean;
}

/** Name/slug for the recent list, or null when the file doesn't load (it isn't added). */
function describeProject(text: string): { name: string; slug: string } | null {
  try {
    const { project } = parseProject(text);
    return { name: project.meta.name, slug: project.meta.slug };
  } catch {
    return null;
  }
}

export function registerIpcHandlers(services: HandlerServices): void {
  const { settings, layout, beamng, recent, projects, windowState } = services;

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
    projects.grantFile(path);
    await touchRecent(path, describeProject(text));
    return { path, text };
  });

  registerInvoke(
    'project:openRecent',
    async ({ path }) => {
      if (!recent.has(path)) throw new AccessError('Not in the recent projects list');
      const text = await projects.read(path);
      projects.grantFile(path);
      await touchRecent(path, describeProject(text));
      return { path, text };
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
