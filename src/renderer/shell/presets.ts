import type { DockviewApi } from 'dockview-react';
import type { PresetId } from '@shared/layout-schema';
import { numericToken } from '@renderer/ui/tokens';
import { PANELS, type PanelId } from './panelRegistry';

export const DEFAULT_PRESET: PresetId = 'modelling';

export const PRESET_LABELS: Record<PresetId, string> = {
  modelling: 'Modelling',
  materials: 'Materials',
  jbeam: 'JBeam',
  moving: 'Moving parts',
  triggers: 'Triggers',
  engine: 'Engine',
  tyres: 'Tyre builder',
  wheels: 'Wheel builder',
  testing: 'Testing',
  scripts: 'Scripts',
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
    // Paints (and painting on the car) share the materials tab strip; Materials, added last, is the tab shown.
    { id: 'paints', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'materials', relativeTo: 'paints', direction: 'within' },
    { id: 'inspector', relativeTo: 'materials', direction: 'below' },
  ],
  // Nodes, beams and triangles: the tables on the left, the picked ones' values on the right, the file under the car.
  jbeam: [
    { id: 'viewport' },
    { id: 'jbeam-tables', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel-wide' },
    { id: 'jbeam-props', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'jbeam-preview', relativeTo: 'viewport', direction: 'below' },
  ],
  // Doors, needles, wipers: what moves on the left, its settings on the right.
  moving: [
    { id: 'viewport' },
    { id: 'moving-parts', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel-wide' },
    { id: 'moving-part', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
  ],
  // Clickable spots: the list on the left, the picked one's place and action on the right.
  triggers: [
    { id: 'viewport' },
    { id: 'triggers', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
    { id: 'trigger', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
  ],
  // Part mods (fork): the builder beside the model.
  engine: [
    { id: 'viewport' },
    { id: 'powertrain', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
  ],
  tyres: [
    { id: 'viewport' },
    { id: 'tyre-builder', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'scene', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
  ],
  wheels: [
    { id: 'viewport' },
    { id: 'wheel-builder', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'scene', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
  ],
  testing: [
    { id: 'viewport' },
    { id: 'test-results', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'scene', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
  ],
  // Vehicle scripts: the car's scripts and templates on the left, the script (settings or code) on the right, its test under the car.
  scripts: [
    { id: 'viewport' },
    // Scene shares the left strip (to pick meshes); Scripts, added last, is the tab shown.
    { id: 'scene', relativeTo: 'viewport', direction: 'left', width: 'size-side-panel' },
    { id: 'scripts', relativeTo: 'scene', direction: 'within' },
    { id: 'script', relativeTo: 'viewport', direction: 'right', width: 'size-side-panel-wide' },
    { id: 'script-test', relativeTo: 'viewport', direction: 'below' },
  ],
};

/** The workspace tabs a kind of mod has (a tyre mod has no nodes to edit). */
export function workspacesFor(kind: 'vehicle' | 'engine' | 'tyres' | 'wheels' | undefined): readonly PresetId[] {
  switch (kind) {
    case 'engine':
      return ['engine'];
    case 'tyres':
      return ['tyres', 'materials'];
    case 'wheels':
      return ['wheels', 'materials'];
    default:
      return ['modelling', 'materials', 'jbeam', 'moving', 'triggers', 'scripts', 'testing'];
  }
}

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
