import { useDeferredValue, useMemo } from 'react';
import { Copy, FileCode } from 'lucide-react';
import { buildJbeamFiles } from '@shared/export/jbeam';
import { exportMeshNames } from '@shared/export/files';
import { useProjectStore } from '@renderer/app/stores/project';
import { allMeshes, useSceneStore } from '@renderer/app/stores/scene';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import styles from './JbeamPreviewPanel.module.css';

/**
 * Live jbeam of the selected part: exactly the text Export would write, so you
 * can see what every edit does to the file (and learn the format as you go).
 */
export function JbeamPreviewPanel() {
  const doc = useProjectStore((s) => s.doc);
  const sources = useSceneStore((s) => s.sources);
  const activePart = useSceneStore((s) => s.activePart);
  const author = useSettingsStore((s) => s.settings?.author);
  const pushStatus = useUiStore((s) => s.pushStatus);
  // Rebuilding the jbeam is cheap but not free: let fast edits (drags, nudges) coalesce.
  const deferredDoc = useDeferredValue(doc);

  const file = useMemo(() => {
    if (!deferredDoc || !activePart) return null;
    const part = deferredDoc.parts.find((p) => p.id === activePart);
    if (!part) return null;
    const meshNames = exportMeshNames(deferredDoc, allMeshes(sources));
    return buildJbeamFiles(deferredDoc, currentTaxonomy(), { meshNames, author: author || deferredDoc.meta.author }).find((f) => f.part === part.name) ?? null;
  }, [deferredDoc, activePart, sources, author]);

  if (!doc) return <EmptyState icon={FileCode} message="Open a project to see its jbeam." />;
  if (!file) return <EmptyState icon={FileCode} message="Select a part in the Scene tree to see the jbeam it exports." />;

  const copy = () => {
    void navigator.clipboard.writeText(file.text).then(() => pushStatus(`Copied ${file.file}`, 'success'));
  };
  const lines = file.text.split('\n').length;

  return (
    <div className={styles.panel} data-testid="jbeam-preview">
      <header className={styles.header}>
        <span className={styles.file}>{file.file}</span>
        <span className={styles.meta}>{lines.toLocaleString()} lines</span>
        <IconButton icon={Copy} label="Copy to clipboard" size="sm" onClick={copy} />
      </header>
      <ScrollArea className={styles.scroll}>
        <pre className={styles.code}>{file.text}</pre>
      </ScrollArea>
    </div>
  );
}
