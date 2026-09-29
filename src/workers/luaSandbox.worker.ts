/// <reference lib="webworker" />
/**
 * Vehicle script test runner worker (fork): runs a script in a Lua VM off
 * the UI thread, so a slow or endless script can't freeze the app (the
 * page can also terminate this worker outright).
 */
import { runSandbox, type SandboxInput, type SandboxResult } from '@shared/lua/sandbox';
import { createWorkerLogger, installWorkerErrorHandlers } from './logBridge';

const logger = createWorkerLogger('worker:lua');
installWorkerErrorHandlers(logger);

self.addEventListener('message', (e: MessageEvent<{ id: number; input: SandboxInput }>) => {
  const { id, input } = e.data;
  const started = performance.now();
  const result: SandboxResult = runSandbox(input);
  logger.debug(`script test ${Math.round(performance.now() - started)} ms, ok ${result.ok}`);
  (self as unknown as Worker).postMessage({ id, result });
});
