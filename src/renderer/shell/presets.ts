import type { DockviewApi } from 'dockview-react';
import type { PresetId } from '@shared/layout-schema';
import { numericToken } from '@renderer/ui/tokens';
import { PANELS, type PanelId } from './panelRegistry';

export const DEFAULT_PRESET: PresetId = 'modelling';

export const PRESET_LABELS: Record<PresetId, string> = {
  modelling: 'Modelling',
  materials: 'Materials',
  testing: 'Testing',
};

interface PresetPlacement {
  id: PanelId;
  /** Omitted for the first (anchor) panel. */
  relativeTo?: PanelId;
  direction?: 'left' | 'right' | 'above' | 'below' | 'within';
  width?: 'size-side-panel' | 'size-side-panel-wide';
}

/** Named layouts as data. Panels owned by later phases are placeholders until then. */
export const PRESETS: Record<PresetId, readonly PresetPlacement[]> = {
  modelling: [
    { id: 'viewport' },
    { id: 'scene', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
    { id: 'inspector', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel' },
  ],
  materials: [
    { id: 'viewport' },
    { id: 'scene', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
    // Both visible: the material being edited on top, the selected part's details below.
    { id: 'materials', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'inspector', relativeTo: 'materials', direction: 'below' },
  ],
  testing: [
    { id: 'viewport' },
    { id: 'test-results', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'scene', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
  ],
};

export function applyPreset(api: DockviewApi, preset: PresetId): void {
  api.clear();
  for (const p of PRESETS[preset]) addPanel(api, p.id, p);
  api.getPanel('viewport')?.api.setActive();
}

export function addPanel(api: DockviewApi, id: PanelId, placement?: Omit<PresetPlacement, 'id'>): void {
  const def = PANELS[id];
  const position =
    placement?.relativeTo && api.getPanel(placement.relativeTo)
      ? { referencePanel: placement.relativeTo, direction: placement.direction ?? 'within' }
      : undefined;
  api.addPanel({
    id,
    component: id,
    title: def.title,
    ...(position ? { position } : {}),
    ...(placement?.width ? { initialWidth: numericToken(placement.width) } : {}),
  });
}

/** Toggle a panel: focus it if open elsewhere, add it to the right if closed. */
/** Open (or focus) a panel; never closes it. */
export function showPanel(api: DockviewApi, id: PanelId): void {
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const anchor = api.getPanel('viewport') ? 'viewport' : undefined;
  addPanel(api, id, anchor ? { relativeTo: anchor, direction: 'right', width: 'size-side-panel-wide' } : undefined);
}

export function togglePanel(api: DockviewApi, id: PanelId): void {
  const existing = api.getPanel(id);
  if (existing) {
    if (existing.api.isActive) existing.api.close();
    else existing.api.setActive();
    return;
  }
  const anchor = api.getPanel('viewport') ? 'viewport' : undefined;
  addPanel(api, id, anchor ? { relativeTo: anchor, direction: 'right', width: 'size-side-panel-wide' } : undefined);
}
