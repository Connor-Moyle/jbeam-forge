import type { DockviewApi } from 'dockview-react';
import type { PresetId } from '@shared/layout-schema';
import { numericToken } from '@renderer/ui/tokens';
import { useUiStore } from '@renderer/app/stores/ui';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { PANELS, type PanelId } from './panelRegistry';
import { BOTTOM_PANELS, PROPERTY_TAB_WIDTH, isPropertyTab, type PropertyTab } from './propertyTabs';

export const DEFAULT_PRESET: PresetId = 'modelling';

/** Workspace tabs, in the order a car comes together. */
export const PRESET_LABELS: Record<PresetId, string> = {
  modelling: 'Parts',
  model: 'Modelling',
  materials: 'Materials',
  jbeam: 'JBeam',
  suspension: 'Suspension',
  engine: 'Engine',
  moving: 'Moving parts',
  triggers: 'Triggers',
  scripts: 'Scripts',
  testing: 'Testing',
  tyres: 'Tyre builder',
  wheels: 'Wheel builder',
  panel: 'Panel builder',
};

type Width = 'size-side-panel' | 'size-side-panel-wide' | 'size-side-panel-xl' | 'size-props' | 'size-props-wide' | 'size-props-xl';

interface PresetPlacement {
  id: PanelId;
  /** Omitted for the first (anchor) panel. */
  relativeTo?: PanelId;
  direction?: 'left' | 'right' | 'above' | 'below' | 'within';
  width?: Width;
  /** For the Properties column: the tab it opens on. */
  tab?: PropertyTab;
  /** For a panel under the 3D view: start at the output-panel height instead of half the view. */
  short?: boolean;
}

const SCENE: PresetPlacement = {
  id: 'scene',
  relativeTo: 'viewport',
  direction: 'left',
  width: 'size-side-panel',
};
const properties = (tab: PropertyTab): PresetPlacement => ({
  id: 'properties',
  relativeTo: 'viewport',
  direction: 'right',
  width: PROPERTY_TAB_WIDTH[tab],
  tab,
});

/**
 * Named layouts as data. Every workspace keeps the same shape: the 3D view in
 * the middle, what you pick from on the left, what you change on the right.
 */
export const PRESETS: Record<PresetId, readonly PresetPlacement[]> = {
  // Sorting meshes into parts and generating the structure.
  modelling: [{ id: 'viewport' }, SCENE, properties('inspector')],
  // Reshaping one mesh, Blender-style: the Scene to pick it from, the tools and keys on the right.
  model: [
    { id: 'viewport' },
    SCENE,
    {
      id: 'modelling',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel',
    },
  ],
  // Materials, paints and skins are tabs of the Properties column, which opens on Materials.
  materials: [{ id: 'viewport' }, SCENE, properties('materials')],
  // Nodes, beams and triangles: the tables on the left, the picked ones' values on the right, the file under the car.
  jbeam: [
    { id: 'viewport' },
    {
      id: 'jbeam-tables',
      relativeTo: 'viewport',
      direction: 'left',
      width: 'size-side-panel-wide',
    },
    {
      id: 'jbeam-props',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
    { id: 'jbeam-preview', relativeTo: 'viewport', direction: 'below' },
  ],
  // Axles, and suspensions from the game's cars.
  suspension: [{ id: 'viewport' }, SCENE, properties('suspension')],
  // The engine (and engine mods): the car big in the middle, the engine designer on the right.
  engine: [{ id: 'viewport' }, properties('powertrain')],
  // Doors, needles, wipers: what moves on the left, its settings on the right.
  moving: [
    { id: 'viewport' },
    {
      id: 'moving-parts',
      relativeTo: 'viewport',
      direction: 'left',
      width: 'size-side-panel-wide',
    },
    {
      id: 'moving-part',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
  ],
  // Clickable spots: the list on the left, the picked one's place and action on the right.
  triggers: [
    { id: 'viewport' },
    {
      id: 'triggers',
      relativeTo: 'viewport',
      direction: 'left',
      width: 'size-side-panel',
    },
    {
      id: 'trigger',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
  ],
  // Vehicle scripts: the car's scripts and templates on the left, the script (settings or code) on the right, its test under the car.
  scripts: [
    { id: 'viewport' },
    // Scene shares the left strip (to pick meshes); Scripts, added last, is the tab shown.
    SCENE,
    { id: 'scripts', relativeTo: 'scene', direction: 'within' },
    {
      id: 'script',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
    { id: 'script-test', relativeTo: 'viewport', direction: 'below' },
  ],
  testing: [
    { id: 'viewport' },
    SCENE,
    {
      id: 'test-results',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
  ],
  tyres: [
    { id: 'viewport' },
    {
      id: 'tyre-builder',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
    SCENE,
  ],
  wheels: [
    { id: 'viewport' },
    {
      id: 'wheel-builder',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
    SCENE,
  ],
  panel: [
    { id: 'viewport' },
    {
      id: 'panel-builder',
      relativeTo: 'viewport',
      direction: 'right',
      width: 'size-side-panel-wide',
    },
    SCENE,
  ],
};

/** The workspace tabs a kind of mod has (a tyre mod has no nodes to edit). */
export function workspacesFor(kind: 'vehicle' | 'engine' | 'tyres' | 'wheels' | 'panel' | undefined): readonly PresetId[] {
  switch (kind) {
    case 'engine':
      return ['engine'];
    case 'tyres':
      return ['tyres', 'materials'];
    case 'wheels':
      return ['wheels', 'materials'];
    case 'panel':
      return ['panel', 'materials'];
    default:
      return ['modelling', 'model', 'materials', 'jbeam', 'suspension', 'engine', 'moving', 'triggers', 'scripts', 'testing'];
  }
}

type Direction = NonNullable<PresetPlacement['direction']>;

/** Settings → Interface → Properties column on the left: every workspace mirrored, like flipping Blender's areas. */
function side(direction: Direction | undefined): Direction | undefined {
  if (useSettingsStore.getState().settings?.propertiesSide !== 'left') return direction;
  return direction === 'left' ? 'right' : direction === 'right' ? 'left' : direction;
}

export function applyPreset(api: DockviewApi, preset: PresetId): void {
  api.clear();
  for (const p of PRESETS[preset]) {
    addPanel(api, p.id, { ...p, direction: side(p.direction) });
    if (p.tab) useUiStore.getState().setPropsTab(p.tab);
  }
  // Each side panel takes its width from whichever neighbour the dock picks as it's added, so a
  // panel added later can squeeze one added before it: set the widths once everything is in.
  for (const p of PRESETS[preset]) if (p.width) api.getPanel(p.id)?.group.api.setSize({ width: numericToken(p.width) });
  api.getPanel('viewport')?.api.setActive();
}

export function addPanel(api: DockviewApi, id: PanelId, placement?: Omit<PresetPlacement, 'id'>): void {
  const def = PANELS[id];
  const position =
    placement?.relativeTo && api.getPanel(placement.relativeTo)
      ? {
          referencePanel: placement.relativeTo,
          direction: placement.direction ?? 'within',
        }
      : undefined;
  api.addPanel({
    id,
    component: id,
    title: def.title,
    ...(position ? { position } : {}),
    ...(placement?.width ? { initialWidth: numericToken(placement.width) } : {}),
    ...(placement?.short ? { initialHeight: numericToken('size-bottom-panel') } : {}),
  });
}

/** Where a panel goes when it's opened by hand: output panels under the 3D view (sharing one strip), the rest beside it. */
function defaultPlacement(api: DockviewApi, id: PanelId): Omit<PresetPlacement, 'id'> | undefined {
  if (BOTTOM_PANELS.includes(id)) {
    const open = BOTTOM_PANELS.find((other) => other !== id && api.getPanel(other)) as PanelId | undefined;
    if (open) return { relativeTo: open, direction: 'within' };
    return api.getPanel('viewport') ? { relativeTo: 'viewport', direction: 'below', short: true } : undefined;
  }
  return api.getPanel('viewport')
    ? {
        relativeTo: 'viewport',
        direction: side('right'),
        width: 'size-side-panel-wide',
      }
    : undefined;
}

/** Show a tab of the Properties column, opening the column when it's closed and widening it when the tab needs more room. */
function showPropertyTab(api: DockviewApi, tab: PropertyTab): void {
  const width = numericToken(PROPERTY_TAB_WIDTH[tab]);
  let panel = api.getPanel('properties');
  if (!panel) {
    addPanel(
      api,
      'properties',
      api.getPanel('viewport')
        ? {
            relativeTo: 'viewport',
            direction: side('right'),
            width: PROPERTY_TAB_WIDTH[tab],
          }
        : undefined,
    );
    panel = api.getPanel('properties');
  } else if (!panel.api.isActive) panel.api.setActive();
  useUiStore.getState().setPropsTab(tab);
  if (panel && (panel.group.api.width ?? 0) < width) panel.group.api.setSize({ width });
}

/** Whether a panel is on screen: for a Properties tab, the column is open on it. */
export function isPanelShown(api: DockviewApi, id: PanelId): boolean {
  if (isPropertyTab(id)) return !!api.getPanel('properties') && useUiStore.getState().propsTab === id;
  return !!api.getPanel(id);
}

/** Open (or focus) a panel; never closes it. */
export function showPanel(api: DockviewApi, id: PanelId): void {
  if (isPropertyTab(id)) return showPropertyTab(api, id);
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  addPanel(api, id, defaultPlacement(api, id));
}

/**
 * Toggle a panel: focus it if open elsewhere, add it if closed, close it if it's
 * the one in front. A Properties tab that's already showing goes back to the part.
 */
export function togglePanel(api: DockviewApi, id: PanelId): void {
  if (isPropertyTab(id)) {
    const showing = isPanelShown(api, id) && id !== 'inspector';
    return showPropertyTab(api, showing ? 'inspector' : id);
  }
  const existing = api.getPanel(id);
  if (existing) {
    if (existing.api.isActive) existing.api.close();
    else existing.api.setActive();
    return;
  }
  addPanel(api, id, defaultPlacement(api, id));
}
