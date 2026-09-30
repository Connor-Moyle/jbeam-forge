import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { PRESET_IDS } from '@shared/layout-schema';
import type { AppCommand } from '@shared/ipc-contract';
import type { SettingsService } from './services/settings';
import { copyDiagnosticsToClipboard } from './diagnostics';
import { getLogFolder, scoped } from './log';
import { sendEvent } from './ipc/register';
import { effectiveKeymap, toAccelerator } from '@shared/keymap';

const logger = scoped('menu');

const PRESET_LABELS: Record<(typeof PRESET_IDS)[number], string> = {
  modelling: 'Editing',
  model: 'Modelling',
  jbeam: 'JBeam',
  moving: 'Moving Parts',
  triggers: 'Triggers',
  engine: 'Engine',
  tyres: 'Tyre Builder',
  wheels: 'Wheel Builder',
  panel: 'Panel Builder',
  materials: 'Materials',
  testing: 'Testing',
  scripts: 'Scripts',
};

export function buildAppMenu(opts: { getWindow: () => BrowserWindow | null; settings: SettingsService; isDev: boolean }): void {
  const { getWindow, settings, isDev } = opts;
  const send = (fn: (w: BrowserWindow) => void) => {
    const w = getWindow();
    if (w) fn(w);
  };

  const command = (cmd: AppCommand) => () => send((w) => sendEvent(w.webContents, 'menu:command', { command: cmd }));
  // Settings → Keymap: the user's keys (undefined = none).
  const keys = effectiveKeymap(settings.get().keymap);
  const key = (id: string) => toAccelerator(keys[id] ?? '');

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Mod…', accelerator: key('new'), click: command('new') },
        { label: 'Open…', accelerator: key('open'), click: command('open') },
        { type: 'separator' },
        { label: 'Import Model…', accelerator: key('import'), click: command('import') },
        { label: 'Import Assetto Corsa Car…', click: command('importAc') },
        { type: 'separator' },
        { label: 'Save', accelerator: key('save'), click: command('save') },
        { label: 'Save As…', accelerator: key('saveAs'), click: command('saveAs') },
        { type: 'separator' },
        {
          label: 'Export Model',
          submenu: [
            { label: 'glTF binary (.glb) — for Blender…', click: command('exportModelGlb') },
            { label: 'COLLADA (.dae) — BeamNG-ready…', click: command('exportModelDae') },
          ],
        },
        { type: 'separator' },
        { label: 'Settings…', accelerator: key('settings'), click: command('settings') },
        { label: 'Downloads…', accelerator: key('downloads'), click: command('downloads') },
        { type: 'separator' },
        { label: 'Close Project', click: command('close') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      // Custom undo/redo: the renderer routes them to text fields or to the document history.
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: key('undo'), click: command('undo') },
        { label: 'Redo', accelerator: key('redo'), click: command('redo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: command('redo'), visible: false },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // In edit mode this selects every node; in text fields it selects the text.
        { label: 'Select All', accelerator: key('selectAll'), click: command('selectAll') },
        { type: 'separator' },
        { label: 'Command Palette…', accelerator: key('palette'), click: command('palette') },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Layout Preset',
          submenu: PRESET_IDS.map((preset) => ({
            label: PRESET_LABELS[preset],
            click: () => send((w) => sendEvent(w.webContents, 'menu:applyPreset', { preset })),
          })),
        },
        {
          label: 'Reset Layout',
          click: () => send((w) => sendEvent(w.webContents, 'menu:resetLayout', undefined)),
        },
        { type: 'separator' },
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' } as const] : []),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Help and Guides', accelerator: key('help'), click: command('help') },
        { label: 'Start the Tutorial', click: command('tutorial') },
        { label: 'Keyboard Shortcuts', accelerator: key('shortcuts'), click: command('shortcuts') },
        { type: 'separator' },
        {
          label: 'Open Log Folder',
          click: () => {
            void shell.openPath(getLogFolder()).then((err) => {
              if (err) logger.error('open log folder failed:', err);
            });
          },
        },
        {
          label: 'Copy Diagnostic Info',
          click: () => {
            copyDiagnosticsToClipboard().catch((err: unknown) => logger.error('copy diagnostics failed:', err));
          },
        },
        {
          label: 'Debug Logging',
          type: 'checkbox',
          checked: settings.get().debugLogging,
          click: (item) => {
            settings.update({ debugLogging: item.checked }).catch((err: unknown) => {
              logger.error('toggle debug failed:', err);
              item.checked = settings.get().debugLogging; // Electron already flipped it; show the saved value
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
