/**
 * `window.__jbforgeTest`: run-desktop harness hooks, only installed in dev or
 * harness runs. Several components contribute (app-level, shell); each
 * registration merges in and removes only its own keys.
 */
type Hooks = Record<string, (...args: never[]) => unknown>;

interface TestWindow {
  __jbforgeTest?: Hooks;
}

export function testHooksEnabled(): boolean {
  return window.forge.isDev || window.forge.harness;
}

export function registerTestHooks(hooks: Hooks): () => void {
  if (!testHooksEnabled()) return () => undefined;
  const w = window as unknown as TestWindow;
  w.__jbforgeTest = { ...(w.__jbforgeTest ?? {}), ...hooks };
  return () => {
    const current = w.__jbforgeTest;
    if (!current) return;
    for (const k of Object.keys(hooks)) if (current[k] === hooks[k]) delete current[k];
  };
}
