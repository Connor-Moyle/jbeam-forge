import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { AlertTriangle, Ban, Boxes, Combine, Copy, FlipHorizontal2, Scissors, Shapes, CornerLeftUp, Eye, EyeOff, FileBox, Focus, FileInput, FolderSearch, Merge, Pencil, Search, Tag, Trash2, Undo2, Unlink, WandSparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSceneStore, type LoadedSource } from '@renderer/app/stores/scene';
import { useProjectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { locateTextures, startImport } from '@renderer/import/importFlow';
import * as cmd from '@renderer/parts/commands';
import { useAssignUi } from '@renderer/parts/assignUi';
import { isSplitResult, splitCentreLine, splitConnected, unsplit, useSplitTool } from '@renderer/split/splitTool';
import { categoryColor, useTaxonomy, type Taxonomy } from '@renderer/parts/taxonomy';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { ContextMenu, type ContextMenuItem } from '@renderer/ui/components/ContextMenu';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { Popover } from '@renderer/ui/components/Popover';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { TreeRow } from '@renderer/ui/components/TreeRow';
import { cx } from '@renderer/ui/cx';
import { ancestorIds, buildSceneTree, subtreeIds, type MeshInfo, type PartNode } from '@shared/parts/tree';
import { groupInfo, groupItems, type TreeItem } from '@shared/parts/grouping';
import { exitFocus, focusPart } from '@renderer/parts/focus';
import { renameFromParts } from '@renderer/parts/naming';
import { assignMaterial, MIME_MATERIAL } from '@renderer/materials/commands';
import { useRenameMeshUi } from '@renderer/parts/RenameMeshDialog';
import { positionLabel } from '@shared/parts/ops';
import { POSITIONS_BY_AXIS } from '@shared/taxonomy/schema';
import type { Part } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';
import styles from './ScenePanel.module.css';

/**
 * Scene tree (SPEC §4.3): sources, then the part hierarchy rooted at the
 * body with each part's meshes, then unassigned and ignored meshes. Drag a
 * part onto another to reparent it, drag meshes onto a part to assign them.
 */

const MIME_PART = 'application/x-jbf-part';
const MIME_MESHES = 'application/x-jbf-meshes';
const GROUP_UNASSIGNED = '#unassigned';
const GROUP_IGNORED = '#ignored';

export function ScenePanel() {
  const sourceIds = useProjectStore(useShallow((s) => s.doc?.sources.map((x) => x.id) ?? EMPTY_ARR));
  const [query, setQuery] = useState('');
  const selection = useSceneStore((s) => s.selection);
  const openAssign = useAssignUi((s) => s.openAssign);

  if (sourceIds.length === 0) {
    return <EmptyState icon={FileBox} message="No model imported yet. Import a DAE, FBX, OBJ, glTF or STL to start." action={{ label: 'Import model', icon: FileInput, onClick: () => void startImport() }} />;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span className={styles.searchIcon}>
          <Search aria-hidden />
        </span>
        <Input aria-label="Search parts and meshes" placeholder="Search parts and meshes" value={query} onChange={(e) => setQuery(e.target.value)} className={styles.search} data-testid="scene-filter" />
        <IconButton icon={Tag} label="Assign selected meshes…" disabled={selection.length === 0} onClick={() => openAssign(selection)} data-testid="scene-assign" />
        <IconButton icon={FileInput} label="Import model" shortcut="Ctrl+I" onClick={() => void startImport()} />
      </div>
      <ScrollArea className={styles.list}>
        <SourcesSection sourceIds={sourceIds} />
        <PartTree query={query.trim().toLowerCase()} />
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------- sources

function SourcesSection({ sourceIds }: { sourceIds: readonly string[] }) {
  const loaded = useSceneStore((s) => s.sources);
  return (
    <div role="group" aria-label="Sources" data-testid="scene-sources">
      {sourceIds.map((id) => {
        const src = loaded[id];
        return src ? <SourceRow key={id} source={src} /> : null;
      })}
    </div>
  );
}

function SourceRow({ source }: { source: LoadedSource }) {
  const missing = source.textures?.missing.length ?? 0;
  const unsupported = source.textures?.unsupported.length ?? 0;
  return (
    <div data-source-id={source.sourceId}>
      <TreeRow
        depth={0}
        icon={FileBox}
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
    </div>
  );
}

// ---------------------------------------------------------------- parts tree

type Row =
  | { type: 'part'; node: PartNode; depth: number; open: boolean; hasKids: boolean }
  | { type: 'category'; key: string; label: string; category: string; count: number; total: number; depth: number; open: boolean }
  | { type: 'mesh'; mesh: MeshInfo; depth: number; partId: string | null; ignored: boolean }
  | { type: 'group'; id: string; label: string; count: number; open: boolean };

function PartTree({ query }: { query: string }) {
  const tax = useTaxonomy();
  const parts = useProjectStore((s) => s.doc?.parts ?? EMPTY_ARR);
  const assignments = useProjectStore((s) => s.doc?.assignments);
  const ignoredMeshes = useProjectStore((s): readonly string[] => s.doc?.ignoredMeshes ?? EMPTY_ARR);
  const sources = useSceneStore((s) => s.sources);
  const selection = useSceneStore((s) => s.selection);
  const activePart = useSceneStore((s) => s.activePart);
  /** Rows flipped from their default (top-level parts and groups start open, deeper parts closed). */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const meshNames = useProjectStore((s) => s.doc?.meshNames);
  // Friendly names (after parts or typed) drive the tree and search; the original stays on hover.
  const meshes = useMemo(
    () => Object.values(sources).flatMap((s) => s.meshes.map((m) => ({ key: m.key, name: meshNames?.[m.key]?.name ?? m.name, original: m.name, triangles: m.triangles }))),
    [sources, meshNames],
  );
  const tree = useMemo(() => buildSceneTree(parts, assignments ?? {}, ignoredMeshes, meshes, query), [parts, assignments, ignoredMeshes, meshes, query]);
  const selected = useMemo(() => new Set(selection), [selection]);

  // Viewport → tree: reveal the part of the mesh picked in the viewport
  // (adjusted during render when the selection changes, then scrolled into view).
  const [seenSelection, setSeenSelection] = useState(selection);
  const last = selection[selection.length - 1];
  if (selection !== seenSelection) {
    setSeenSelection(selection);
    if (last && !activePart) {
      const pid = assignments?.[last];
      const reveal = pid ? [pid, ...ancestorIds(parts, pid)] : ignoredMeshes.includes(last) ? [GROUP_IGNORED] : [GROUP_UNASSIGNED];
      if (!reveal.every((id) => revealed.has(id) && !toggled.has(id))) {
        setRevealed(new Set([...revealed, ...reveal]));
        setToggled(new Set([...toggled].filter((id) => !reveal.includes(id))));
      }
    }
  }
  useEffect(() => {
    if (!last || activePart) return;
    rootRef.current?.querySelector(`[data-mesh-key="${CSS.escape(last)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [last, activePart]);

  const isOpen = (id: string, topLevel: boolean) => {
    if (query !== '' && (tree.hitPath.has(id) || id.startsWith('#'))) return true;
    return (topLevel || revealed.has(id)) !== toggled.has(id);
  };
  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Category groups open by themselves when they hold what you're looking at (search hits, the selection).
  const revealIds = new Set<string>([...revealed, ...(activePart ? [activePart, ...ancestorIds(parts, activePart)] : [])]);
  const holds = (items: TreeItem[]): boolean => items.some((i) => (i.type === 'part' ? revealIds.has(i.node.part.id) || tree.hitPath.has(i.node.part.id) : holds(i.items)));
  const infoOf = (p: Part) => groupInfo(tax.entry(p.taxonomyId), p);
  const rows: Row[] = [];
  const walk = (node: PartNode, depth: number) => {
    const open = isOpen(node.part.id, depth === 0);
    rows.push({ type: 'part', node, depth, open, hasKids: node.children.length + node.meshes.length > 0 });
    if (!open) return;
    for (const m of node.meshes) rows.push({ type: 'mesh', mesh: m, depth: depth + 1, partId: node.part.id, ignored: false });
    walkItems(groupItems(node.children, infoOf, node.part.id), depth + 1);
  };
  const walkItems = (items: TreeItem[], depth: number) => {
    for (const item of items) {
      if (item.type === 'part') {
        walk(item.node, depth);
        continue;
      }
      const open = (query !== '' || holds(item.items)) !== toggled.has(item.key);
      rows.push({ type: 'category', key: item.key, label: item.label, category: item.category, count: item.count, total: item.total, depth, open });
      if (open) walkItems(item.items, depth + 1);
    }
  };
  tree.roots.forEach((r) => walk(r, 0));
  if (tree.unassigned.length || !query) {
    const open = isOpen(GROUP_UNASSIGNED, true);
    rows.push({ type: 'group', id: GROUP_UNASSIGNED, label: 'Unassigned', count: tree.unassigned.length, open });
    if (open) for (const m of tree.unassigned) rows.push({ type: 'mesh', mesh: m, depth: 1, partId: null, ignored: false });
  }
  if (tree.ignored.length) {
    const open = isOpen(GROUP_IGNORED, false);
    rows.push({ type: 'group', id: GROUP_IGNORED, label: 'Ignored', count: tree.ignored.length, open });
    if (open) for (const m of tree.ignored) rows.push({ type: 'mesh', mesh: m, depth: 1, partId: null, ignored: true });
  }

  const ctx: RowContext = { tax, parts, selected, activePart, partMeshes: tree.partMeshes, dropTarget, setDropTarget, toggle };
  return (
    <div ref={rootRef} role="tree" aria-label="Parts" data-testid="scene-tree" className={styles.tree}>
      {tree.roots.length === 0 && !query && <p className={styles.hint}>No parts yet. Select meshes and press Assign, or right-click them.</p>}
      {rows.map((r) =>
        r.type === 'part' ? (
          <PartRow key={`p:${r.node.part.id}`} row={r} ctx={ctx} />
        ) : r.type === 'category' ? (
          <CategoryRow key={r.key} row={r} ctx={ctx} />
        ) : r.type === 'mesh' ? (
          <MeshRow key={`m:${r.mesh.key}`} row={r} ctx={ctx} />
        ) : (
          <GroupRow key={r.id} row={r} ctx={ctx} />
        ),
      )}
    </div>
  );
}

interface RowContext {
  tax: Taxonomy;
  parts: readonly Part[];
  selected: ReadonlySet<string>;
  activePart: string | null;
  partMeshes: Map<string, string[]>;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
  toggle: (id: string) => void;
}

function readDrag(e: DragEvent): { part: string | null; meshes: string[]; material: string | null } {
  const part = e.dataTransfer.getData(MIME_PART) || null;
  const material = e.dataTransfer.getData(MIME_MATERIAL) || null;
  const raw = e.dataTransfer.getData(MIME_MESHES);
  let meshes: string[] = [];
  try {
    meshes = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    meshes = [];
  }
  return { part, meshes, material };
}

function dropProps(id: string, ctx: RowContext, onDrop: (d: { part: string | null; meshes: string[]; material: string | null }) => void, accept: readonly string[] = [MIME_PART, MIME_MESHES, MIME_MATERIAL]) {
  return {
    onDragOver: (e: DragEvent) => {
      if (!accept.some((t) => e.dataTransfer.types.includes(t))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes(MIME_MATERIAL) ? 'copy' : 'move';
      if (ctx.dropTarget !== id) ctx.setDropTarget(id);
    },
    onDragLeave: () => ctx.dropTarget === id && ctx.setDropTarget(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      ctx.setDropTarget(null);
      onDrop(readDrag(e));
    },
  };
}

function PartRow({ row, ctx }: { row: Extract<Row, { type: 'part' }>; ctx: RowContext }) {
  const { node } = row;
  const part = node.part;
  const entry = ctx.tax.entry(part.taxonomyId);
  const hidden = useSceneStore((s) => s.hidden);
  const selectPart = useSceneStore((s) => s.selectPart);
  const setHidden = useSceneStore((s) => s.setHidden);
  const pushStatus = useUiStore((s) => s.pushStatus);
  const focused = useSceneStore((s) => s.focus?.partId === part.id);
  const own = ctx.partMeshes.get(part.id) ?? EMPTY_ARR;
  const subtreeMeshes = () => subtreeIds(ctx.parts, part.id).flatMap((id) => ctx.partMeshes.get(id) ?? []);
  const allHidden = own.length > 0 && own.every((k) => hidden[k]);

  const onDrop = ({ part: dragged, meshes, material }: { part: string | null; meshes: string[]; material: string | null }) => {
    if (material) {
      // A material dropped on a part goes on all of its meshes.
      assignMaterial(material, subtreeMeshes());
      return;
    }
    if (dragged && dragged !== part.id) {
      if (!cmd.reparentPart(dragged, part.id)) pushStatus('Can’t move a part inside its own child.', 'warning');
    } else if (meshes.length) cmd.assignToPart(meshes, part.id);
  };

  const siblingsOfKind = ctx.parts.filter((p) => p.taxonomyId === part.taxonomyId && p.id !== part.id);
  const items: ContextMenuItem[] = [
    { label: 'Focus', icon: Focus, onSelect: () => focusPart(part.id) },
    { label: 'Select meshes', icon: Boxes, onSelect: () => selectPart(part.id, own) },
    { label: 'Duplicate as variant', icon: Copy, onSelect: () => void cmd.duplicateAsVariant(part.id) },
    { label: 'Rename meshes from their parts', icon: WandSparkles, onSelect: renameFromParts },
    { label: 'Move to top level', icon: CornerLeftUp, disabled: !part.parentPartId, onSelect: () => void cmd.reparentPart(part.id, null) },
    {
      type: 'submenu',
      label: 'Merge into',
      icon: Merge,
      disabled: siblingsOfKind.length === 0,
      items: siblingsOfKind.map((p) => ({ label: p.displayName, onSelect: () => cmd.mergeParts(p.id, [part.id]) })),
    },
    { type: 'separator' },
    { label: 'Delete part', icon: Trash2, danger: true, onSelect: () => cmd.deletePart(part.id) },
  ];

  return (
    <ContextMenu items={items}>
      <div
        data-part-id={part.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(MIME_PART, part.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        {...dropProps(part.id, ctx, onDrop)}
        className={cx(ctx.dropTarget === part.id && styles.dropTarget)}
      >
        <TreeRow
          depth={row.depth}
          expanded={row.hasKids ? row.open : undefined}
          onToggle={() => ctx.toggle(part.id)}
          dotColor={categoryColor(entry?.category)}
          label={
            <span className={styles.partLabel}>
              <span className={styles.partName}>{part.displayName}</span>
              {part.variantOf && <Badge>variant</Badge>}
              {!entry && <Badge tone="warning">unknown type</Badge>}
            </span>
          }
          count={node.total}
          selected={ctx.activePart === part.id}
          muted={allHidden}
          onSelect={() => selectPart(part.id, own)}
          onActivate={() => selectPart(part.id, own)}
          onDoubleClick={() => focusPart(part.id)}
          actions={
            <>
              <IconButton icon={Focus} label={focused ? 'Leave focus' : 'Focus'} size="sm" onClick={() => (focused ? exitFocus() : focusPart(part.id))} data-testid="part-focus" />
              <IconButton icon={allHidden ? EyeOff : Eye} label={allHidden ? 'Show' : 'Hide'} size="sm" onClick={() => setHidden(subtreeMeshes(), !allHidden)} />
            </>
          }
        />
      </div>
    </ContextMenu>
  );
}

function MeshRow({ row, ctx }: { row: Extract<Row, { type: 'mesh' }>; ctx: RowContext }) {
  const { mesh } = row;
  const hidden = useSceneStore((s) => s.hidden);
  const hover = useSceneStore((s) => s.hover);
  const select = useSceneStore((s) => s.select);
  const setHover = useSceneStore((s) => s.setHover);
  const toggleHidden = useSceneStore((s) => s.toggleHidden);
  const requestFrame = useSceneStore((s) => s.requestFrame);
  const openAssign = useAssignUi((s) => s.openAssign);
  const isSelected = ctx.selected.has(mesh.key);
  /** Actions apply to the whole selection when this row is part of it. */
  const targets = () => (isSelected ? [...ctx.selected] : [mesh.key]);

  const onSelect = (e: MouseEvent) => select([mesh.key], e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace');
  // Built when the menu opens: the cascading type menu has ~150 entries.
  const items = (): ContextMenuItem[] => [
    { label: 'Assign…', icon: Tag, onSelect: () => openAssign(targets()) },
    { type: 'submenu', label: 'Assign as', icon: Tag, items: kindMenu(ctx.tax, targets) },
    { label: 'Unassign', icon: Unlink, disabled: row.partId === null, onSelect: () => cmd.unassign(targets()) },
    row.ignored ? { label: 'Restore', icon: Undo2, onSelect: () => cmd.setIgnored(targets(), false) } : { label: 'Ignore (not exported)', icon: Ban, onSelect: () => cmd.setIgnored(targets(), true) },
    { type: 'separator' },
    { label: 'Rename…', icon: Pencil, onSelect: () => useRenameMeshUi.getState().open(mesh.key) },
    { label: 'Rename meshes from their parts', icon: WandSparkles, onSelect: renameFromParts },
    { type: 'separator' },
    { label: 'Split into connected pieces', icon: Shapes, onSelect: () => void splitConnected(mesh.key) },
    { label: 'Split at the centre line (left/right)', icon: FlipHorizontal2, onSelect: () => void splitCentreLine(targets()) },
    { label: 'Split by selecting faces…', icon: Scissors, onSelect: () => useSplitTool.getState().start(mesh.key) },
    { label: 'Merge back into original', icon: Combine, disabled: !isSplitResult(mesh.key), onSelect: () => void unsplit(mesh.key) },
  ];

  return (
    <ContextMenu items={items}>
      <div
        data-mesh-key={mesh.key}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(MIME_MESHES, JSON.stringify(targets()));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onMouseEnter={() => setHover(mesh.key)}
        onMouseLeave={() => hover === mesh.key && setHover(null)}
        {...dropProps(mesh.key, ctx, ({ material }) => material && assignMaterial(material, targets()), [MIME_MATERIAL])}
        className={cx(ctx.dropTarget === mesh.key && styles.dropTarget)}
      >
        <TreeRow
          depth={row.depth}
          label={
            <span className={styles.meshLabel} title={mesh.original && mesh.original !== mesh.name ? `Originally ${mesh.original}` : undefined}>
              {mesh.name}
            </span>
          }
          count={mesh.triangles}
          selected={isSelected}
          muted={row.ignored || !!hidden[mesh.key]}
          onSelect={onSelect}
          onActivate={() => select([mesh.key])}
          onDoubleClick={() => {
            select([mesh.key]);
            requestFrame([mesh.key]);
          }}
          actions={<IconButton icon={hidden[mesh.key] ? EyeOff : Eye} label={hidden[mesh.key] ? 'Show' : 'Hide'} size="sm" onClick={() => toggleHidden(mesh.key)} />}
        />
      </div>
    </ContextMenu>
  );
}

/** A logical group of sibling parts (Doors, Front doors, Glass…). */
function CategoryRow({ row, ctx }: { row: Extract<Row, { type: 'category' }>; ctx: RowContext }) {
  return (
    <div data-category={row.key} data-testid="scene-category">
      <TreeRow
        depth={row.depth}
        expanded={row.open}
        onToggle={() => ctx.toggle(row.key)}
        onSelect={() => ctx.toggle(row.key)}
        dotColor={categoryColor(row.category)}
        label={
          <span className={styles.categoryLabel}>
            {row.label} <span className={styles.categoryCount}>{row.count} parts</span>
          </span>
        }
        count={row.total}
      />
    </div>
  );
}

function GroupRow({ row, ctx }: { row: Extract<Row, { type: 'group' }>; ctx: RowContext }) {
  const onDrop = ({ part, meshes }: { part: string | null; meshes: string[] }) => {
    if (part) return;
    if (!meshes.length) return;
    if (row.id === GROUP_IGNORED) cmd.setIgnored(meshes, true);
    else cmd.moveToUnassigned(meshes);
  };
  return (
    <div data-group={row.id} {...dropProps(row.id, ctx, onDrop)} className={cx(styles.group, row.id === GROUP_IGNORED && styles.ignoredGroup, ctx.dropTarget === row.id && styles.dropTarget)} data-testid={`scene-group-${row.id.slice(1)}`}>
      <TreeRow depth={0} expanded={row.count > 0 ? row.open : undefined} onToggle={() => ctx.toggle(row.id)} label={row.label} count={row.count} muted={row.id === GROUP_IGNORED} />
    </div>
  );
}

/** Cascading Category → Subcategory → Part → Position menu. */
function kindMenu(tax: Taxonomy, targets: () => string[]): ContextMenuItem[] {
  const byCat = new Map<string, Map<string, typeof tax.entries>>();
  for (const e of tax.entries) {
    const subs = byCat.get(e.category) ?? new Map<string, typeof tax.entries>();
    subs.set(e.subcategory, [...(subs.get(e.subcategory) ?? []), e]);
    byCat.set(e.category, subs);
  }
  const kindItem = (e: (typeof tax.entries)[number]): ContextMenuItem => {
    const positions = POSITIONS_BY_AXIS[e.positionAxis];
    if (!positions.length) return { label: e.label, onSelect: () => void cmd.assignToNewPart(targets(), { taxonomyId: e.id }) };
    return {
      type: 'submenu',
      label: e.label,
      items: [
        { label: 'Auto (by location)', onSelect: () => void cmd.assignDistributed(targets(), e.id, '') },
        { type: 'separator' },
        ...positions.map((p): ContextMenuItem => ({ label: `${p} · ${positionLabel(e.positionAxis, p)}`, onSelect: () => void cmd.assignToNewPart(targets(), { taxonomyId: e.id, position: p }) })),
      ],
    };
  };
  return [...byCat.entries()].map(([cat, subs]): ContextMenuItem => ({
    type: 'submenu',
    label: cat,
    items:
      subs.size === 1
        ? [...subs.values()][0]!.map(kindItem)
        : [...subs.entries()].map(([sub, list]): ContextMenuItem => ({ type: 'submenu', label: sub, items: list.map(kindItem) })),
  }));
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

