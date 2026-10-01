/**
 * The Properties column: one dock panel with a strip of tabs down its side, each
 * a tool that works on the car or the picked part. Kept apart from the panel
 * registry so the column can read the registry without a circular import.
 */
export const PROPERTY_TABS = ['inspector', 'materials', 'paints', 'skins', 'suspension', 'powertrain', 'configs', 'features', 'objects', 'reference'] as const;

export type PropertyTab = (typeof PROPERTY_TABS)[number];

export function isPropertyTab(id: string): id is PropertyTab {
  return (PROPERTY_TABS as readonly string[]).includes(id);
}

/** Tabs with a break above them on the strip: the part, how it looks, how it drives, the whole car, libraries. */
export const PROPERTY_TAB_BREAKS: readonly PropertyTab[] = ['materials', 'suspension', 'configs', 'objects'];

type Width = 'size-props' | 'size-props-wide' | 'size-props-xl';

/** The narrowest the column should be for a tab; it widens to this when the tab is picked. */
export const PROPERTY_TAB_WIDTH: Record<PropertyTab, Width> = {
  inspector: 'size-props',
  materials: 'size-props-wide',
  paints: 'size-props-wide',
  skins: 'size-props-wide',
  suspension: 'size-props-wide',
  powertrain: 'size-props-xl',
  configs: 'size-props-wide',
  features: 'size-props-wide',
  objects: 'size-props-wide',
  reference: 'size-props-wide',
};

/** Output panels open under the 3D view instead of beside it. */
export const BOTTOM_PANELS: readonly string[] = ['jbeam-preview', 'test-results', 'script-test'];
