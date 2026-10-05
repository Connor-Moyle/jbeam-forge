import { CircleHelp, CloudDownload, Download, FileCode, FileInput, FilePlus, FlaskConical, FolderOpen, LayoutGrid, ListTree, Play, Redo2, Save, Settings, Square, Undo2 } from 'lucide-react';
import { keyFor } from '@renderer/app/keys';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useProjectStore } from '@renderer/app/stores/project';
import { openProject, redo, saveProject, undo } from '@renderer/project/actions';
import { startImport } from '@renderer/import/importFlow';
import { useStructureUi } from '@renderer/structure/generate';
import { GenerateMenu } from '@renderer/structure/GenerateMenu';
import { openExport } from '@renderer/export/exportFlow';
import { startTestMode, stopTestMode, useSim } from '@renderer/sim/simSession';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useShell } from './ShellContext';
import { PRESET_LABELS, workspacesFor } from './presets';
import styles from './Toolbar.module.css';

/**
 * The top of the editor. First row: the file, then the three steps every mod
 * goes through (generate, test, export). Second row: the workspaces, in the
 * order a car comes together. What the 3D view draws is on the view itself, and
 * the tools that work on the car are tabs of the Properties column.
 */
/** A toolbar button: an icon with a tooltip, or with Settings → Interface → "Words on every toolbar button", the icon and a short word. */
function Tool({ icon, label, word, ...rest }: { icon: LucideIcon; label: string; word: string } & Omit<ComponentProps<typeof IconButton>, 'icon' | 'label'>) {
  const labels = useSettingsStore((s) => s.settings?.toolbarLabels ?? false);
  if (!labels) return <IconButton icon={icon} label={label} {...rest} />;
  const { shortcut, active, ...button } = rest;
  return (
    <Button variant="ghost" icon={icon} title={shortcut ? `${label} (${shortcut})` : label} aria-label={label} aria-pressed={active} className={styles.worded} {...button}>
      {word}
    </Button>
  );
}

export function Toolbar() {
  const modKind = useProjectStore((s) => s.doc?.meta.modKind);
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
  // Tyre, wheel, panel and engine mods export from their builder's settings, with or without parts.
  const canExport = hasParts || (!!modKind && modKind !== 'vehicle');

  return (
    <>
      <header className={styles.toolbar} role="toolbar" aria-label="Main toolbar">
        <div className={styles.brand}>JBeam Forge</div>
        <div className={styles.group} role="group" aria-label="File">
          <span className={styles.divider} aria-hidden />
          <Tool word="New" icon={FilePlus} label="New mod" shortcut={keyFor('new')} onClick={() => setNewModOpen(true)} />
          <Tool word="Open" icon={FolderOpen} label="Open project" shortcut={keyFor('open')} onClick={() => void openProject()} />
          <Tool word="Import" icon={FileInput} label="Import model" shortcut={keyFor('import')} onClick={() => void startImport()} data-testid="toolbar-import" />
          <Tool word="Save" icon={Save} label="Save" shortcut={keyFor('save')} onClick={() => void saveProject()} data-testid="toolbar-save" />
        </div>
        <div className={styles.group} role="group" aria-label="Edit">
          <span className={styles.divider} aria-hidden />
          <Tool word="Undo" icon={Undo2} label={undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo'} shortcut={keyFor('undo')} disabled={!undoLabel} onClick={undo} />
          <Tool word="Redo" icon={Redo2} label={redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo'} shortcut={keyFor('redo')} disabled={!redoLabel} onClick={redo} />
        </div>
        <div className={styles.group} role="group" aria-label="Build">
          <span className={styles.divider} aria-hidden />
          <GenerateMenu label={hasParts ? 'Generate structure for all parts' : 'Generate structure (assign meshes to parts first)'} disabled={!hasParts || generating} />
          <Button
            icon={testing ? Square : Play}
            className={styles.step}
            title={testing ? 'Leave Test Mode' : hasStructure ? 'Test Mode: run the physics sandbox' : 'Test Mode (generate structure first)'}
            aria-pressed={testing}
            disabled={!testing && !hasStructure}
            onClick={() => {
              if (testing) stopTestMode();
              else if (startTestMode()) showPanel('test-results');
            }}
            data-testid="toolbar-test"
          >
            {testing ? 'Stop test' : 'Test'}
          </Button>
        </div>

        <div className={styles.spacer} />

        <div className={styles.group} role="group" aria-label="Output panels">
          {devMode && <IconButton icon={LayoutGrid} label="Component kit (dev)" onClick={() => togglePanel('kit-gallery')} data-testid="toggle-kit" />}
          <Tool word="JBeam file" icon={FileCode} label="JBeam file: the jbeam the picked part exports" onClick={() => togglePanel('jbeam-preview')} data-testid="toggle-jbeam-preview" />
          <Tool word="Results" icon={FlaskConical} label="Test results" onClick={() => togglePanel('test-results')} data-testid="toggle-test-results" />
        </div>
        <div className={styles.group} role="group" aria-label="Finish">
          <span className={styles.divider} aria-hidden />
          <Button icon={ListTree} title="Configurations manager: the versions of the car players pick from" onClick={() => useDialogStore.getState().setConfigsOpen(true)} disabled={!hasParts} data-testid="open-configs">
            Configurations
          </Button>
          <Button variant="primary" icon={Download} onClick={() => void openExport()} disabled={!canExport} data-testid="toolbar-export">
            Export
          </Button>
        </div>
        <div className={styles.group} role="group" aria-label="App">
          <span className={styles.divider} aria-hidden />
          <Tool word="Downloads" icon={CloudDownload} label="Downloads: updates, textures and meshes" shortcut={keyFor('downloads')} onClick={() => useDialogStore.getState().setDownloads('app')} data-testid="open-downloads" />
          <Tool word="Help" icon={CircleHelp} label="Help, guides and the tutorial" shortcut={keyFor('help')} onClick={() => useDialogStore.getState().setHelpOpen(true)} data-testid="open-help" />
          <Tool word="Settings" icon={Settings} label="Settings" shortcut={keyFor('settings')} onClick={() => setSettingsOpen(true)} disabled={!settings} data-testid="open-settings" />
        </div>
      </header>
      <nav className={styles.workspaces} aria-label="Workspaces" role="tablist" data-tour="workspaces">
        {workspacesFor(modKind).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={preset === id} className={preset === id ? styles.workspaceOn : styles.workspace} onClick={() => applyPreset(id)} data-testid={`workspace-${id}`}>
            {PRESET_LABELS[id]}
          </button>
        ))}
      </nav>
    </>
  );
}
