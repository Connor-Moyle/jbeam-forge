import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview-react';
import { PRESET_IDS } from '../../src/shared/layout-schema';
import { PANELS, isPanelId } from '../../src/renderer/shell/panelRegistry';
import { PRESETS, applyPreset, togglePanel } from '../../src/renderer/shell/presets';
import { isRestorable } from '../../src/renderer/shell/ShellContext';
import { useUiStore } from '../../src/renderer/app/stores/ui';
import { numericToken } from '../../src/renderer/ui/tokens';

/** Minimal DockviewApi fake recording panel operations. */
function fakeApi() {
  const panels = new Map<string, { id: string; api: { isActive: boolean; close: () => void; setActive: () => void } }>();
  const added: { id: string; position?: unknown; initialWidth?: number }[] = [];
  const api = {
    clear: vi.fn(() => panels.clear()),
    getPanel: (id: string) => panels.get(id),
    addPanel: vi.fn((opts: { id: string; position?: unknown; initialWidth?: number }) => {
      added.push(opts);
      const p = {
        id: opts.id,
        api: { isActive: false, close: () => panels.delete(opts.id), setActive: vi.fn(() => (p.api.isActive = true)) },
      };
      panels.set(opts.id, p);
      return p;
    }),
    get panels() {
      return [...panels.values()];
    },
  };
  return { api: api as unknown as DockviewApi, raw: api, added };
}

describe('presets', () => {
  it('cover every preset id and only reference registered, non-dev panels', () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_IDS].sort());
    for (const placements of Object.values(PRESETS)) {
      const seen = new Set<string>();
      placements.forEach((p, i) => {
        expect(isPanelId(p.id)).toBe(true);
        expect('devOnly' in PANELS[p.id]).toBe(false);
        if (i === 0) expect(p.relativeTo).toBeUndefined();
        else expect(seen.has(p.relativeTo ?? '')).toBe(true); // anchors must already exist
        seen.add(p.id);
      });
    }
  });

  it('applyPreset clears and builds the layout with token-derived widths', () => {
    const { api, raw, added } = fakeApi();
    applyPreset(api, 'modelling');
    expect(raw.clear).toHaveBeenCalled();
    expect(added.map((a) => a.id)).toEqual(['viewport', 'scene', 'inspector']);
    expect(added[1]?.position).toEqual({ referencePanel: 'viewport', direction: 'left' });
    expect(added[1]?.initialWidth).toBe(numericToken('size-side-panel'));
  });

  it('togglePanel adds a closed panel, focuses an inactive one, closes an active one', () => {
    const { api, raw } = fakeApi();
    applyPreset(api, 'modelling');
    togglePanel(api, 'kit-gallery');
    expect(raw.getPanel('kit-gallery')).toBeDefined();
    const panel = raw.getPanel('kit-gallery')!;
    panel.api.isActive = false;
    togglePanel(api, 'kit-gallery');
    expect(panel.api.setActive).toHaveBeenCalled();
    togglePanel(api, 'kit-gallery');
    expect(raw.getPanel('kit-gallery')).toBeUndefined();
  });
});

describe('isRestorable', () => {
  const layout = (components: string[]) => ({
    version: 1 as const,
    preset: 'modelling' as const,
    dockview: {
      grid: { root: {} },
      panels: Object.fromEntries(components.map((c) => [c, { id: c, contentComponent: c }])),
    },
  });

  it('accepts known panels', () => {
    expect(isRestorable(layout(['viewport', 'scene']), false)).toBe(true);
  });

  it('rejects unknown panels (e.g. from a newer build)', () => {
    expect(isRestorable(layout(['viewport', 'future-panel']), false)).toBe(false);
  });

  it('rejects dev-only panels outside dev mode', () => {
    expect(isRestorable(layout(['kit-gallery']), false)).toBe(false);
    expect(isRestorable(layout(['kit-gallery']), true)).toBe(true);
  });
});

describe('ui store', () => {
  afterEach(() => {
    vi.useRealTimers();
    useUiStore.setState({ collapsed: {}, status: null });
  });

  it('setCollapsed keeps the same reference when nothing changes (stable selectors)', () => {
    useUiStore.getState().setCollapsed('a', true);
    const before = useUiStore.getState().collapsed;
    useUiStore.getState().setCollapsed('a', true);
    expect(useUiStore.getState().collapsed).toBe(before);
  });

  it('persists collapsed state but not transient status', () => {
    useUiStore.getState().setCollapsed('sec', true);
    useUiStore.getState().pushStatus('hi');
    const stored = JSON.parse(localStorage.getItem('jbforge.ui') ?? '{}') as { state: Record<string, unknown> };
    expect(stored.state).toEqual({ collapsed: { sec: true } });
  });

  it('status messages expire, and a newer message is not cleared by an older timer', () => {
    vi.useFakeTimers();
    const { pushStatus } = useUiStore.getState();
    pushStatus('first', 'info', 1000);
    vi.advanceTimersByTime(500);
    pushStatus('second', 'success', 1000);
    vi.advanceTimersByTime(600);
    expect(useUiStore.getState().status?.text).toBe('second');
    vi.advanceTimersByTime(500);
    expect(useUiStore.getState().status).toBeNull();
  });
});
