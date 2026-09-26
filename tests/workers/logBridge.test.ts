import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/shared/logger';
import {
  createWorkerLogger,
  formatLogArgs,
  installWorkerErrorHandlers,
  isWorkerLogMessage,
  type WorkerLogMessage,
} from '../../src/workers/logBridge';
import { attachWorkerLogRelay } from '../../src/renderer/diagnostics/workerRelay';

type MockLogger = { [K in keyof Logger]: ReturnType<typeof vi.fn> };

function mockLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function recordingLoggers() {
  const byScope = new Map<string, MockLogger>();
  const loggerFor = (scope: string): Logger => {
    let l = byScope.get(scope);
    if (!l) byScope.set(scope, (l = mockLogger()));
    return l as unknown as Logger;
  };
  return { byScope, loggerFor, get: (scope: string) => loggerFor(scope) as unknown as MockLogger };
}

const fakeWorker = () => new EventTarget() as unknown as Worker;
const record = (over: Partial<WorkerLogMessage> = {}): WorkerLogMessage => ({ __jbforgeLog: 1, level: 'info', scope: 'worker:solver', text: 'hello', ...over });

describe('isWorkerLogMessage', () => {
  it('recognises only tagged records', () => {
    expect(isWorkerLogMessage(record())).toBe(true);
    for (const v of [null, undefined, {}, { __jbforgeLog: 2 }, 'x', 1]) expect(isWorkerLogMessage(v)).toBe(false);
  });
});

describe('formatLogArgs', () => {
  it('joins strings and JSON-encodes values', () => {
    expect(formatLogArgs(['a', 'b', { n: 1 }, 2])).toBe('a b {"n":1} 2');
  });

  it('renders Errors with their stack', () => {
    const text = formatLogArgs([new Error('kaput')]);
    expect(text).toContain('kaput');
    expect(text).toContain('Error');
  });

  it('survives circular values', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => formatLogArgs([o])).not.toThrow();
  });
});

describe('createWorkerLogger', () => {
  it('posts one tagged record per call, per level', () => {
    const post = vi.fn();
    const log = createWorkerLogger('worker:solver', post);
    log.debug('d');
    log.info('i', 1);
    log.warn('w');
    log.error('e');
    expect(post.mock.calls.map((c) => c[0] as WorkerLogMessage)).toEqual([
      record({ level: 'debug', text: 'd' }),
      record({ level: 'info', text: 'i 1' }),
      record({ level: 'warn', text: 'w' }),
      record({ level: 'error', text: 'e' }),
    ]);
  });
});

describe('installWorkerErrorHandlers', () => {
  it('logs uncaught errors and unhandled rejections', () => {
    const target = new EventTarget();
    const log = mockLogger();
    installWorkerErrorHandlers(log as unknown as Logger, target);
    const err = new Error('x');
    target.dispatchEvent(new ErrorEvent('error', { error: err, message: 'x' }));
    expect(log.error).toHaveBeenCalledWith('uncaught:', err);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'r' }));
    expect(log.error).toHaveBeenCalledWith('unhandledrejection:', 'r');
  });
});

describe('attachWorkerLogRelay', () => {
  it('forwards log records by scope/level and hides them from app listeners', () => {
    const worker = fakeWorker();
    const loggers = recordingLoggers();
    attachWorkerLogRelay(worker, 'solver', loggers.loggerFor);
    const appListener = vi.fn();
    worker.addEventListener('message', appListener);

    worker.dispatchEvent(new MessageEvent('message', { data: record({ level: 'warn', text: 'unstable node' }) }));
    expect(loggers.get('worker:solver').warn).toHaveBeenCalledWith('unstable node');
    expect(appListener).not.toHaveBeenCalled();

    worker.dispatchEvent(new MessageEvent('message', { data: { x: 1 } }));
    expect(appListener).toHaveBeenCalledTimes(1);
  });

  it('logs worker-level errors under worker:<name>', () => {
    const worker = fakeWorker();
    const loggers = recordingLoggers();
    attachWorkerLogRelay(worker, 'solver', loggers.loggerFor);
    worker.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'w.js', lineno: 3 }));
    expect(loggers.get('worker:solver').error).toHaveBeenCalledWith('worker error:', 'boom', 'w.js:3');
  });

  it('detach stops forwarding', () => {
    const worker = fakeWorker();
    const loggers = recordingLoggers();
    const detach = attachWorkerLogRelay(worker, 'solver', loggers.loggerFor);
    detach();
    worker.dispatchEvent(new MessageEvent('message', { data: record() }));
    expect(loggers.byScope.get('worker:solver')?.info ?? vi.fn()).not.toHaveBeenCalled();
  });
});
