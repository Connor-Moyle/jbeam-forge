import type { ComponentType } from 'react';
import { Box, BadgePlus, PaintRoller, CarFront, FileCode, Gauge, ListTree, Wrench, Package, FlaskConical, FolderTree, LayoutGrid, Palette, SlidersHorizontal, ScrollText, Code2, FlaskRound, Table2, DoorOpen, MousePointerClick, CircleDot, Disc3, LayoutTemplate, PanelTop, Pentagon, type LucideIcon } from 'lucide-react';
import { ScenePanel } from '@renderer/panels/ScenePanel';
import { InspectorPanel } from '@renderer/panels/InspectorPanel';
import { MaterialsPanel } from '@renderer/panels/MaterialsPanel';
import { TestResultsPanel } from '@renderer/panels/TestResultsPanel';
import { ViewportPanel } from '@renderer/panels/viewport/ViewportPanel';
import { KitGalleryPanel } from '@renderer/panels/KitGallery';
import { JbeamPreviewPanel } from '@renderer/panels/JbeamPreviewPanel';
import { JbeamTablesPanel } from '@renderer/jbeam/JbeamTablesPanel';
import { JbeamPropertiesPanel } from '@renderer/jbeam/JbeamPropertiesPanel';
import { MovingPartPanel, MovingPartsPanel } from '@renderer/moving/MovingPartsPanel';
import { TriggerPanel, TriggersPanel } from '@renderer/triggers/TriggersPanel';
import { TyreBuilderPanel, WheelBuilderPanel } from '@renderer/wheels/WheelBuilders';
import { ObjectsPanel } from '@renderer/panels/ObjectsPanel';
import { ReferencePanel } from '@renderer/panels/ReferencePanel';
import { SuspensionPanel } from '@renderer/suspension/SuspensionPanel';
import { PowertrainPanel } from '@renderer/powertrain/PowertrainPanel';
import { ConfigsPanel } from '@renderer/configs/ConfigsPanel';
import { FeaturesPanel } from '@renderer/features/FeaturesPanel';
import { PaintsPanel } from '@renderer/paint/PaintsPanel';
import { ScriptsPanel } from '@renderer/scripts/ScriptsPanel';
import { ScriptPanel } from '@renderer/scripts/ScriptPanel';
import { ScriptTestPanel } from '@renderer/scripts/ScriptTestPanel';
import { SkinStudioPanel } from '@renderer/skins/SkinStudioPanel';
import { PanelBuilderPanel } from '@renderer/panelmod/PanelBuilderPanel';
import { ModellingPanel } from '@renderer/modelling/ModellingPanel';
import { PropertiesPanel } from './PropertiesPanel';

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
  // The column of tabbed tools on the right (see propertyTabs.ts); the tabs are the panels listed there.
  properties: { title: 'Properties', icon: SlidersHorizontal, component: PropertiesPanel },
  inspector: { title: 'Inspector', icon: SlidersHorizontal, component: InspectorPanel },
  modelling: { title: 'Modelling', icon: Pentagon, component: ModellingPanel },
  materials: { title: 'Materials', icon: Palette, component: MaterialsPanel },
  'test-results': { title: 'Test Results', icon: FlaskConical, component: TestResultsPanel },
  'jbeam-preview': { title: 'JBeam file', icon: FileCode, component: JbeamPreviewPanel },
  'jbeam-tables': { title: 'Nodes & beams', icon: Table2, component: JbeamTablesPanel },
  'jbeam-props': { title: 'Node & beam values', icon: SlidersHorizontal, component: JbeamPropertiesPanel },
  'moving-parts': { title: 'Moving parts', icon: DoorOpen, component: MovingPartsPanel },
  'moving-part': { title: 'Settings', icon: SlidersHorizontal, component: MovingPartPanel },
  triggers: { title: 'Triggers', icon: MousePointerClick, component: TriggersPanel },
  trigger: { title: 'Trigger', icon: SlidersHorizontal, component: TriggerPanel },
  'tyre-builder': { title: 'Tyre builder', icon: CircleDot, component: TyreBuilderPanel },
  'wheel-builder': { title: 'Wheel builder', icon: Disc3, component: WheelBuilderPanel },
  'panel-builder': { title: 'Panel builder', icon: PanelTop, component: PanelBuilderPanel },
  objects: { title: 'Objects', icon: Package, component: ObjectsPanel },
  reference: { title: 'Reference car', icon: CarFront, component: ReferencePanel },
  suspension: { title: 'Suspension', icon: Wrench, component: SuspensionPanel },
  powertrain: { title: 'Engine & gearbox', icon: Gauge, component: PowertrainPanel },
  configs: { title: 'Configurations', icon: ListTree, component: ConfigsPanel },
  features: { title: 'Extras', icon: BadgePlus, component: FeaturesPanel },
  paints: { title: 'Paints', icon: PaintRoller, component: PaintsPanel },
  skins: { title: 'Skin studio', icon: LayoutTemplate, component: SkinStudioPanel },
  scripts: { title: 'Scripts', icon: ScrollText, component: ScriptsPanel },
  script: { title: 'Script', icon: Code2, component: ScriptPanel },
  'script-test': { title: 'Script test', icon: FlaskRound, component: ScriptTestPanel },
  'kit-gallery': { title: 'Component Kit', icon: LayoutGrid, component: KitGalleryPanel, devOnly: true },
} as const satisfies Record<string, PanelDef>;

export type PanelId = keyof typeof PANELS;

export function isPanelId(id: string): id is PanelId {
  return Object.hasOwn(PANELS, id);
}
