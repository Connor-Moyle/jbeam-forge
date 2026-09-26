import { describeError } from '@shared/logger';
import { rlog } from './logger';

const logger = rlog('renderer');
const MAX_RECENT = 20;
const recent: string[] = [];

function remember(line: string): void {
  recent.push(`${new Date().toISOString()} ${line}`);
  if (recent.length > MAX_RECENT) recent.shift();
}

/** Recent renderer errors, included in copied diagnostics. */
export function recentRendererErrors(): readonly string[] {
  return recent;
}

export function reportError(context: string, err: unknown, extra?: string): void {
  const { message, stack } = describeError(err);
  remember(`${context}: ${message}`);
  logger.error(`${context}:`, message, stack ?? '', extra ?? '');
}

let installed = false;

/** window.onerror + unhandledrejection → electron-log (SPEC §3.6). */
export function installGlobalHandlers(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (event) => {
    reportError('window.onerror', event.error ?? event.message, `${event.filename}:${event.lineno}:${event.colno}`);
  });
  target.addEventListener('unhandledrejection', (event) => {
    reportError('unhandledrejection', event.reason);
  });
}
