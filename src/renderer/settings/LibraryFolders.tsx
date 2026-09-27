import { useEffect, useState } from 'react';
import { FolderPlus, RefreshCw, X } from 'lucide-react';
import type { LibraryStatus } from '@shared/ipc-contract';
import { call } from '@renderer/diagnostics/ipc';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import styles from './SettingsModal.module.css';

/** One kind of library folder list (materials or objects), edited as a draft until Save. */
export function LibraryFolderList({ kind, folders, onChange, status }: { kind: 'materials' | 'objects'; folders: string[]; onChange: (next: string[]) => void; status: LibraryStatus | null }) {
  const add = () => {
    call('dialog:pickDirectory', { title: kind === 'materials' ? 'Add a folder of materials (textures, MaterialX)' : 'Add a folder of objects (meshes: calipers, gauges…)' })
      .then((picked) => {
        if (picked && !folders.some((f) => f.toLowerCase() === picked.toLowerCase())) onChange([...folders, picked]);
      })
      .catch(() => undefined);
  };
  return (
    <div className={styles.folders} data-testid={`library-folders-${kind}`}>
      {folders.length === 0 && <p className={styles.help}>None yet.</p>}
      {folders.map((f) => {
        const s = status?.folders.find((x) => x.kind === kind && x.folder === f);
        return (
          <div key={f} className={styles.folderRow}>
            <span className={styles.readonly} title={f}>
              {f}
            </span>
            <span className={styles.folderCount}>{s ? (s.error ? s.error : `${s.count} ${kind}`) : status?.scanning ? 'scanning…' : 'not scanned yet'}</span>
            <IconButton icon={X} label="Remove folder" size="sm" onClick={() => onChange(folders.filter((x) => x !== f))} />
          </div>
        );
      })}
      <Button icon={FolderPlus} size="sm" onClick={add}>
        Add folder
      </Button>
    </div>
  );
}

/** What the last scan found, refreshed when a scan finishes; plus Scan now. */
export function useLibraryStatus(): [LibraryStatus | null, () => void] {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void call('library:status').then((s) => alive && setStatus(s));
    const off = window.forge.on('library:changed', (s) => alive && setStatus(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const rescan = () => {
    setStatus((s) => (s ? { ...s, scanning: true } : { scanning: true, folders: [] }));
    void call('library:rescan').then(setStatus);
  };
  return [status, rescan];
}

export function ScanNow({ status, onScan }: { status: LibraryStatus | null; onScan: () => void }) {
  return (
    <Button icon={RefreshCw} size="sm" onClick={onScan} disabled={status?.scanning} data-testid="library-rescan">
      {status?.scanning ? 'Scanning…' : 'Scan now'}
    </Button>
  );
}

/** The suspension parts cut from the BeamNG install (automatic once the install folder is set). */
export function BeamngParts({ status }: { status: LibraryStatus | null }) {
  const s = status?.folders.find((f) => f.kind === 'beamng');
  const text = !s ? (status?.scanning ? 'Reading suspension, brake and steering parts from BeamNG…' : 'Set the BeamNG.drive install folder above to add its suspension, brake and steering parts to the Objects panel.') : s.error ? `BeamNG parts could not be read: ${s.error}` : `${s.count} suspension, brake and steering parts from your BeamNG.drive install are in the Objects panel (for use in your own mods; they stay on this computer).`;
  return (
    <p className={styles.help} data-testid="beamng-parts">
      {text}
    </p>
  );
}
