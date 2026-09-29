import { useEffect, useState } from 'react';
import { Download, FolderOpen, History, RefreshCw, Rocket, Trash2, X } from 'lucide-react';
import type { AppRelease, ReleaseAsset, UpdatesInfo } from '@shared/content/types';
import { isNewer } from '@shared/content/versions';
import { call } from '@renderer/diagnostics/ipc';
import { projectStore, isDirty } from '@renderer/app/stores/project';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { errorText, formatBytes, formatDate } from './format';
import styles from './Downloads.module.css';

interface Job {
  asset: string;
  done: number;
  total: number;
}

/**
 * JBeam Forge itself: the newest version on GitHub, and every earlier one to
 * roll back to. The installer (or, when running the portable exe, a new
 * portable exe) is downloaded, checked, then run or shown.
 */
export function AppVersions() {
  const [info, setInfo] = useState<UpdatesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);

  const fetchInfo = () =>
    call('updates:info')
      .then((i) => {
        setInfo(i);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setLoading(false));
  const load = () => {
    setLoading(true);
    setError(null);
    void fetchInfo();
  };
  useEffect(() => void fetchInfo(), []);  
  useEffect(() => window.forge.on('updates:progress', (p) => setJob((j) => (j && j.asset === p.asset ? { ...j, done: p.done, total: p.total } : j))), []);

  const pick = (r: AppRelease): ReleaseAsset | undefined => r.assets.find((a) => a.role === (info?.portable ? 'portable' : 'installer')) ?? r.assets.find((a) => a.role === 'installer' || a.role === 'portable');

  const download = async (r: AppRelease, a: ReleaseAsset) => {
    setError(null);
    setReady(null);
    setJob({ asset: a.name, done: 0, total: a.size });
    try {
      await call('updates:download', { tag: r.tag, asset: a.name });
      setReady(a.name);
      setInfo((i) => (i ? { ...i, downloaded: [...i.downloaded.filter((d) => d.name !== a.name), { name: a.name, size: a.size }] } : i));
    } catch (err) {
      const text = errorText(err);
      if (!/cancel/i.test(text)) setError(text);
    } finally {
      setJob(null);
    }
  };

  const run = async (asset: string) => {
    // The installer closes the app: unsaved work gets saved (or not) first.
    const installing = /setup/i.test(asset) && info?.platform === 'win32';
    let discard = false;
    if (installing && isDirty(projectStore.getState())) {
      const choice = await useDialogStore.getState().askUnsaved(projectStore.getState().doc?.meta.name ?? 'this project');
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const { saveProject } = await import('@renderer/project/actions');
        if (!(await saveProject())) return;
      } else discard = true;
    }
    try {
      const r = await call('updates:run', { asset });
      // Only once the installer is really running: stop the close guard asking again about work already discarded.
      if (r === 'installing' && discard) await call('window:setDirty', { dirty: false });
      if (r === 'shown') setReady(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const latest = info?.releases[0];
  const upToDate = !!info && !!latest && !isNewer(latest.version, info.current);
  const older = info?.releases.slice(1) ?? [];
  const isDownloaded = (a: ReleaseAsset) => info?.downloaded.some((d) => d.name === a.name && d.size === a.size);

  const assetButtons = (r: AppRelease, rollback: boolean) => {
    const assets = r.assets.filter((a) => a.role === 'installer' || a.role === 'portable');
    if (!assets.length) return <span className={styles.note}>No downloads in this release</span>;
    return assets.map((a) =>
      isDownloaded(a) ? (
        <Button key={a.name} size="sm" icon={a.role === 'installer' ? Rocket : FolderOpen} variant={a === pick(r) ? 'primary' : 'default'} onClick={() => void run(a.name)} data-testid="update-run">
          {a.role === 'installer' ? (rollback ? 'Install this version' : 'Install') : 'Show portable exe'}
        </Button>
      ) : (
        <Button key={a.name} size="sm" icon={rollback ? History : Download} variant={a === pick(r) && !rollback ? 'primary' : 'default'} disabled={!!job} onClick={() => void download(r, a)} data-testid={rollback ? 'update-rollback' : 'update-download'}>
          {a.role === 'installer' ? 'Installer' : 'Portable'} · {formatBytes(a.size)}
        </Button>
      ),
    );
  };

  return (
    <div className={styles.panel} data-testid="downloads-app">
      <div className={styles.row}>
        <p className={styles.headline}>
          JBeam Forge {info?.current ?? ''}
          {info && latest && (upToDate ? <Badge tone="success">Up to date</Badge> : <Badge tone="accent">{latest.version} is out</Badge>)}
          {info?.portable && <Badge>Portable</Badge>}
        </p>
        <span className={styles.grow} />
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>
          Check again
        </Button>
      </div>
      {error && (
        <Callout tone="danger" title="Couldn't reach GitHub">
          {error}
        </Callout>
      )}
      {loading && !info && <p className={styles.note}>Checking GitHub for versions…</p>}
      {info && !info.releases.length && !error && <p className={styles.note}>No versions are published yet.</p>}
      {job && (
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.grow}>
              Downloading {job.asset}: {formatBytes(job.done)} of {formatBytes(job.total)}
            </span>
            <Button size="sm" variant="ghost" icon={X} onClick={() => void call('updates:cancel')}>
              Cancel
            </Button>
          </div>
          <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done}>
            <div className={styles.bar} style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {ready && (
        <Callout tone="success" title={`${ready} is downloaded and checked`}>
          <div className={styles.row}>
            {/setup/i.test(ready) ? (info?.platform === 'win32' ? 'Install it now: JBeam Forge closes and the installer takes over. Your downloaded textures and meshes are kept.' : 'The installer is for Windows; it’s in the downloads folder.') : 'Show it in its folder; run the new exe instead of this one.'}
            <Button size="sm" variant="primary" icon={/setup/i.test(ready) ? Rocket : FolderOpen} onClick={() => void run(ready)}>
              {/setup/i.test(ready) && info?.platform === 'win32' ? 'Install now' : 'Show'}
            </Button>
          </div>
        </Callout>
      )}
      {latest && (
        <section className={styles.card} data-testid="update-latest">
          <div className={styles.row}>
            <strong className={styles.grow}>
              {latest.name} {latest.prerelease && <Badge tone="warning">Pre-release</Badge>}
            </strong>
            <span className={styles.note}>{formatDate(latest.publishedAt)}</span>
          </div>
          <pre className={styles.notes}>{latest.notes || 'No release notes.'}</pre>
          <div className={styles.row}>{assetButtons(latest, false)}</div>
        </section>
      )}
      {older.length > 0 && (
        <section className={styles.card}>
          <div className={styles.row}>
            <strong className={styles.grow}>Older versions</strong>
            <Button size="sm" variant="ghost" icon={History} onClick={() => setShowOlder(!showOlder)} data-testid="update-older-toggle">
              {showOlder ? 'Hide' : `Roll back… (${older.length})`}
            </Button>
          </div>
          {showOlder && (
            <>
              <p className={styles.note}>Installing an older version replaces this one. Projects saved by a newer version may not open in an older one, so keep a copy. Your downloaded textures and meshes stay.</p>
              <ul className={styles.list} data-testid="update-older">
                {older.map((r) => (
                  <li key={r.tag} className={styles.release}>
                    <div>
                      <div className={styles.row}>
                        <strong>{r.version}</strong>
                        {r.prerelease && <Badge tone="warning">Pre-release</Badge>}
                        {info && r.version === info.current && <Badge tone="success">This version</Badge>}
                        <span className={styles.note}>{formatDate(r.publishedAt)}</span>
                        <Button size="sm" variant="ghost" onClick={() => setOpenNotes(openNotes === r.tag ? null : r.tag)}>
                          {openNotes === r.tag ? 'Hide notes' : 'Notes'}
                        </Button>
                      </div>
                      {openNotes === r.tag && <pre className={styles.notes}>{r.notes || 'No release notes.'}</pre>}
                    </div>
                    <div className={styles.row}>{assetButtons(r, true)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {info && info.downloaded.length > 0 && (
        <div className={styles.row}>
          <span className={styles.note}>
            Downloaded: {info.downloaded.map((d) => d.name).join(', ')} ({formatBytes(info.downloaded.reduce((n, d) => n + d.size, 0))})
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            onClick={() =>
              void call('updates:clear').then(() => {
                setReady(null);
                setInfo((i) => (i ? { ...i, downloaded: [] } : i));
              })
            }
          >
            Delete downloaded versions
          </Button>
        </div>
      )}
      <p className={styles.note}>Versions come from GitHub Releases (the repository is set in Settings → Downloads).</p>
    </div>
  );
}
