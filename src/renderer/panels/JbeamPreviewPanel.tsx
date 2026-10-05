import { useDeferredValue, useMemo } from 'react';
import { Copy, FileCode } from 'lucide-react';
import { buildJbeamFiles } from '@shared/export/jbeam';
import { exportMeshNames } from '@shared/export/files';
import { withMeshNames } from '@shared/parts/meshNames';
import { useProjectStore } from '@renderer/app/stores/project';
import { allMeshes, useSceneStore } from '@renderer/app/stores/scene';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { useEditStore } from '@renderer/structure/editStore';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import styles from './JbeamPreviewPanel.module.css';

/** Lines of the file that are the picked nodes, beams and triangles (at most 200), or null. */
function markedLines(text: string, nodes: readonly string[], beams: readonly string[], tris: readonly string[]): Set<number> | null {
  if (!nodes.length && !beams.length && !tris.length) return null;
  const q = (id: string) => `"${id}"`;
  const wantNodes = new Set(nodes.slice(0, 200).map((id) => `[${q(id)},`));
  const pairs = beams.slice(0, 200).map((k) => k.split('|').map(q));
  const triples = tris.slice(0, 200).map((k) => k.split('|').map(q));
  const out = new Set<number>();
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+/g, '');
    if (!line.startsWith('[')) return;
    if (wantNodes.size && [...wantNodes].some((w) => line.startsWith(w) && /^\["[^"]+",-?[\d.]/.test(line))) out.add(i);
    else if (pairs.some(([a, b]) => (line.startsWith(`[${a},${b}`) || line.startsWith(`[${b},${a}`)) && !/^\["[^"]+","[^"]+","[^"]+"/.test(line))) out.add(i);
    else if (triples.some((t) => /^\["[^"]+","[^"]+","[^"]+"/.test(line) && t.every((id) => line.slice(0, 200).includes(id)))) out.add(i);
  });
  return out.size ? out : null;
}

/**
 * Live jbeam of the selected part: exactly the text Export would write, so you
 * can see what every edit does to the file (and learn the format as you go).
 */
export function JbeamPreviewPanel() {
  const doc = useProjectStore((s) => s.doc);
  const sources = useSceneStore((s) => s.sources);
  const scenePart = useSceneStore((s) => s.activePart);
  // In edit mode the file of whatever nodes, beams or triangles are picked (JBeam workspace).
  const editNodes = useEditStore((s) => s.nodes);
  const editBeams = useEditStore((s) => s.beams);
  const editTris = useEditStore((s) => s.tris);
  const pickedIds = useMemo(() => [...editNodes, ...editBeams.flatMap((k) => k.split('|')), ...editTris.flatMap((k) => k.split('|'))], [editNodes, editBeams, editTris]);
  const pickedPart = useProjectStore((s) => (pickedIds.length ? (s.doc?.nodes.find((n) => n.id === pickedIds[0])?.partId ?? null) : null));
  const activePart = pickedPart ?? scenePart;
  const author = useSettingsStore((s) => s.settings?.author);
  const pushStatus = useUiStore((s) => s.pushStatus);
  // Rebuilding the jbeam is cheap but not free: let fast edits (drags, nudges) coalesce.
  const deferredDoc = useDeferredValue(doc);

  const file = useMemo(() => {
    if (!deferredDoc || !activePart) return null;
    const part = deferredDoc.parts.find((p) => p.id === activePart);
    if (!part) return null;
    const meshNames = exportMeshNames(deferredDoc, withMeshNames(deferredDoc, allMeshes(sources)));
    return buildJbeamFiles(deferredDoc, currentTaxonomy(), { meshNames, author: author || deferredDoc.meta.author }).find((f) => f.part === part.name) ?? null;
  }, [deferredDoc, activePart, sources, author]);

  if (!doc) return <EmptyState icon={FileCode} message="Open a project to see its jbeam." />;
  if (!file) return <EmptyState icon={FileCode} message="Select a part in the Scene tree to see the jbeam it exports." />;

  const marked = markedLines(file.text, editNodes, editBeams, editTris);

  const copy = () => {
    void call('clipboard:writeText', { text: file.text }).then(() => pushStatus(`Copied ${file.file}`, 'success'));
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
        {marked ? (
          <pre className={styles.code}>
            {file.text.split('\n').map((line, i) =>
              marked.has(i) ? (
                <mark key={i} className={styles.mark} ref={i === Math.min(...marked) ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}>
                  {line}
                  {'\n'}
                </mark>
              ) : (
                `${line}\n`
              ),
            )}
          </pre>
        ) : (
          <pre className={styles.code}>{file.text}</pre>
        )}
      </ScrollArea>
    </div>
  );
}
