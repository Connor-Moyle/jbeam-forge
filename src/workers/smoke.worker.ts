/// <reference lib="webworker" />
/**
 * Diagnostics smoke worker: proves worker logs and uncaught worker errors
 * reach main.log. Spawned only by the run-desktop harness.
 */
import { createWorkerLogger, installWorkerErrorHandlers } from './logBridge';

const logger = createWorkerLogger('worker:smoke');
installWorkerErrorHandlers(logger);

self.addEventListener('message', (e: MessageEvent<{ cmd: 'hello' | 'reject' }>) => {
  if (e.data.cmd === 'hello') {
    logger.info('smoke worker online');
    self.postMessage({ done: true });
  } else if (e.data.cmd === 'reject') {
    void Promise.reject(new Error('[harness-triggered] smoke worker rejection'));
  }
});
