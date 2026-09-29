import { useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, RefreshCw, Trash2, X } from 'lucide-react';
import type { ContentKind, ContentManifest } from '@shared/content/manifest';
import type { ContentInfo, ContentProgress, ContentRef, DownloadResult } from '@shared/content/types';
import { call } from '@renderer/diagnostics/ipc';
import { useUiStore } from '@renderer/app/stores/ui';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { Input } from '@renderer/ui/components/Input';
import { Select } from '@renderer/ui/components/Select';
import { errorText, formatBytes } from './format';
import styles from './Downloads.module.css';

const LABEL: Record<ContentKind, { one: string; many: string; what: string }> = {
  textures: {
    one: 'texture set',
    many: 'textures',
    what: 'Materials with their textures: paints, metals, plastics, fabrics, carbon…',
  },
  meshes: {
    one: 'mesh',
    many: 'meshes',
    what: 'Ready-made parts: calipers, discs, gauges, suspension and steering pieces…',
  },
  scripts: {
    one: 'script',
    many: 'scripts',
    what: 'Vehicle scripts to add to any car in the Scripts tab: functions, effects, screens…',
  },
};

/** How many rows the list shows at once (search narrows it). */
const SHOWN = 400;

type Show = 'all' | 'installed' | 'missing' | 'updates';

/**
 * One content repository (textures or meshes): download everything or pick
 * items, choose the latest or an earlier version, update what changed, and
 * remove. Items are saved beside the program, where the Materials library
 * and Objects panel pick them up.
 */
export function ContentTab({ kind, info, onInfo }: { kind: ContentKind; info: ContentInfo | null; onInfo: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const pushStatus = useUiStore((s) => s.pushStatus);
  const branch = settings?.contentBranch ?? 'main';
  const [ref, setRef] = useState(branch);
  const [refs, setRefs] = useState<ContentRef[] | null>(null);
  const [manifest, setManifest] = useState<ContentManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ContentProgress | null>(null);
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('*');
  const [show, setShow] = useState<Show>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const status = info?.[kind];
  const installed = status?.installed.items ?? {};
  // A download already running when the window opened (it was closed and opened again) counts as busy too.
  const busy = progress ? progress.state === 'running' : !!status?.busy;

  const [loading, setLoading] = useState(true);
  const fetchManifest = (r: string) =>
    call('content:manifest', { kind, ref: r })
      .then((m) => {
        setManifest(m);
        setError(null);
      })
      .catch((err: unknown) => {
        setManifest(null);
        setError(errorText(err));
      })
      .finally(() => setLoading(false));
  const loadManifest = (r = ref) => {
    setLoading(true);
    setError(null);
    void fetchManifest(r);
  };
  useEffect(() => void fetchManifest(ref), [kind, ref]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      window.forge.on('content:progress', (p) => {
        if (p.kind === kind) setProgress(p);
      }),
    [kind],
  );

  const loadRefs = () => {
    if (refs) return;
    call('content:refs', { kind })
      .then(setRefs)
      .catch((err: unknown) => setError(errorText(err)));
  };

  const items = useMemo(() => manifest?.items ?? [], [manifest]);
  const stateOf = (id: string, sha: string) => (!installed[id] ? 'missing' : installed[id].sha256 === sha ? 'installed' : 'update');
  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== '*' && i.category !== category) return false;
      if (q && !`${i.name} ${i.category} ${i.group ?? ''}`.toLowerCase().includes(q)) return false;
      const st = stateOf(i.id, i.sha256);
      return show === 'all' || (show === 'installed' ? st !== 'missing' : show === 'missing' ? st === 'missing' : st === 'update');
    });
  }, [items, query, category, show, installed]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = items.filter((i) => stateOf(i.id, i.sha256) === 'missing');
  const updates = items.filter((i) => stateOf(i.id, i.sha256) === 'update');
  const installedCount = Object.keys(installed).length;
  const installedBytes = Object.values(installed).reduce((n, i) => n + i.size, 0);
  const pickedItems = items.filter((i) => selected.has(i.id));
  const pickedToFetch = pickedItems.filter((i) => stateOf(i.id, i.sha256) !== 'installed');
  const pickedInstalled = pickedItems.filter((i) => installed[i.id]);
  // Installed items the chosen version doesn't have (removed from the repository, or not in an older version).
  const listed = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const orphans = Object.keys(installed).filter((id) => !listed.has(id));

  const run = async (ids: string[] | 'all') => {
    setResult(null);
    setError(null);
    setProgress({
      kind,
      done: 0,
      total: 0,
      bytesDone: 0,
      bytesTotal: 0,
      current: null,
      failed: [],
      state: 'running',
    });
    try {
      const r = await call('content:download', { kind, ref, ids });
      setResult(r);
      setSelected(new Set());
      pushStatus(r.cancelled ? `Stopped: ${r.installed.length} ${LABEL[kind].many} downloaded` : `${r.installed.length} ${LABEL[kind].many} downloaded${r.failed.length ? `, ${r.failed.length} failed` : ''}`, r.failed.length ? 'warning' : 'success');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setProgress((p) => (p ? { ...p, state: 'finished' } : p));
      onInfo();
    }
  };

  const remove = async (ids: string[] | 'all') => {
    setError(null);
    try {
      const gone = await call('content:remove', { kind, ids });
      setSelected(new Set());
      pushStatus(`${gone.length} ${LABEL[kind].many} removed`, 'success');
    } catch (err) {
      setError(errorText(err));
    } finally {
      onInfo();
    }
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const allShownPicked = filtered.length > 0 && filtered.slice(0, SHOWN).every((i) => selected.has(i.id));
  const repo = settings ? { textures: settings.texturesRepo, meshes: settings.meshesRepo, scripts: settings.scriptsRepo }[kind] : undefined;
  const refOptions = [
    { value: branch, label: `Latest (${branch})` },
    ...(refs ?? [])
      .filter((r) => r.type === 'tag')
      .map((r) => ({
        value: r.name,
        label: `Version ${r.name.replace(/^v/, '')}`,
      })),
  ];
  if (!refOptions.some((o) => o.value === ref)) refOptions.push({ value: ref, label: ref });

  return (
    <div className={styles.panel} data-testid={`downloads-${kind}`}>
      <div className={styles.row}>
        <div className={styles.grow}>
          <p className={styles.headline}>
            {installedCount} of {manifest ? items.length : '…'} {LABEL[kind].many} downloaded {installedCount > 0 && <span className={styles.note}>({formatBytes(installedBytes)})</span>}
            {status?.installed.version && <Badge>version {status.installed.version}</Badge>}
            {updates.length > 0 && <Badge tone="accent">{updates.length} updated</Badge>}
          </p>
          <p className={styles.note}>{LABEL[kind].what}</p>
        </div>
        <Select
          value={ref}
          onChange={(v) => {
            setLoading(true);
            setRef(v);
          }}
          options={refOptions}
          aria-label={`${LABEL[kind].many} version`}
          className={styles.filter}
        />
        <Button size="sm" variant="ghost" onClick={loadRefs} disabled={!!refs}>
          {refs ? `${refs.filter((r) => r.type === 'tag').length} versions` : 'Older versions…'}
        </Button>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => loadManifest()} disabled={loading} aria-label="Check again" />
      </div>
      {status && (
        <div className={styles.row}>
          <span className={`${styles.mono} ${styles.grow}`} title={status.dir}>
            {status.dir}
          </span>
          <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void call('content:reveal', { kind })}>
            Open folder
          </Button>
        </div>
      )}
      {info?.fallback && (
        <Callout tone="warning">
          {info.preferred} can&rsquo;t be written to, so downloads go to {info.root}. Choose another folder in Settings → Downloads.
        </Callout>
      )}
      {error && (
        <Callout tone="danger" title={`Couldn't get the ${LABEL[kind].many}`}>
          {error} {repo && <span className={styles.note}>(repository {repo})</span>}
        </Callout>
      )}
      <div className={styles.row}>
        <Button variant="primary" icon={Download} disabled={busy || !manifest || (!missing.length && !updates.length)} onClick={() => void run('all')} data-testid={`${kind}-download-all`}>
          {!manifest ? 'Download all' : missing.length || updates.length ? `Download all (${formatBytes([...missing, ...updates].reduce((n, i) => n + i.size, 0))})` : 'All downloaded'}
        </Button>
        {updates.length > 0 && (
          <Button icon={RefreshCw} disabled={busy} onClick={() => void run(updates.map((i) => i.id))}>
            Update {updates.length} changed
          </Button>
        )}
        <Button icon={Download} disabled={busy || !pickedToFetch.length} onClick={() => void run(pickedToFetch.map((i) => i.id))} data-testid={`${kind}-download-selected`}>
          Download selected
          {pickedToFetch.length ? ` (${pickedToFetch.length}, ${formatBytes(pickedToFetch.reduce((n, i) => n + i.size, 0))})` : ''}
        </Button>
        <span className={styles.grow} />
        <Button variant="ghost" icon={Trash2} disabled={busy || !pickedInstalled.length} onClick={() => void remove(pickedInstalled.map((i) => i.id))}>
          Remove selected
        </Button>
        <Button variant="ghost" icon={Trash2} disabled={busy || !installedCount} onClick={() => void remove('all')} data-testid={`${kind}-remove-all`}>
          Remove all
        </Button>
      </div>
      {busy && (
        <div className={styles.card} data-testid={`${kind}-progress`}>
          <div className={styles.row}>
            <span className={styles.grow}>
              {progress?.total ? `${progress.done} of ${progress.total}` : 'Starting'}
              {progress?.current ? `: ${progress.current}` : ''} · {formatBytes(progress?.bytesDone ?? 0)}
              {progress?.bytesTotal ? ` of ${formatBytes(progress.bytesTotal)}` : ''}
            </span>
            <Button size="sm" variant="ghost" icon={X} onClick={() => void call('content:cancel', { kind })}>
              Cancel
            </Button>
          </div>
          <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={progress?.bytesTotal || 1} aria-valuenow={progress?.bytesDone ?? 0}>
            <div
              className={styles.bar}
              style={{
                width: `${progress?.bytesTotal ? (progress.bytesDone / progress.bytesTotal) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      {result && result.failed.length > 0 && (
        <Callout tone="warning" title={`${result.failed.length} couldn't be downloaded`} more={result.failed.map((f) => `${f.name}: ${f.error}`).join('\n')}>
          The rest are in place. Try again to fetch just these.
        </Callout>
      )}
      {orphans.length > 0 && manifest && (
        <p className={styles.note}>
          {orphans.length} downloaded {orphans.length === 1 ? LABEL[kind].one : LABEL[kind].many} aren&rsquo;t in this version; they stay until you remove them.{' '}
          <Button size="sm" variant="ghost" onClick={() => void remove(orphans)}>
            Remove them
          </Button>
        </p>
      )}
      <div className={styles.row}>
        <Input className={styles.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${LABEL[kind].many}`} aria-label={`Search ${LABEL[kind].many}`} />
        <Select value={category} onChange={setCategory} options={[{ value: '*', label: 'Every category' }, ...categories.map((c) => ({ value: c, label: c }))]} aria-label="Category" className={styles.filter} />
        <Select<Show>
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'installed', label: 'Downloaded' },
            { value: 'missing', label: 'Not downloaded' },
            { value: 'updates', label: 'Updated' },
          ]}
          aria-label="Show"
          className={styles.filter}
        />
        <Checkbox
          checked={allShownPicked}
          onChange={(on) => {
            const next = new Set(selected);
            for (const i of filtered.slice(0, SHOWN)) {
              if (on) next.add(i.id);
              else next.delete(i.id);
            }
            setSelected(next);
          }}
          label="Select shown"
        />
      </div>
      {loading && !manifest && <p className={styles.note}>Reading the list from GitHub…</p>}
      {manifest && (
        <ul className={styles.list} data-testid={`${kind}-items`}>
          {filtered.slice(0, SHOWN).map((i) => {
            const st = stateOf(i.id, i.sha256);
            return (
              <li key={i.id} className={styles.item} data-testid="content-item">
                <Checkbox checked={selected.has(i.id)} onChange={(on) => toggle(i.id, on)} aria-label={`Select ${i.name}`} />
                <div>
                  <div className={styles.itemName}>{i.name}</div>
                  <div className={styles.itemMeta}>
                    {i.category}
                    {i.group ? ` · ${i.group}` : ''} · {i.files} files
                  </div>
                </div>
                <span className={styles.size}>{formatBytes(i.size)}</span>
                {st === 'installed' ? <Badge tone="success">Downloaded</Badge> : st === 'update' ? <Badge tone="accent">Update</Badge> : <Badge>Not downloaded</Badge>}
                {st === 'installed' ? (
                  <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={() => void remove([i.id])} aria-label={`Remove ${i.name}`} />
                ) : (
                  <Button size="sm" variant="ghost" icon={Download} disabled={busy} onClick={() => void run([i.id])} aria-label={`Download ${i.name}`} data-testid="content-item-download" />
                )}
              </li>
            );
          })}
          {filtered.length > SHOWN && (
            <li className={styles.item}>
              Showing {SHOWN} of {filtered.length}: search or pick a category to narrow it.
            </li>
          )}
          {!filtered.length && <li className={styles.item}>Nothing matches.</li>}
        </ul>
      )}
    </div>
  );
}
