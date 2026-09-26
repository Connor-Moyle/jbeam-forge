import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { AlertTriangle, Eye, EyeOff, FileBox, FileInput, FolderSearch, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSceneStore, type LoadedSource } from '@renderer/app/stores/scene';
import { useProjectStore } from '@renderer/app/stores/project';
import { locateTextures, startImport } from '@renderer/import/importFlow';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { Popover } from '@renderer/ui/components/Popover';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { TreeRow } from '@renderer/ui/components/TreeRow';
import { EMPTY_ARR } from '@shared/empty';
import styles from './ScenePanel.module.css';

/**
 * Imported sources and their meshes (Phase 3b: flat per source). Phase 3c
 * replaces this with the part hierarchy once meshes are assigned to parts.
 */
export function ScenePanel() {
  const sourceIds = useProjectStore(useShallow((s) => s.doc?.sources.map((x) => x.id) ?? EMPTY_ARR));
  const loaded = useSceneStore((s) => s.sources);
  const [query, setQuery] = useState('');

  if (sourceIds.length === 0) {
    return <EmptyState icon={FileBox} message="No model imported yet. Import a DAE, FBX, OBJ, glTF or STL to start." action={{ label: 'Import model', icon: FileInput, onClick: () => void startImport() }} />;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span className={styles.searchIcon}>
          <Search aria-hidden />
        </span>
        <Input aria-label="Filter meshes" placeholder="Filter meshes" value={query} onChange={(e) => setQuery(e.target.value)} className={styles.search} data-testid="scene-filter" />
        <IconButton icon={FileInput} label="Import model" shortcut="Ctrl+I" onClick={() => void startImport()} />
      </div>
      <ScrollArea className={styles.list}>
        <div role="tree" aria-label="Imported meshes" data-testid="scene-tree">
          {sourceIds.map((id) => {
            const src = loaded[id];
            return src ? <SourceBranch key={id} source={src} query={query.trim().toLowerCase()} /> : null;
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function SourceBranch({ source, query }: { source: LoadedSource; query: string }) {
  const [open, setOpen] = useState(true);
  const hidden = useSceneStore((s) => s.hidden);
  const selection = useSceneStore((s) => s.selection);
  const hover = useSceneStore((s) => s.hover);
  const select = useSceneStore((s) => s.select);
  const setHover = useSceneStore((s) => s.setHover);
  const toggleHidden = useSceneStore((s) => s.toggleHidden);
  const requestFrame = useSceneStore((s) => s.requestFrame);
  const listRef = useRef<HTMLDivElement>(null);

  const meshes = useMemo(() => (query ? source.meshes.filter((m) => m.name.toLowerCase().includes(query)) : source.meshes), [source.meshes, query]);
  const selected = useMemo(() => new Set(selection), [selection]);

  // Selecting in the viewport scrolls the row into view.
  useEffect(() => {
    const last = selection[selection.length - 1];
    if (!last) return;
    listRef.current?.querySelector(`[data-mesh-key="${CSS.escape(last)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const onSelect = (key: string) => (e: MouseEvent) => select([key], e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace');
  const textures = source.textures;
  const missing = textures?.missing.length ?? 0;
  const unsupported = textures?.unsupported.length ?? 0;

  return (
    <div ref={listRef} data-source-id={source.sourceId}>
      <TreeRow
        depth={0}
        icon={FileBox}
        expanded={open}
        onToggle={() => setOpen((o) => !o)}
        label={
          <span className={styles.sourceLabel}>
            {source.fileName}
            {source.status === 'loading' && <Badge>loading…</Badge>}
            {(source.status === 'error' || source.status === 'missing') && <Badge tone="danger">{source.status === 'missing' ? 'file missing' : 'failed'}</Badge>}
          </span>
        }
        count={source.meshes.length}
        actions={missing + unsupported > 0 ? <TextureIssues source={source} /> : undefined}
      />
      {source.error && (
        <Callout tone="danger" className={styles.sourceError}>
          {source.error}
        </Callout>
      )}
      {open &&
        meshes.map((m) => (
          <div key={m.key} data-mesh-key={m.key} onMouseEnter={() => setHover(m.key)} onMouseLeave={() => hover === m.key && setHover(null)}>
            <TreeRow
              depth={1}
              label={m.name}
              count={m.triangles}
              selected={selected.has(m.key)}
              muted={!!hidden[m.key]}
              onSelect={onSelect(m.key)}
              onActivate={() => select([m.key])}
              onDoubleClick={() => {
                select([m.key]);
                requestFrame([m.key]);
              }}
              actions={<IconButton icon={hidden[m.key] ? EyeOff : Eye} label={hidden[m.key] ? 'Show' : 'Hide'} size="sm" onClick={() => toggleHidden(m.key)} />}
            />
          </div>
        ))}
    </div>
  );
}

function TextureIssues({ source }: { source: LoadedSource }) {
  const t = source.textures!;
  const count = t.missing.length + t.unsupported.length;
  return (
    <Popover
      title="Textures"
      trigger={
        <button type="button" className={styles.issueButton} data-testid="texture-issues">
          <AlertTriangle aria-hidden />
          {count}
        </button>
      }
    >
      <p className={styles.issueText}>
        {t.loaded} loaded · {t.missing.length} not found · {t.unsupported.length} unsupported
      </p>
      <ul className={styles.issueList}>
        {t.missing.map((r) => (
          <li key={r}>
            <Badge tone="warning">missing</Badge> <span className={styles.ref}>{r}</span>
          </li>
        ))}
        {t.unsupported.map((u) => (
          <li key={u.ref}>
            <Badge tone="danger">unsupported</Badge> <span className={styles.ref}>{u.ref}</span> — {u.reason}
          </li>
        ))}
      </ul>
      {t.missing.length > 0 && (
        <Button size="sm" icon={FolderSearch} onClick={() => void locateTextures(source.sourceId)} data-testid="locate-textures">
          Locate folder…
        </Button>
      )}
    </Popover>
  );
}
