import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { app } from 'electron';
import log from 'electron-log/main';
import type { Logger } from '@shared/logger';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

let debugEnabled = false;

/**
 * Initialise electron-log for main + renderer (SPEC §3.6). Must run after
 * any `app.setPath('userData', …)` override and before windows are created.
 */
export function initLogging(opts: { debug: boolean }): void {
  log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log');
  log.transports.file.maxSize = MAX_LOG_BYTES; // rotates to main.old.log
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}';
  log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}';
  // Injects electron-log's preload into every session so renderer logs reach this file.
  log.initialize({ preload: true, spyRendererConsole: false });
  setDebugLogging(opts.debug);
}

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
  log.transports.file.level = enabled ? 'debug' : 'info';
  log.transports.console.level = enabled ? 'debug' : 'info';
}

export function isDebugLogging(): boolean {
  return debugEnabled;
}

export function scoped(name: string): Logger {
  return log.scope(name);
}

export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}

export function getLogFolder(): string {
  return join(app.getPath('userData'), 'logs');
}

export async function readRecentLogLines(count: number): Promise<string[]> {
  try {
    const text = await readFile(getLogFilePath(), 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

export { log };
