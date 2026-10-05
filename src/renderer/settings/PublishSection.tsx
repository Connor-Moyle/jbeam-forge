import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, Download, FolderOpen, FolderPlus } from 'lucide-react';
import type { ContentKind } from '@shared/content/manifest';
import type { PublishStatus } from '@shared/content/types';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { Field } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Select } from '@renderer/ui/components/Select';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { useUiStore } from '@renderer/app/stores/ui';
import styles from './SettingsModal.module.css';

/**
 * Settings → Downloads → Publishing: for whoever looks after the download library. New materials,
 * meshes and scripts go into a copy of the content repository on this computer; Publish commits
 * and pushes them, and the repository builds the downloads by itself.
 */

const message = (err: unknown) => (err instanceof IpcCallError ? err.message : err instanceof Error ? err.message : String(err));

export function usePublishStatus(): [PublishStatus | null, () => void] {
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const refresh = useCallback(() => {
    call('publish:status', undefined)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(refresh, [refresh]);
  return [status, refresh];
}

export function PublishSection() {
  const [status, refresh] = usePublishStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<ContentKind>('meshes');
  const [category, setCategory] = useState('');
  const push = useUiStore((s) => s.pushStatus);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    try {
      const done = await fn();
      if (done) push(done, 'success', 7000);
    } catch (err) {
      push(message(err), 'danger', 10000);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const choose = () =>
    run('choose', async () => {
      const dir = await call('dialog:pickDirectory', { title: 'Your copy of the content repository (jbeam-forge-content)' });
      if (dir) await call('settings:update', { contentRepoDir: dir });
    });
  const getCopy = () =>
    run('clone', async () => {
      const parent = await call('dialog:pickDirectory', { title: 'Where to put the copy (a jbeam-forge-content folder is made inside)' });
      if (!parent) return;
      const s = await call('publish:clone', { parent });
      return `Copy ready in ${s.dir}`;
    });
  const addFolder = () =>
    run('add', async () => {
      const source = await call('dialog:pickDirectory', { title: `A finished ${kind === 'textures' ? 'material' : kind === 'meshes' ? 'mesh' : 'script'} folder to add` });
      if (!source) return;
      const dest = await call('publish:addFolder', { kind, source, category: category.trim() || 'Other' });
      return `Added ${dest}. Publish to send it out.`;
    });
  const publish = () =>
    run('push', async () => {
      const r = await call('publish:push', { message: note });
      setNote('');
      return r.committed ? `Published ${r.committed} file${r.committed === 1 ? '' : 's'}. The download library updates in a few minutes.` : 'Nothing new to publish; pushed anyway.';
    });

  return (
    <CollapsibleSection id="settings-publish" title="Publishing to the download library" defaultOpen={false}>
      <p className={styles.help}>
        For whoever looks after the download library. New content goes into your copy of the content repository; Publish sends it, and the repository builds the downloads by itself. Materials and scripts have an “Add to the download library” button once a copy is chosen.
      </p>
      <Field label="Your copy">
        <span className={styles.readonly} title={status?.dir ?? undefined} data-testid="publish-dir">
          {status?.dir ?? 'None chosen'}
        </span>
        <Button icon={FolderOpen} onClick={() => void choose()} disabled={!!busy}>
          Choose
        </Button>
        <Button icon={Download} onClick={() => void getCopy()} disabled={!!busy} data-testid="publish-clone">
          {busy === 'clone' ? 'Downloading…' : 'Get a copy'}
        </Button>
      </Field>
      {status?.dir && !status.ok && <Callout tone="warning">{status.problem}</Callout>}
      {status?.ok && (
        <>
          <Field label="Add a finished folder" hint="A folder with object.json (meshes), material.json (textures) or script.jbscript (scripts) and its files.">
            <Select value={kind} onChange={setKind} options={[{ value: 'meshes', label: 'Mesh' }, { value: 'textures', label: 'Material' }, { value: 'scripts', label: 'Script' }]} aria-label="What kind of folder" />
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. Brakes)" aria-label="Category" />
            <Button icon={FolderPlus} onClick={() => void addFolder()} disabled={!!busy}>
              Add…
            </Button>
          </Field>
          <Field label="Publish" hint={`${status.changed ?? 0} changed file${status.changed === 1 ? '' : 's'} waiting${status.remote ? ` · ${status.remote.replace(/^https:\/\/github\.com\//, '')}` : ''}`}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's new (e.g. Candy paints, Brembo calipers)" aria-label="What's new" />
            <Button variant="primary" icon={CloudUpload} onClick={() => void publish()} disabled={!!busy} data-testid="publish-push">
              {busy === 'push' ? 'Publishing…' : 'Publish'}
            </Button>
            <Button icon={FolderOpen} onClick={() => void call('publish:reveal', undefined).catch(() => undefined)}>
              Open
            </Button>
          </Field>
        </>
      )}
    </CollapsibleSection>
  );
}
