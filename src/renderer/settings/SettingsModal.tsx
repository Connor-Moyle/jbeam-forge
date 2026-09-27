import { useEffect, useId, useRef, useState } from 'react';
import { FolderOpen, ScanSearch } from 'lucide-react';
import type { InstallValidation } from '@shared/beamng';
import { describeInstallValidation } from '@shared/beamng';
import type { Settings, SettingsPatch } from '@shared/settings-schema';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { useUiStore } from '@renderer/app/stores/ui';
import styles from './SettingsModal.module.css';

const VALIDATE_DEBOUNCE_MS = 250;

/** Validation state; `forDir` ties every answer to the exact path it was for. */
type Check =
  | { state: 'idle' }
  | { state: 'checking'; forDir: string }
  | { state: 'done'; forDir: string; result: InstallValidation }
  | { state: 'error'; forDir: string; message: string };

export interface SettingsModalProps {
  settings: Settings;
  onClose: () => void;
}

/**
 * App settings (SPEC §3.1: the BeamNG install is a persisted app setting).
 * Mounted only while open, so drafts initialise from current settings.
 */
export function SettingsModal({ settings, onClose }: SettingsModalProps) {
  const dirId = useId();
  const [dir, setDir] = useState(settings.beamngInstallDir ?? '');
  const [debug, setDebug] = useState(settings.debugLogging);
  const [ghost, setGhost] = useState(settings.focusGhostOpacity);
  const [autoMeshNames, setAutoMeshNames] = useState(settings.autoRenameMeshes);
  const [autoDisplayNames, setAutoDisplayNames] = useState(settings.autoRenameDisplayNames);
  const [check, setCheck] = useState<Check>(() => {
    const initial = (settings.beamngInstallDir ?? '').trim();
    return initial ? { state: 'checking', forDir: initial } : { state: 'idle' };
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(0);
  const pushStatus = useUiStore((s) => s.pushStatus);

  // Validate the path as it changes (debounced; stale answers are dropped).
  useEffect(() => {
    const trimmed = dir.trim();
    const id = ++requestId.current;
    if (!trimmed) return;
    const timer = setTimeout(() => {
      call('beamng:validate', { dir: trimmed })
        .then((result) => {
          if (id === requestId.current) setCheck({ state: 'done', forDir: trimmed, result });
        })
        .catch((err: unknown) => {
          if (id === requestId.current) setCheck({ state: 'error', forDir: trimmed, message: err instanceof Error ? err.message : String(err) });
        });
    }, VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dir]);

  const changeDir = (next: string) => {
    setNotice(null);
    setSaveError(null);
    // Any edit invalidates the previous answer immediately (not after the debounce).
    const trimmed = next.trim();
    setCheck(trimmed ? { state: 'checking', forDir: trimmed } : { state: 'idle' });
    setDir(next);
  };

  const browse = () => {
    call('dialog:pickDirectory', { title: 'Select the BeamNG.drive install folder', ...(dir.trim() ? { defaultPath: dir.trim() } : {}) })
      .then((picked) => {
        if (picked) changeDir(picked);
      })
      .catch(() => undefined);
  };

  const autoDetect = () => {
    call('beamng:detect')
      .then(({ installs }) => {
        const found = installs.find((i) => i.ok);
        if (found) {
          changeDir(found.dir);
          setNotice(installs.filter((i) => i.ok).length > 1 ? 'Several installs found; picked the one BeamNG last ran from.' : null);
        } else {
          setNotice('No BeamNG.drive install was found automatically. Use Browse to pick the folder that contains BeamNG.drive.exe.');
        }
      })
      .catch(() => undefined);
  };

  const trimmedDir = dir.trim();
  const dirChanged = trimmedDir !== (settings.beamngInstallDir ?? '');
  const dirValid = !trimmedDir || (check.state === 'done' && check.forDir === trimmedDir && check.result.ok);
  const canSave = !saving && (!dirChanged || dirValid);

  const save = () => {
    const patch: SettingsPatch = {};
    if (debug !== settings.debugLogging) patch.debugLogging = debug;
    if (ghost !== settings.focusGhostOpacity) patch.focusGhostOpacity = ghost;
    if (autoMeshNames !== settings.autoRenameMeshes) patch.autoRenameMeshes = autoMeshNames;
    if (autoDisplayNames !== settings.autoRenameDisplayNames) patch.autoRenameDisplayNames = autoDisplayNames;
    if (dirChanged) patch.beamngInstallDir = trimmedDir || null;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    call('settings:update', patch)
      .then(() => {
        pushStatus('Settings saved', 'success');
        onClose();
      })
      .catch((err: unknown) => {
        setSaving(false);
        setSaveError(err instanceof IpcCallError ? err.ipcError.message : String(err));
      });
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Settings"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!canSave} data-testid="settings-save">
            Save
          </Button>
        </>
      }
    >
      <div data-testid="settings-modal">
        <FieldGroup title="BeamNG.drive">
          <Field
            label="Install folder"
            htmlFor={dirId}
            hint="The game folder containing BeamNG.drive.exe. Official vehicles are read from here (never modified) to verify every exported format."
          >
            <Input id={dirId} mono value={dir} onChange={(e) => changeDir(e.target.value)} placeholder="e.g. C:\Program Files (x86)\Steam\steamapps\common\BeamNG.drive" data-testid="beamng-dir" />
            <Button icon={FolderOpen} onClick={browse}>
              Browse
            </Button>
            <Button icon={ScanSearch} onClick={autoDetect}>
              Detect
            </Button>
          </Field>
          <InstallStatus dir={trimmedDir} check={check} />
          {notice && (
            <Callout tone="info" className={styles.gap}>
              {notice}
            </Callout>
          )}
          <Field label="User folder" hint="Where BeamNG keeps mods and logs. Detected automatically.">
            <span className={styles.readonly} data-testid="beamng-user-dir">
              {settings.beamngUserDir ?? 'Not found'}
            </span>
          </Field>
        </FieldGroup>

        <FieldGroup title="Viewport">
          <Field label="Focus mode: other parts" hint="How much of the rest of the car stays visible while you work on one part. 0% hides it.">
            <Slider value={ghost} onChange={setGhost} min={0} max={0.6} step={0.02} format={(v) => `${Math.round(v * 100)}%`} aria-label="Focus mode ghost opacity" />
          </Field>
        </FieldGroup>

        <FieldGroup title="Naming">
          <Toggle checked={autoMeshNames} onChange={setAutoMeshNames} label="Auto-rename meshes" />
          <p className={styles.help}>Name each mesh after the part it&rsquo;s assigned to (rear_left_halfshaft, rear_left_halfshaft_2…). Names you type yourself are never changed.</p>
          <Toggle checked={autoDisplayNames} onChange={setAutoDisplayNames} label="Auto-rename display names" />
          <p className={styles.help}>Drop numbered leftovers from in-game part names, so &ldquo;Hood (2)&rdquo; becomes &ldquo;Hood&rdquo;.</p>
        </FieldGroup>

        <FieldGroup title="Diagnostics">
          <Toggle checked={debug} onChange={setDebug} label="Debug logging" />
          <p className={styles.help}>Writes more detail to the log file (Help → Open Log Folder). Useful when reporting a problem.</p>
        </FieldGroup>

        {saveError && (
          <Callout tone="danger" title="Could not save settings">
            {saveError}
          </Callout>
        )}
      </div>
    </Modal>
  );
}

function InstallStatus({ dir, check }: { dir: string; check: Check }) {
  if (!dir) {
    return (
      <Callout tone="warning" className={styles.gap}>
        No install folder set. Ground-truth checks and exports need BeamNG.drive installed.
      </Callout>
    );
  }
  if (check.state === 'idle' || check.state === 'checking' || check.forDir !== dir) {
    return <p className={styles.help}>Checking folder…</p>;
  }
  if (check.state === 'error') {
    return (
      <Callout tone="danger" className={styles.gap}>
        {check.message}
      </Callout>
    );
  }
  const r = check.result;
  if (r.ok) {
    return (
      <Callout tone="success" className={styles.gap} more={r.build ?? undefined}>
        <span data-testid="beamng-status">{describeInstallValidation(r)}</span>
      </Callout>
    );
  }
  return (
    <Callout tone="danger" title="Not a BeamNG.drive install" className={styles.gap}>
      <span data-testid="beamng-status">{r.problems.join(' ')}</span>
    </Callout>
  );
}
