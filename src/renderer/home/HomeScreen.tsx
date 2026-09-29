import { useCallback, useEffect, useState } from 'react';
import { Car, Clock, CloudDownload, FolderOpen, Settings, FolderSearch, ImageOff, Plus, Trash2, X } from 'lucide-react';
import type { RecentProject } from '@shared/ipc-contract';
import { relativeTime } from '@shared/text';
import { call } from '@renderer/diagnostics/ipc';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { openProject, openRecentProject } from '@renderer/project/actions';
import { Badge } from '@renderer/ui/components/Badge';
import { ContextMenu } from '@renderer/ui/components/ContextMenu';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { iconSize } from '@renderer/ui/tokens';
import styles from './HomeScreen.module.css';

let triedLastProject = false;

/** Startup screen (SPEC §4.1): New Mod / Open cards + recent projects. */
export function HomeScreen() {
  const [recent, setRecent] = useState<RecentProject[] | null>(null);
  const setNewModOpen = useDialogStore((s) => s.setNewModOpen);

  const refresh = useCallback(() => {
    call('recent:list')
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  useEffect(refresh, [refresh]);

  // Settings → General: open the last project at startup (once per launch; the home screen comes back after closing it).
  const openLast = useSettingsStore((s) => s.settings?.openLastProject);
  useEffect(() => {
    if (triedLastProject || openLast === undefined || !recent) return;
    triedLastProject = true;
    const last = recent[0];
    if (openLast && last?.exists) void openRecentProject(last.path);
  }, [openLast, recent]);

  const remove = (path: string) => {
    call('recent:remove', { path }).then(refresh).catch(() => undefined);
  };

  return (
    <div className={styles.home} data-testid={recent ? 'app-ready' : 'app-loading'} data-view="home">
      <ScrollArea className={styles.scroll}>
        <div className={styles.column}>
          <header className={styles.header}>
            <h1 className={styles.title}>JBeam Forge</h1>
            <p className={styles.subtitle}>Turn a 3D vehicle model into an installable BeamNG.drive mod · v{__APP_VERSION__}</p>
            <div className={styles.headerActions}>
              <IconButton icon={CloudDownload} label="Downloads: updates, textures and meshes" onClick={() => useDialogStore.getState().setDownloads('app')} data-testid="home-downloads" />
              <IconButton icon={Settings} label="Settings" onClick={() => useDialogStore.getState().setSettingsOpen(true)} data-testid="home-settings" />
            </div>
          </header>

          <div className={styles.cards}>
            <button type="button" className={`${styles.card} ${styles.primaryCard}`} onClick={() => setNewModOpen(true)} data-testid="home-new">
              <Plus className={styles.cardIcon} size={iconSize('size-icon-lg')} aria-hidden />
              <span className={styles.cardTitle}>New mod</span>
              <span className={styles.cardText}>Start from a 3D model: import, classify parts, generate the jbeam.</span>
            </button>
            <button type="button" className={styles.card} onClick={() => void openProject().then(refresh)} data-testid="home-open">
              <FolderOpen className={styles.cardIcon} size={iconSize('size-icon-lg')} aria-hidden />
              <span className={styles.cardTitle}>Open existing</span>
              <span className={styles.cardText}>Continue a .jbforge project.</span>
            </button>
          </div>

          <section className={styles.recent} aria-labelledby="recent-heading">
            <h2 id="recent-heading" className={styles.sectionTitle}>
              Recent projects
            </h2>
            {recent && recent.length === 0 && (
              <div className={styles.empty}>
                <EmptyState icon={Clock} message="No recent projects yet. Projects you open or save appear here." />
              </div>
            )}
            <ul className={styles.list}>
              {recent?.map((r) => (
                <li key={r.path}>
                  <ContextMenu
                    items={[
                      { label: 'Open', icon: FolderOpen, onSelect: () => void openRecentProject(r.path), disabled: !r.exists },
                      { label: 'Show in folder', icon: FolderSearch, onSelect: () => void call('shell:showItemInFolder', { path: r.path }).catch(() => undefined), disabled: !r.exists },
                      { type: 'separator' },
                      { label: 'Remove from recent', icon: Trash2, onSelect: () => remove(r.path), danger: true },
                    ]}
                  >
                    <div className={styles.row} data-testid="recent-row">
                      <button type="button" className={styles.rowMain} disabled={!r.exists} onClick={() => void openRecentProject(r.path)} title={r.path}>
                        <span className={styles.thumb}>
                          {r.thumbnail ? <img src={r.thumbnail} alt="" /> : r.exists ? <Car size={iconSize('size-icon')} aria-hidden /> : <ImageOff size={iconSize('size-icon')} aria-hidden />}
                        </span>
                        <span className={styles.rowText}>
                          <span className={styles.rowName}>
                            {r.name}
                            {!r.exists && <Badge tone="warning">missing</Badge>}
                          </span>
                          <span className={styles.rowPath}>{r.path}</span>
                        </span>
                        <span className={styles.rowTime}>{relativeTime(r.openedAt)}</span>
                      </button>
                      <IconButton icon={X} label="Remove from recent" size="sm" className={styles.rowAction} onClick={() => remove(r.path)} />
                    </div>
                  </ContextMenu>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
