import log from 'electron-log/renderer';
import type { Logger } from '@shared/logger';

/**
 * Scoped renderer logger. electron-log's preload (injected by main) forwards
 * these to the main-process log file; without it (unit tests) they go to the
 * console only.
 */
export function rlog(scope: string): Logger {
  return log.scope(scope);
}

/**
 * Outside dev, don't echo electron-log output to the DevTools console: main
 * already records renderer console errors, so echoing would log them twice.
 */
export function configureRendererLogging(isDev: boolean): void {
  log.transports.console.level = isDev ? 'silly' : false;
}
