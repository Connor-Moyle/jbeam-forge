import type { ComponentType } from 'react';
import { Box, CarFront, FileCode, Gauge, Wrench, Package, FlaskConical, FolderTree, LayoutGrid, Palette, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { ScenePanel } from '@renderer/panels/ScenePanel';
import { InspectorPanel } from '@renderer/panels/InspectorPanel';
import { MaterialsPanel } from '@renderer/panels/MaterialsPanel';
import { TestResultsPanel } from '@renderer/panels/TestResultsPanel';
import { ViewportPanel } from '@renderer/panels/viewport/ViewportPanel';
import { KitGalleryPanel } from '@renderer/panels/KitGallery';
import { JbeamPreviewPanel } from '@renderer/panels/JbeamPreviewPanel';
import { ObjectsPanel } from '@renderer/panels/ObjectsPanel';
import { ReferencePanel } from '@renderer/panels/ReferencePanel';
import { SuspensionPanel } from '@renderer/suspension/SuspensionPanel';
import { PowertrainPanel } from '@renderer/powertrain/PowertrainPanel';

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
  'jbeam-preview': { title: 'jbeam', icon: FileCode, component: JbeamPreviewPanel },
  objects: { title: 'Objects', icon: Package, component: ObjectsPanel },
  reference: { title: 'Reference car', icon: CarFront, component: ReferencePanel },
  suspension: { title: 'Suspension', icon: Wrench, component: SuspensionPanel },
  powertrain: { title: 'Engine & gearbox', icon: Gauge, component: PowertrainPanel },
  'kit-gallery': { title: 'Component Kit', icon: LayoutGrid, component: KitGalleryPanel, devOnly: true },
} as const satisfies Record<string, PanelDef>;

export type PanelId = keyof typeof PANELS;

export function isPanelId(id: string): id is PanelId {
  return Object.hasOwn(PANELS, id);
}
