import type { SandboxInput, SandboxResult } from '@shared/lua/sandbox';
import { attachWorkerLogRelay } from '@renderer/diagnostics/workerRelay';

/**
 * Runs a script test in its worker. A test that takes too long is stopped by
 * ending the worker (a fresh one serves the next test).
 */
let worker: Worker | null = null;
let detach: (() => void) | null = null;
let seq = 0;

function ensure(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/luaSandbox.worker.ts', import.meta.url), { type: 'module' });
    detach = attachWorkerLogRelay(worker, 'lua');
  }
  return worker;
}

function kill(): void {
  detach?.();
  worker?.terminate();
  worker = null;
  detach = null;
}

export function runScriptTest(input: SandboxInput, timeoutMs = 15_000): Promise<SandboxResult> {
  const w = ensure();
  const id = ++seq;
  return new Promise((resolve) => {
    const done = (r: SandboxResult) => {
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(r);
    };
    const onMessage = (e: MessageEvent<{ id: number; result?: SandboxResult }>) => {
      if (e.data?.id === id && e.data.result) done(e.data.result);
    };
    const timer = setTimeout(() => {
      kill();
      done({ ok: false, error: { message: 'The test took too long and was stopped.', line: null, at: null }, times: [], series: {}, inputs: {}, log: [], sounds: {}, hooks: [] });
    }, timeoutMs);
    w.addEventListener('message', onMessage);
    w.postMessage({ id, input });
  });
}
