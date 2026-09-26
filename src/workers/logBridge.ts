/**
 * Worker-side logging (SPEC §3.6). electron-log cannot run inside a Web
 * Worker, so workers post structured log records to the thread that owns
 * them; `attachWorkerLogRelay` (renderer) forwards them to electron-log.
 */
import { describeError, type Logger } from '@shared/logger';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WorkerLogMessage {
  __jbforgeLog: 1;
  level: LogLevel;
  scope: string;
  text: string;
}

export function isWorkerLogMessage(data: unknown): data is WorkerLogMessage {
  return typeof data === 'object' && data !== null && (data as { __jbforgeLog?: unknown }).__jbforgeLog === 1;
}

/** Structured-clone-safe rendering of log arguments. */
export function formatLogArgs(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) {
        const { message, stack } = describeError(a);
        return stack ?? message;
      }
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

type Post = (msg: WorkerLogMessage) => void;

const defaultPost: Post = (msg) => (globalThis as unknown as { postMessage(m: unknown): void }).postMessage(msg);

export function createWorkerLogger(scope: string, post: Post = defaultPost): Logger {
  const emit = (level: LogLevel) => (...args: unknown[]) => post({ __jbforgeLog: 1, level, scope, text: formatLogArgs(args) });
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** Route a worker's uncaught errors and rejections through its logger. */
export function installWorkerErrorHandlers(logger: Logger, target: EventTarget = globalThis): void {
  target.addEventListener('error', (e) => {
    const ev = e as ErrorEvent;
    logger.error('uncaught:', ev.error ?? ev.message);
  });
  target.addEventListener('unhandledrejection', (e) => {
    logger.error('unhandledrejection:', (e as PromiseRejectionEvent).reason);
  });
}
