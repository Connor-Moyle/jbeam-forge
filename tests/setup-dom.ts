import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { ForgeApi } from '../src/shared/ipc-contract';

// electron-log's renderer transport needs the Electron preload; tests get a silent fake.
vi.mock('electron-log/renderer', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { default: { ...logger, scope: () => logger, transports: { console: { level: false } } } };
});

// window.forge: every invoke resolves ok(undefined) unless a test overrides it.
const forge: ForgeApi = {
  invoke: vi.fn(() => Promise.resolve({ ok: true, value: undefined })) as unknown as ForgeApi['invoke'],
  on: vi.fn(() => () => undefined),
  harness: false,
  isDev: false,
};
Object.defineProperty(window, 'forge', { value: forge, configurable: true });

// Browser APIs Radix relies on that jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;

afterEach(() => {
  cleanup();
  localStorage.clear();
});
