import type { ComponentType } from 'react';
import { Box, FlaskConical, FolderTree, LayoutGrid, Palette, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { ScenePanel } from '@renderer/panels/ScenePanel';
import { InspectorPanel } from '@renderer/panels/InspectorPanel';
import { MaterialsPanel } from '@renderer/panels/MaterialsPanel';
import { TestResultsPanel } from '@renderer/panels/TestResultsPanel';
import { ViewportPanel } from '@renderer/panels/viewport/ViewportPanel';
import { KitGalleryPanel } from '@renderer/panels/KitGallery';

export interface PanelDef {
  title: string;
  icon: LucideIcon;
  component: ComponentType;
  /** Only available in dev / harness runs. */
  devOnly?: boolean;
}

export const PANELS = {
  viewport: { title: 'Viewport', icon: Box, component: ViewportPanel },
  scene: { title: 'Scene', icon: FolderTree, component: ScenePanel },
  inspector: { title: 'Inspector', icon: SlidersHorizontal, component: InspectorPanel },
  materials: { title: 'Materials', icon: Palette, component: MaterialsPanel },
  'test-results': { title: 'Test Results', icon: FlaskConical, component: TestResultsPanel },
  'kit-gallery': { title: 'Component Kit', icon: LayoutGrid, component: KitGalleryPanel, devOnly: true },
} as const satisfies Record<string, PanelDef>;

export type PanelId = keyof typeof PANELS;

export function isPanelId(id: string): id is PanelId {
  return Object.hasOwn(PANELS, id);
}
