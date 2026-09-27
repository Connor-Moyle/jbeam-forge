import {
  Box,
  Download,
  Eye,
  FileCode,
  FilePlus,
  Package,
  FlaskConical,
  FileInput,
  FolderOpen,
  LayoutGrid,
  MousePointer2,
  Play,
  Save,
  Redo2,
  ScanEye,
  ScanLine,
  Settings,
  Square,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { PRESET_IDS, type PresetId } from '@shared/layout-schema';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useProjectStore } from '@renderer/app/stores/project';
import { openProject, redo, saveProject, undo } from '@renderer/project/actions';
import { startImport } from '@renderer/import/importFlow';
import { useUiStore } from '@renderer/app/stores/ui';
import { generateAll, useStructureUi } from '@renderer/structure/generate';
import { useEditStore } from '@renderer/structure/editStore';
import { openExport } from '@renderer/export/exportFlow';
import { startTestMode, stopTestMode, useSim } from '@renderer/sim/simSession';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Select } from '@renderer/ui/components/Select';
import { useShell } from './ShellContext';
import { PRESET_LABELS } from './presets';
import styles from './Toolbar.module.css';

interface PendingAction {
  icon: LucideIcon;
  label: string;
  phase: number;
  shortcut?: string;
}

/** Toolbar actions owned by later phases: visible so the chrome is final, inert until built. */
const GROUPS: { id: string; label: string; actions: PendingAction[] }[] = [
  { id: 'view-later', label: 'View', actions: [{ icon: ScanEye, label: 'X-ray', phase: 7 }] },
];

const PRESET_OPTIONS = PRESET_IDS.map((id) => ({ value: id, label: PRESET_LABELS[id] }));

function pendingLabel(a: PendingAction): string {
  return `${a.label} — coming in phase ${a.phase}`;
}

export function Toolbar() {
  const { preset, applyPreset, togglePanel, showPanel, devMode } = useShell();
  const testing = useSim((s) => s.active);
  const hasStructure = useProjectStore((s) => (s.doc?.nodes.length ?? 0) > 0);
  const settings = useSettingsStore((s) => s.settings);
  const setSettingsOpen = useDialogStore((s) => s.setSettingsOpen);
  const setNewModOpen = useDialogStore((s) => s.setNewModOpen);
  const undoLabel = useProjectStore((s) => s.undoStack[s.undoStack.length - 1]?.label ?? null);
  const redoLabel = useProjectStore((s) => s.redoStack[s.redoStack.length - 1]?.label ?? null);
  const hasParts = useProjectStore((s) => (s.doc?.parts.length ?? 0) > 0);
  const generating = useStructureUi((s) => s.busy);
  const view = useUiStore((s) => s.view);
  const toggleView = useUiStore((s) => s.toggleView);
  const editing = useEditStore((s) => s.active);
  const setEditing = useEditStore((s) => s.setActive);

  return (
    <header className={styles.toolbar} role="toolbar" aria-label="Main toolbar">
      <div className={styles.brand}>JBeam Forge</div>
      <div className={styles.group} role="group" aria-label="File">
        <span className={styles.divider} aria-hidden />
        <IconButton icon={FilePlus} label="New mod" shortcut="Ctrl+N" onClick={() => setNewModOpen(true)} />
        <IconButton icon={FolderOpen} label="Open project" shortcut="Ctrl+O" onClick={() => void openProject()} />
        <IconButton icon={FileInput} label="Import model" shortcut="Ctrl+I" onClick={() => void startImport()} data-testid="toolbar-import" />
        <IconButton icon={Save} label="Save" shortcut="Ctrl+S" onClick={() => void saveProject()} data-testid="toolbar-save" />
      </div>
      <div className={styles.group} role="group" aria-label="Edit">
        <span className={styles.divider} aria-hidden />
        <IconButton icon={Undo2} label={undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo'} shortcut="Ctrl+Z" disabled={!undoLabel} onClick={undo} />
        <IconButton icon={Redo2} label={redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo'} shortcut="Ctrl+Y" disabled={!redoLabel} onClick={redo} />
      </div>
      <div className={styles.group} role="group" aria-label="Generate">
        <span className={styles.divider} aria-hidden />
        <IconButton icon={Wand2} label={hasParts ? 'Generate structure for all parts' : 'Generate structure (assign meshes to parts first)'} disabled={!hasParts || generating} onClick={() => void generateAll()} data-testid="toolbar-generate" />
      </div>
      <div className={styles.group} role="group" aria-label="View">
        <span className={styles.divider} aria-hidden />
        <IconButton icon={Eye} label={view.mesh ? 'Hide mesh' : 'Show mesh'} active={view.mesh} onClick={() => toggleView('mesh')} data-testid="toolbar-view-mesh" />
        <IconButton icon={Box} label={view.structure ? 'Hide nodes & beams' : 'Show nodes & beams'} active={view.structure} onClick={() => toggleView('structure')} data-testid="toolbar-view-structure" />
        <IconButton icon={ScanLine} label={view.xray ? 'X-ray off' : 'X-ray: see through the mesh'} active={view.xray} onClick={() => toggleView('xray')} data-testid="toolbar-view-xray" />
        <IconButton icon={MousePointer2} label={editing ? 'Stop editing nodes & beams' : hasStructure ? 'Edit nodes & beams' : 'Edit nodes & beams (generate the structure first)'} shortcut="Tab" active={editing} disabled={!hasStructure && !editing} onClick={() => setEditing(!editing)} data-testid="toolbar-edit" />
      </div>
      <div className={styles.group} role="group" aria-label="Test">
        <span className={styles.divider} aria-hidden />
        <IconButton
          icon={testing ? Square : Play}
          label={testing ? 'Leave Test Mode' : hasStructure ? 'Test Mode: run the physics sandbox' : 'Test Mode (generate structure first)'}
          active={testing}
          disabled={!testing && !hasStructure}
          onClick={() => {
            if (testing) stopTestMode();
            else if (startTestMode()) showPanel('test-results');
          }}
          data-testid="toolbar-test"
        />
      </div>
      {GROUPS.map((g) => (
        <div key={g.id} className={styles.group} role="group" aria-label={g.label}>
          <span className={styles.divider} aria-hidden />
          {g.actions.map((a) => (
            <IconButton key={a.label} icon={a.icon} label={pendingLabel(a)} shortcut={a.shortcut} aria-disabled="true" />
          ))}
        </div>
      ))}

      <div className={styles.spacer} />

      <div className={styles.group}>
        {devMode && (
          <IconButton icon={LayoutGrid} label="Component kit (dev)" onClick={() => togglePanel('kit-gallery')} data-testid="toggle-kit" />
        )}
        <IconButton icon={FlaskConical} label="Test results panel" onClick={() => togglePanel('test-results')} />
        <IconButton icon={FileCode} label="jbeam preview panel" onClick={() => togglePanel('jbeam-preview')} data-testid="toggle-jbeam-preview" />
        <IconButton icon={Package} label="Objects library: calipers, discs, gauges…" onClick={() => togglePanel('objects')} data-testid="toggle-objects" />
        <Select<PresetId>
          aria-label="Layout preset"
          value={preset}
          onChange={applyPreset}
          options={PRESET_OPTIONS}
          className={styles.preset}
        />
        <span className={styles.divider} aria-hidden />
        <Button variant="primary" icon={Download} onClick={openExport} disabled={!hasParts} data-testid="toolbar-export">
          Export
        </Button>
        <IconButton icon={Settings} label="Settings" onClick={() => setSettingsOpen(true)} disabled={!settings} data-testid="open-settings" />
      </div>
    </header>
  );
}
