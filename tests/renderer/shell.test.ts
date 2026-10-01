import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview-react';
import { LAYOUT_VERSION, PRESET_IDS } from '../../src/shared/layout-schema';
import { PANELS, isPanelId } from '../../src/renderer/shell/panelRegistry';
import { PRESETS, applyPreset, isPanelShown, showPanel, togglePanel } from '../../src/renderer/shell/presets';
import { PROPERTY_TABS } from '../../src/renderer/shell/propertyTabs';
import { isRestorable } from '../../src/renderer/shell/ShellContext';
import { useUiStore } from '../../src/renderer/app/stores/ui';
import { numericToken } from '../../src/renderer/ui/tokens';

/** Minimal DockviewApi fake recording panel operations. */
function fakeApi() {
  const panels = new Map<string, { id: string; api: { isActive: boolean; close: () => void; setActive: () => void }; group: { api: { setSize: (s: { width?: number }) => void } } }>();
  const added: { id: string; position?: unknown; initialWidth?: number; initialHeight?: number }[] = [];
  const sized: { id: string; width?: number }[] = [];
  const api = {
    clear: vi.fn(() => panels.clear()),
    getPanel: (id: string) => panels.get(id),
    addPanel: vi.fn((opts: { id: string; position?: unknown; initialWidth?: number }) => {
      added.push(opts);
      const p = {
        id: opts.id,
        api: { isActive: false, close: () => panels.delete(opts.id), setActive: vi.fn(() => (p.api.isActive = true)) },
        group: { api: { setSize: (size: { width?: number }) => void sized.push({ id: opts.id, ...size }) } },
      };
      panels.set(opts.id, p);
      return p;
    }),
    get panels() {
      return [...panels.values()];
    },
  };
  return { api: api as unknown as DockviewApi, raw: api, added, sized };
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
    const { api, raw, added, sized } = fakeApi();
    applyPreset(api, 'modelling');
    // Widths are set again once every panel is in, so a later panel can't squeeze an earlier one.
    expect(sized).toEqual([
      { id: 'scene', width: numericToken('size-side-panel') },
      { id: 'properties', width: numericToken('size-props') },
    ]);
    expect(raw.clear).toHaveBeenCalled();
    expect(added.map((a) => a.id)).toEqual(['viewport', 'scene', 'properties']);
    expect(useUiStore.getState().propsTab).toBe('inspector');
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

  it('tools of the Properties column open as its tabs, never as panels of their own', () => {
    const { api, raw, added, sized } = fakeApi();
    applyPreset(api, 'modelling');
    for (const tab of PROPERTY_TABS) {
      showPanel(api, tab);
      expect(useUiStore.getState().propsTab).toBe(tab);
      expect(isPanelShown(api, tab)).toBe(true);
    }
    expect(added.map((a) => a.id)).toEqual(['viewport', 'scene', 'properties']);
    // The column widens for a tool that needs the room (the engine designer).
    expect(sized).toContainEqual({ id: 'properties', width: numericToken('size-props-xl') });
    // Picking the tab that's showing goes back to the Inspector; the Inspector itself stays.
    showPanel(api, 'suspension');
    togglePanel(api, 'suspension');
    expect(useUiStore.getState().propsTab).toBe('inspector');
    togglePanel(api, 'inspector');
    expect(useUiStore.getState().propsTab).toBe('inspector');
    expect(raw.getPanel('properties')).toBeDefined();
  });

  it('a Properties tool opens the column when the workspace has none', () => {
    const { api, raw } = fakeApi();
    applyPreset(api, 'jbeam');
    expect(raw.getPanel('properties')).toBeUndefined();
    showPanel(api, 'materials');
    expect(raw.getPanel('properties')).toBeDefined();
    expect(useUiStore.getState().propsTab).toBe('materials');
  });

  it('output panels open under the 3D view and share one strip', () => {
    const { api, added } = fakeApi();
    applyPreset(api, 'modelling');
    togglePanel(api, 'jbeam-preview');
    togglePanel(api, 'test-results');
    expect(added.at(-2)?.position).toEqual({ referencePanel: 'viewport', direction: 'below' });
    expect(added.at(-2)?.initialHeight).toBe(numericToken('size-bottom-panel'));
    expect(added.at(-1)?.position).toEqual({ referencePanel: 'jbeam-preview', direction: 'within' });
  });
});

describe('isRestorable', () => {
  const layout = (components: string[]) => ({
    version: LAYOUT_VERSION as typeof LAYOUT_VERSION,
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

  it('rejects an empty layout', () => {
    expect(isRestorable(layout([]), true)).toBe(false);
  });

  it('rejects dev-only panels outside dev mode', () => {
    expect(isRestorable(layout(['kit-gallery']), false)).toBe(false);
    expect(isRestorable(layout(['kit-gallery']), true)).toBe(true);
  });
});

describe('ui store', () => {
  afterEach(() => {
    vi.useRealTimers();
    useUiStore.setState({ collapsed: {}, status: null, propsTab: 'inspector' });
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
    expect(stored.state).toEqual({ collapsed: { sec: true }, view: { mesh: true, structure: true, xray: false }, propsTab: 'inspector' }); // view toggles and the Properties tab persist too
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
