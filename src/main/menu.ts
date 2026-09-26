import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { PRESET_IDS } from '@shared/layout-schema';
import type { SettingsService } from './services/settings';
import { copyDiagnosticsToClipboard } from './diagnostics';
import { getLogFolder, scoped } from './log';
import { sendEvent } from './ipc/register';

const logger = scoped('menu');

const PRESET_LABELS: Record<(typeof PRESET_IDS)[number], string> = {
  modelling: 'Modelling',
  materials: 'Materials',
  testing: 'Testing',
};

export function buildAppMenu(opts: { getWindow: () => BrowserWindow | null; settings: SettingsService; isDev: boolean }): void {
  const { getWindow, settings, isDev } = opts;
  const send = (fn: (w: BrowserWindow) => void) => {
    const w = getWindow();
    if (w) fn(w);
  };

  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
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
