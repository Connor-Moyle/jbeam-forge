import { useEffect, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import type { IngameStatus } from '@shared/beamng';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { call } from '@renderer/diagnostics/ipc';
import { useUiStore } from '@renderer/app/stores/ui';
import styles from './SettingsModal.module.css';

/**
 * JBeam Forge inside BeamNG.drive (F10 in the game): it comes with this app and is kept at the
 * same version. Settings → BeamNG installs it; at startup an older copy in the game is updated.
 */

const describe = (s: IngameStatus) =>
  !s.modsDir
    ? 'BeamNG’s user folder wasn’t found'
    : !s.installed
      ? 'Not installed in the game'
      : s.updateAvailable
        ? `Version ${s.installed} installed; ${s.bundled} is ready to install`
        : `Version ${s.installed} installed${s.unpacked ? ' (unpacked)' : ''}`;

/** At startup: bring the game's copy up to this app's version (only if it was installed before). */
export async function syncIngameOnStartup(): Promise<void> {
  if ((window.forge as { ingame?: boolean }).ingame) return;
  try {
    const s = await call('ingame:status', undefined);
    if (!s.updateAvailable) return;
    const r = await call('ingame:install', undefined);
    useUiStore.getState().pushStatus(`Updated JBeam Forge in BeamNG.drive to ${r.installed}. Press F10 in the game to open it.`, 'success', 8000);
  } catch (err) {
    useUiStore.getState().pushStatus(`JBeam Forge in BeamNG.drive couldn’t be updated: ${err instanceof Error ? err.message : String(err)}`, 'warning', 10000);
  }
}

export function IngameVersion() {
  const [status, setStatus] = useState<IngameStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call('ingame:status', undefined)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  if (!status) return null;
  const install = () => {
    setBusy(true);
    call('ingame:install', undefined)
      .then((r) => {
        setStatus(r);
        useUiStore.getState().pushStatus(`JBeam Forge ${r.installed} is in BeamNG.drive. Start the game and press F10.`, 'success', 8000);
      })
      .catch((err: Error) => useUiStore.getState().pushStatus(err.message, 'danger', 10000))
      .finally(() => setBusy(false));
  };
  const canInstall = !!status.modsDir && !!status.bundled && (!status.installed || status.updateAvailable);
  return (
    <Field label="JBeam Forge in the game" hint="Press F10 while driving to open JBeam Forge inside BeamNG.drive, on the car you’re in. It comes with this app and updates with it.">
      <span className={styles.readonly} data-testid="ingame-status">
        {describe(status)}
      </span>
      {canInstall && (
        <Button icon={Gamepad2} variant="primary" onClick={install} disabled={busy} data-testid="ingame-install">
          {busy ? 'Installing…' : status.installed ? 'Update' : 'Install'}
        </Button>
      )}
    </Field>
  );
}
