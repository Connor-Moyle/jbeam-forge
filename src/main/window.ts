import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session, shell } from 'electron';
import { WINDOW_BACKGROUND } from '@shared/window-chrome';
import { scoped } from './log';

const logger = scoped('window');

export interface WindowOptions {
  devServerUrl: string | undefined;
  harness: boolean;
  /** Initial size (and position, when remembered) from the display settings. */
  bounds?: { x?: number; y?: number; width: number; height: number };
}

export function rendererIndexUrl(): string {
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href;
}

/** True when `url` is our renderer (dev server origin or the packaged index.html). */
export function makeTrustedUrlPredicate(devServerUrl: string | undefined): (url: string) => boolean {
  if (devServerUrl) {
    const origin = new URL(devServerUrl).origin;
    return (url) => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    };
  }
  const index = rendererIndexUrl();
  return (url) => url.split(/[?#]/)[0] === index;
}

export function hardenSessions(): void {
  // No web permissions (camera, notifications, …) are ever needed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    logger.warn('denied permission request:', permission);
    cb(false);
  });
}

export function createMainWindow(opts: WindowOptions): BrowserWindow {
  const isTrusted = makeTrustedUrlPredicate(opts.devServerUrl);
  const args: string[] = [];
  if (opts.harness) args.push('--jbforge-harness');
  if (opts.devServerUrl) args.push('--jbforge-dev');

  const win = new BrowserWindow({
    width: opts.bounds?.width ?? 1440,
    height: opts.bounds?.height ?? 900,
    ...(opts.bounds?.x !== undefined && opts.bounds.y !== undefined ? { x: opts.bounds.x, y: opts.bounds.y } : {}),
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'JBeam Forge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: args,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    else logger.warn('blocked window.open:', url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrusted(url)) {
      logger.warn('blocked navigation:', url);
      event.preventDefault();
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error('renderer failed to load:', code, desc, url);
  });

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') logger.error('renderer console:', event.message, `${event.sourceId}:${event.lineNumber}`);
  });

  if (opts.devServerUrl) void win.loadURL(opts.devServerUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  return win;
}
