import { isWorkerLogMessage } from '@workers/logBridge';
import type { Logger } from '@shared/logger';
import { rlog } from './logger';

/**
 * Forward a worker's log records to electron-log and log worker-level
 * failures (script load errors, messageerror). Every Worker the app creates
 * must go through this. Returns a detach function.
 */
export function attachWorkerLogRelay(worker: Worker, name: string, loggerFor: (scope: string) => Logger = rlog): () => void {
  const fallback = loggerFor(`worker:${name}`);
  const onMessage = (e: MessageEvent) => {
    if (!isWorkerLogMessage(e.data)) return;
    e.stopImmediatePropagation(); // log records are not app messages
    loggerFor(e.data.scope)[e.data.level](e.data.text);
  };
  const onError = (e: ErrorEvent) => fallback.error('worker error:', e.message, `${e.filename}:${e.lineno}`);
  const onMessageError = () => fallback.error('worker messageerror (unclonable payload)');
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onMessageError);
  return () => {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onMessageError);
  };
}

/** Harness: spawn the smoke worker, have it log, then trigger an unhandled rejection. */
export function runSmokeWorker(): Promise<void> {
  const worker = new Worker(new URL('../../workers/smoke.worker.ts', import.meta.url), { type: 'module' });
  attachWorkerLogRelay(worker, 'smoke');
  return new Promise((resolve) => {
    worker.addEventListener('message', (e: MessageEvent<{ done?: boolean }>) => {
      if (!e.data.done) return;
      worker.postMessage({ cmd: 'reject' });
      setTimeout(() => {
        worker.terminate();
        resolve();
      }, 200);
    });
    worker.postMessage({ cmd: 'hello' });
  });
}
