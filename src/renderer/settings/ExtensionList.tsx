import { useEffect, useState } from 'react';
import { Download, FolderOpen, FolderPlus, Plus, RefreshCw } from 'lucide-react';
import type { ExtensionInfo } from '@shared/extensions/api';
import { call } from '@renderer/diagnostics/ipc';
import { startExtensions, useExtensions } from '@renderer/extensions/host';
import { useUiStore } from '@renderer/app/stores/ui';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Toggle } from '@renderer/ui/components/Toggle';
import styles from './SettingsModal.module.css';

/** The extensions folder's contents: switch each on or off, see what it adds and any error. */
export function ExtensionList({ disabled, onDisabled }: { disabled: readonly string[]; onDisabled: (ids: string[]) => void }) {
  const list = useExtensions((s) => s.list);
  const loading = useExtensions((s) => s.loading);
  const reload = () => void startExtensions();
  return (
    <div className={styles.extensions} data-testid="extension-list">
      <div className={styles.row}>
        <Button
          size="sm"
          icon={Plus}
          onClick={() =>
            void call('extensions:create').then((folder) => {
              useUiStore.getState().pushStatus(`New extension in ${folder}: edit main.js, then Reload.`, 'success', 8000);
              reload();
            })
          }
          data-testid="extension-new"
        >
          New extension
        </Button>
        <Button size="sm" icon={FolderPlus} onClick={() => void call('extensions:install').then((f) => f && reload())}>
          Install from a folder…
        </Button>
        <Button size="sm" icon={FolderOpen} variant="ghost" onClick={() => void call('extensions:reveal')}>
          Open the folder
        </Button>
        <Button size="sm" icon={RefreshCw} variant="ghost" onClick={reload} disabled={loading}>
          Reload
        </Button>
      </div>
      {!list.length && <p className={styles.help}>No extensions yet. New extension makes one to start from (see docs/extensions.md for what they can do).</p>}
      <ul className={styles.extensionItems}>
        {list.map((e) => (
          <li key={e.folder} className={styles.extensionItem}>
            <Toggle checked={!disabled.includes(e.id)} onChange={(on) => onDisabled(on ? disabled.filter((x) => x !== e.id) : [...disabled, e.id])} aria-label={`${e.name} on`} />
            <div className={styles.extensionText}>
              <strong>
                {e.name} <span className={styles.help}>{e.version}</span>
              </strong>
              {e.description && <span className={styles.help}>{e.description}</span>}
              <span className={styles.help}>
                {e.running ? `Running: ${e.commands.length} command${e.commands.length === 1 ? '' : 's'}, ${e.templates.length} script template${e.templates.length === 1 ? '' : 's'}` : 'Off'}
              </span>
              {e.permissions.length > 0 && (
                <span className={styles.help}>
                  May also: {e.permissions.map((p) => (p === 'files' ? 'read folders you pick for it' : 'import models and start mods')).join(' · ')}{' '}
                  {e.permissions.includes('files') && (
                    <button type="button" className={styles.linkButton} onClick={() => void call('extfs:forget', { id: e.id }).then(() => useUiStore.getState().pushStatus(`${e.name} forgets its folders`, 'success'))}>
                      Forget its folders
                    </button>
                  )}
                </span>
              )}
              {e.error && <span className={styles.errorText}>{e.error}</span>}
            </div>
            {e.running && <Badge tone="success">On</Badge>}
          </li>
        ))}
      </ul>
      <Examples installed={list.map((e) => e.id)} onInstalled={reload} />
    </div>
  );
}

/** Example extensions shipped with the app: install one to use it, or read it to learn. */
function Examples({ installed, onInstalled }: { installed: readonly string[]; onInstalled: () => void }) {
  const [examples, setExamples] = useState<ExtensionInfo[]>([]);
  useEffect(() => {
    void call('extensions:examples').then(setExamples).catch(() => undefined);
  }, []);
  if (!examples.length) return null;
  return (
    <div className={styles.examples} data-testid="extension-examples">
      <strong>Examples that come with JBeam Forge</strong>
      <ul className={styles.extensionItems}>
        {examples.map((e) => {
          const m = e.manifest!;
          const has = installed.includes(m.id);
          return (
            <li key={m.id} className={styles.extensionItem}>
              <div className={styles.extensionText}>
                <strong>
                  {m.name} <span className={styles.help}>{m.version}</span>
                </strong>
                <span className={styles.help}>{m.description}</span>
              </div>
              <Button
                size="sm"
                icon={Download}
                disabled={has}
                onClick={() =>
                  void call('extensions:installExample', { id: m.id }).then((folder) => {
                    useUiStore.getState().pushStatus(`Installed ${m.name} in ${folder}`, 'success', 6000);
                    onInstalled();
                  })
                }
                data-testid={`extension-example-${m.id}`}
              >
                {has ? 'Installed' : 'Install'}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
