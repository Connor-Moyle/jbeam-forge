import {
  Box,
  Download,
  Eye,
  FilePlus,
  FlaskConical,
  FolderOpen,
  LayoutGrid,
  Play,
  Save,
  ScanEye,
  Settings,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { PRESET_IDS, type PresetId } from '@shared/layout-schema';
import { useSettingsStore } from '@renderer/app/stores/settings';
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
  {
    id: 'file',
    label: 'File',
    actions: [
      { icon: FilePlus, label: 'New mod', phase: 3, shortcut: 'Ctrl+N' },
      { icon: FolderOpen, label: 'Open project', phase: 3, shortcut: 'Ctrl+O' },
      { icon: Save, label: 'Save', phase: 3, shortcut: 'Ctrl+S' },
    ],
  },
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

  return (
    <header className={styles.toolbar} role="toolbar" aria-label="Main toolbar">
      <div className={styles.brand}>JBeam Forge</div>
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
