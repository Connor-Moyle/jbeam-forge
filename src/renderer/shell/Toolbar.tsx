import {
  Box,
  Download,
  Eye,
  FilePlus,
  FlaskConical,
  FileInput,
  FolderOpen,
  LayoutGrid,
  Play,
  Save,
  Redo2,
  ScanEye,
  Settings,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { PRESET_IDS, type PresetId } from '@shared/layout-schema';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useProjectStore } from '@renderer/app/stores/project';
import { openProject, redo, saveProject, undo } from '@renderer/project/actions';
import { startImport } from '@renderer/import/importFlow';
import { SettingsModal } from '@renderer/settings/SettingsModal';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Select } from '@renderer/ui/components/Select';
import { Tooltip } from '@renderer/ui/components/Tooltip';
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
  { id: 'generate', label: 'Generate', actions: [{ icon: Wand2, label: 'Generate proxies', phase: 4 }] },
  {
    id: 'view',
    label: 'View',
    actions: [
      { icon: Eye, label: 'Show mesh', phase: 3 },
      { icon: ScanEye, label: 'X-ray', phase: 7 },
      { icon: Box, label: 'Show nodes & beams', phase: 4 },
    ],
  },
  { id: 'test', label: 'Test', actions: [{ icon: Play, label: 'Test mode', phase: 6 }] },
];

const PRESET_OPTIONS = PRESET_IDS.map((id) => ({ value: id, label: PRESET_LABELS[id] }));

function pendingLabel(a: PendingAction): string {
  return `${a.label} — coming in phase ${a.phase}`;
}

export function Toolbar() {
  const { preset, applyPreset, togglePanel, devMode } = useShell();
  const settings = useSettingsStore((s) => s.settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setNewModOpen = useDialogStore((s) => s.setNewModOpen);
  const undoLabel = useProjectStore((s) => s.undoStack[s.undoStack.length - 1]?.label ?? null);
  const redoLabel = useProjectStore((s) => s.redoStack[s.redoStack.length - 1]?.label ?? null);

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
        <Select<PresetId>
          aria-label="Layout preset"
          value={preset}
          onChange={applyPreset}
          options={PRESET_OPTIONS}
          className={styles.preset}
        />
        <span className={styles.divider} aria-hidden />
        <Tooltip content="Export mod — coming in phase 5">
          <Button variant="primary" icon={Download} aria-disabled="true">
            Export
          </Button>
        </Tooltip>
        <IconButton icon={Settings} label="Settings" onClick={() => setSettingsOpen(true)} disabled={!settings} data-testid="open-settings" />
      </div>
      {settingsOpen && settings && <SettingsModal settings={settings} onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
