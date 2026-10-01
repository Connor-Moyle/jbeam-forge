import { useDeferredValue, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Circle, CircleDot, FlipHorizontal2, GraduationCap, Info, Link2, Plus, Spline, Trash2, Triangle, Wrench } from 'lucide-react';
import { useGuide } from '@renderer/help/guide';
import { offerWorkspaceLesson, workspaceLesson } from '@renderer/help/lessons/workspaceLessons';
import { useProjectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { keyFor } from '@renderer/app/keys';
import { useEditStore } from '@renderer/structure/editStore';
import { addNodeAtSelection, connectSelection, deleteSelection, mirrorSelection } from '@renderer/structure/editCommands';
import { beamKey } from '@shared/structure/edit';
import { asymmetricNodes, checkStructure, ISSUE_TEXT, triKey, type Issue, type IssueKind } from '@shared/jbeam/workbench';
import { BEAM_KINDS, type Project } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Tabs } from '@renderer/ui/components/Tabs';
import { cx } from '@renderer/ui/cx';
import { addTriangleFromSelection, applyRenames, checkThresholds, deleteTriangles, fixIssues, flipTriangles, selectIssue } from './commands';
import styles from './Jbeam.module.css';

/**
 * JBeam workspace, left: every node, beam and triangle as a table, filtered
 * by part and search, and the structure checks. Rows and the 3D view share
 * one selection.
 */

type View = 'nodes' | 'beams' | 'tris' | 'checks';
const ALL = '*';

const mm = (m: number) => `${Math.round(m * 1000)}`;
const pickMode = (e: MouseEvent) => (e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'subtract' : 'replace');

export function JbeamTablesPanel() {
  const doc = useProjectStore((s) => s.doc);
  const [view, setView] = useState<View>('nodes');
  const [part, setPart] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<string>(ALL);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const pageSize = useSettingsStore((s) => s.settings?.jbeamPageSize ?? 300);
  const [shown, setShown] = useState(pageSize);
  useEffect(() => offerWorkspaceLesson('jbeam'), []);

  // The workspace edits nodes: edit mode comes on with it.
  const hasNodes = (doc?.nodes.length ?? 0) > 0;
  useEffect(() => {
    if (hasNodes && !useEditStore.getState().active) useEditStore.getState().setActive(true);
  }, [hasNodes]);
  const parts = useMemo(() => doc?.parts.filter((p) => doc.nodes.some((n) => n.partId === p.id)) ?? [], [doc]);
  const issues = useIssues(doc, part);

  if (!doc || !doc.nodes.length) return <EmptyState icon={Spline} message="No nodes yet. Generate the structure (the wand on the toolbar), then fine-tune every node, beam and triangle here." />;

  const inPart = (partId: string) => part === ALL || partId === part;
  const counts = {
    nodes: doc.nodes.filter((n) => inPart(n.partId)).length,
    beams: doc.beams.filter((b) => inPart(b.partId)).length,
    tris: doc.tris.filter((t) => inPart(t.partId)).length,
  };
  const errors = issues.filter((i) => i.severity === 'error').length;

  return (
    <div className={styles.panel} data-testid="jbeam-tables">
      <div className={styles.filters}>
        <Select
          value={part}
          onChange={(v) => {
            setPart(v);
            setShown(pageSize);
          }}
          options={[{ value: ALL, label: 'All parts' }, ...parts.map((p) => ({ value: p.id, label: p.displayName }))]}
          aria-label="Part"
          data-testid="jbeam-part"
        />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={view === 'checks' ? 'Search problems' : 'Search names'} aria-label="Search the tables" data-testid="jbeam-search" />
        <IconButton icon={GraduationCap} label="Tutorial: the JBeam workspace, step by step" onClick={() => useGuide.getState().start(workspaceLesson('jbeam'))} data-testid="jbeam-tutorial" />
      </div>
      <Tabs<View>
        value={view}
        onChange={(v) => {
          setView(v);
          setShown(pageSize);
        }}
        items={[
          { value: 'nodes', label: `Nodes ${counts.nodes}` },
          { value: 'beams', label: `Beams ${counts.beams}` },
          { value: 'tris', label: `Triangles ${counts.tris}` },
          { value: 'checks', label: issues.length ? `Checks ${errors ? `⚠ ${errors}` : issues.length}` : 'Checks ✓' },
        ]}
        aria-label="JBeam tables"
      />
      {view === 'nodes' && <NodesTable doc={doc} inPart={inPart} query={deferredQuery} shown={shown} more={() => setShown((n) => n + pageSize)} />}
      {view === 'beams' && <BeamsTable doc={doc} inPart={inPart} query={deferredQuery} kind={kind} setKind={setKind} shown={shown} more={() => setShown((n) => n + pageSize)} />}
      {view === 'tris' && <TrisTable doc={doc} inPart={inPart} query={deferredQuery} shown={shown} more={() => setShown((n) => n + pageSize)} />}
      {view === 'checks' && <Checks issues={issues} query={deferredQuery} />}
    </div>
  );
}

function useIssues(doc: Project | null, part: string): Issue[] {
  const settings = useSettingsStore((s) => s.settings);
  const deferred = useDeferredValue(doc);
  return useMemo(() => {
    if (!deferred) return [];
    void settings; // thresholds come from settings
    const only = part === ALL ? undefined : new Set([part]);
    const list = checkStructure(deferred, checkThresholds(), only);
    const partIds = part === ALL ? [...new Set(deferred.nodes.map((n) => n.partId))] : [part];
    const lonely = asymmetricNodes(deferred, partIds);
    if (lonely.length) list.push({ kind: 'asymmetric', severity: 'info', message: `${lonely.length} node${lonely.length === 1 ? '' : 's'} without a partner on the other side`, nodes: lonely, beams: [], tris: [] });
    return list;
  }, [deferred, part, settings]);
}

/** Row selection: click picks, Shift adds, Ctrl removes; the 3D view follows. */
function pickNodes(ids: string[], e: MouseEvent) {
  const edit = useEditStore.getState();
  if (!edit.active) edit.setActive(true);
  edit.select(ids, [], pickMode(e));
  if (useSettingsStore.getState().settings?.jbeamFrameOnPick) edit.frameNodes(ids);
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className={styles.toolbar} role="toolbar">
      {children}
    </div>
  );
}

function More({ total, shown, more }: { total: number; shown: number; more: () => void }) {
  if (total <= shown) return null;
  return (
    <div className={styles.more}>
      <Button size="sm" onClick={more}>
        Show more ({(total - shown).toLocaleString()} left)
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- nodes

function NodesTable({ doc, inPart, query, shown, more }: { doc: Project; inPart: (p: string) => boolean; query: string; shown: number; more: () => void }) {
  const selected = useEditStore((s) => s.nodes);
  const sel = useMemo(() => new Set(selected), [selected]);
  const [editing, setEditing] = useState<string | null>(null);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const b of doc.beams) {
      d.set(b.id1, (d.get(b.id1) ?? 0) + 1);
      d.set(b.id2, (d.get(b.id2) ?? 0) + 1);
    }
    return d;
  }, [doc.beams]);
  const minBeams = useSettingsStore((s) => s.settings?.jbeamMinBeams ?? 3);
  const rows = useMemo(() => doc.nodes.filter((n) => inPart(n.partId) && (!query || n.id.toLowerCase().includes(query))), [doc.nodes, inPart, query]);
  const partName = useMemo(() => new Map(doc.parts.map((p) => [p.id, p.displayName])), [doc.parts]);

  return (
    <>
      <Toolbar>
        <IconButton icon={CircleDot} label="Select every node shown" size="sm" onClick={(e) => pickNodes(rows.map((n) => n.id), e)} data-testid="jbeam-select-shown" />
        <IconButton icon={Plus} label="Add a node next to the selection" shortcut={keyFor('nodeAdd')} size="sm" onClick={addNodeAtSelection} data-testid="jbeam-add-node" />
        <IconButton icon={Link2} label="Connect the selected nodes with beams" shortcut={keyFor('nodeConnect')} size="sm" onClick={connectSelection} />
        <IconButton icon={Triangle} label="Make a triangle of the three selected nodes" shortcut={keyFor('triAdd')} size="sm" onClick={addTriangleFromSelection} data-testid="jbeam-add-tri" />
        <IconButton icon={FlipHorizontal2} label="Mirror the selection to the other side" shortcut={keyFor('nodeMirror')} size="sm" onClick={mirrorSelection} />
        <span className={styles.spacer} />
        <span className={styles.count}>{selected.length ? `${selected.length} selected` : `${rows.length.toLocaleString()} shown`}</span>
        <IconButton icon={Trash2} label="Delete the selection" shortcut={keyFor('nodeDelete')} size="sm" disabled={!selected.length} onClick={deleteSelection} />
      </Toolbar>
      <ScrollArea className={styles.scroll}>
        <table className={styles.table} data-testid="jbeam-nodes">
          <thead>
            <tr>
              <th>Name</th>
              <th className={styles.num}>X</th>
              <th className={styles.num}>Y</th>
              <th className={styles.num}>Z</th>
              <th className={styles.num}>kg</th>
              <th className={styles.num} title="Beams">B</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((n) => {
              const d = degree.get(n.id) ?? 0;
              return (
                <tr key={n.id} className={cx(sel.has(n.id) && styles.on)} onClick={(e) => pickNodes([n.id], e)} onDoubleClick={() => setEditing(n.id)} title={`${n.id} · ${partName.get(n.partId) ?? n.partId}${n.options ? ` · ${Object.keys(n.options).join(', ')}` : ''}`} data-node={n.id}>
                  <td className={styles.name}>
                    {editing === n.id ? (
                      <RenameCell id={n.id} done={() => setEditing(null)} />
                    ) : (
                      <>
                        {n.id}
                        {n.options && <span className={styles.dot} aria-label="has its own settings" />}
                      </>
                    )}
                  </td>
                  <td className={styles.num}>{n.pos[0].toFixed(3)}</td>
                  <td className={styles.num}>{n.pos[1].toFixed(3)}</td>
                  <td className={styles.num}>{n.pos[2].toFixed(3)}</td>
                  <td className={styles.num}>{n.weight.toFixed(2)}</td>
                  <td className={cx(styles.num, d < minBeams && styles.warn)}>{d}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <More total={rows.length} shown={shown} more={more} />
      </ScrollArea>
    </>
  );
}

function RenameCell({ id, done }: { id: string; done: () => void }) {
  const [draft, setDraft] = useState(id);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== id) {
      const problem = applyRenames(new Map([[id, next]]), `Rename node ${id} → ${next}`);
      if (problem) useUiStore.getState().pushStatus(problem, 'warning');
    }
    done();
  };
  return (
    <input
      className={styles.cellInput}
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') done();
      }}
      aria-label={`New name for ${id}`}
      data-testid="jbeam-rename-cell"
    />
  );
}

// ---------------------------------------------------------------- beams

function BeamsTable({ doc, inPart, query, kind, setKind, shown, more }: { doc: Project; inPart: (p: string) => boolean; query: string; kind: string; setKind: (k: string) => void; shown: number; more: () => void }) {
  const selected = useEditStore((s) => s.beams);
  const sel = useMemo(() => new Set(selected), [selected]);
  const pos = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n.pos])), [doc.nodes]);
  const rows = useMemo(
    () =>
      doc.beams
        .filter((b) => inPart(b.partId) && (kind === ALL || b.kind === kind) && (!query || b.id1.toLowerCase().includes(query) || b.id2.toLowerCase().includes(query)))
        .map((b) => {
          const a = pos.get(b.id1);
          const c = pos.get(b.id2);
          return { b, key: beamKey(b.id1, b.id2), len: a && c ? Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) : NaN };
        }),
    [doc.beams, inPart, kind, query, pos],
  );
  const pick = (keys: string[], e: MouseEvent) => {
    const edit = useEditStore.getState();
    if (!edit.active) edit.setActive(true);
    edit.select([], keys, pickMode(e));
    if (useSettingsStore.getState().settings?.jbeamFrameOnPick) edit.frameNodes(keys.flatMap((k) => k.split('|')));
  };
  return (
    <>
      <Toolbar>
        <Select value={kind} onChange={setKind} options={[{ value: ALL, label: 'Every kind' }, ...BEAM_KINDS.map((k) => ({ value: k, label: k }))]} aria-label="Beam kind" className={styles.kind} />
        <IconButton icon={Spline} label="Select every beam shown" size="sm" onClick={(e) => pick(rows.map((r) => r.key), e)} />
        <span className={styles.spacer} />
        <span className={styles.count}>{selected.length ? `${selected.length} selected` : `${rows.length.toLocaleString()} shown`}</span>
        <IconButton icon={Trash2} label="Delete the selected beams" size="sm" disabled={!selected.length} onClick={deleteSelection} />
      </Toolbar>
      <ScrollArea className={styles.scroll}>
        <table className={styles.table} data-testid="jbeam-beams">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Kind</th>
              <th className={styles.num}>mm</th>
              <th className={styles.num}>Stiffness</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ b, key, len }, i) => (
              <tr key={`${key}|${b.kind}|${i}`} className={cx(sel.has(key) && styles.on)} onClick={(e) => pick([key], e)} title={b.options ? Object.entries(b.options).map(([k, v]) => `${k}: ${String(v)}`).join('\n') : 'Values from the part’s preset'}>
                <td className={styles.name}>{b.id1}</td>
                <td className={styles.name}>{b.id2}</td>
                <td>{b.kind}</td>
                <td className={styles.num}>{Number.isFinite(len) ? mm(len) : '?'}</td>
                <td className={styles.num}>{typeof b.options?.beamSpring === 'number' ? b.options.beamSpring.toLocaleString() : <span className={styles.dim}>preset</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <More total={rows.length} shown={shown} more={more} />
      </ScrollArea>
    </>
  );
}

// ---------------------------------------------------------------- triangles

function TrisTable({ doc, inPart, query, shown, more }: { doc: Project; inPart: (p: string) => boolean; query: string; shown: number; more: () => void }) {
  const selected = useEditStore((s) => s.tris);
  const sel = useMemo(() => new Set(selected), [selected]);
  const rows = useMemo(() => doc.tris.filter((t) => inPart(t.partId) && (!query || t.ids.some((id) => id.toLowerCase().includes(query)))).map((t) => ({ t, key: triKey(t.ids) })), [doc.tris, inPart, query]);
  const pick = (keys: string[], e: MouseEvent) => {
    const edit = useEditStore.getState();
    if (!edit.active) edit.setActive(true);
    edit.selectTris(keys, pickMode(e));
    if (useSettingsStore.getState().settings?.jbeamFrameOnPick) edit.frameNodes(keys.flatMap((k) => k.split('|')));
  };
  return (
    <>
      <Toolbar>
        <IconButton icon={Triangle} label="Select every triangle shown" size="sm" onClick={(e) => pick(rows.map((r) => r.key), e)} />
        <IconButton icon={FlipHorizontal2} label="Flip the selected triangles (swap outside and inside)" size="sm" disabled={!selected.length} onClick={() => flipTriangles(selected)} data-testid="jbeam-flip" />
        <span className={styles.spacer} />
        <span className={styles.count}>{selected.length ? `${selected.length} selected` : `${rows.length.toLocaleString()} shown`}</span>
        <IconButton icon={Trash2} label="Delete the selected triangles" size="sm" disabled={!selected.length} onClick={() => deleteTriangles(selected)} />
      </Toolbar>
      <ScrollArea className={styles.scroll}>
        <table className={styles.table} data-testid="jbeam-tris">
          <thead>
            <tr>
              <th>Node 1</th>
              <th>Node 2</th>
              <th>Node 3</th>
              <th>Set</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ t, key }, i) => (
              <tr key={`${key}|${i}`} className={cx(sel.has(key) && styles.on)} onClick={(e) => pick([key], e)}>
                <td className={styles.name}>{t.ids[0]}</td>
                <td className={styles.name}>{t.ids[1]}</td>
                <td className={styles.name}>{t.ids[2]}</td>
                <td>{t.options ? Object.keys(t.options).join(', ') : <span className={styles.dim}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <More total={rows.length} shown={shown} more={more} />
      </ScrollArea>
    </>
  );
}

// ---------------------------------------------------------------- checks

const FIXABLE: Partial<Record<IssueKind, string>> = {
  'duplicate-beam': 'Remove the doubles',
  'duplicate-triangle': 'Remove the doubles',
  'bad-triangle': 'Remove them',
  'missing-node': 'Remove those beams',
  'zero-beam': 'Remove them',
  asymmetric: 'Even out the pairs',
};

function Checks({ issues, query }: { issues: readonly Issue[]; query: string }) {
  const shown = query ? issues.filter((i) => i.message.toLowerCase().includes(query) || ISSUE_TEXT[i.kind].toLowerCase().includes(query)) : issues;
  const groups = useMemo(() => {
    const m = new Map<IssueKind, Issue[]>();
    for (const i of shown) m.set(i.kind, [...(m.get(i.kind) ?? EMPTY_ARR), i]);
    return [...m.entries()];
  }, [shown]);
  if (!issues.length) return <EmptyState icon={Wrench} message="No problems found: every node has its beams, nothing is doubled or on top of anything else." />;
  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.checks} data-testid="jbeam-checks">
        {groups.map(([kind, list]) => {
          const worst = list[0]!.severity;
          const Icon = worst === 'error' ? AlertCircle : worst === 'warning' ? AlertTriangle : Info;
          return (
            <section key={kind} className={styles.checkGroup}>
              <header className={styles.checkHead}>
                <Icon className={cx(styles.icon, worst === 'error' ? styles.error : worst === 'warning' ? styles.warn : styles.info)} aria-hidden />
                <span className={styles.checkTitle}>{ISSUE_TEXT[kind]}</span>
                <Badge>{list.length}</Badge>
                <span className={styles.spacer} />
                <Button size="sm" variant="ghost" onClick={() => selectIssue({ ...list[0]!, nodes: list.flatMap((i) => i.nodes), beams: list.flatMap((i) => i.beams), tris: list.flatMap((i) => i.tris) })}>
                  Select all
                </Button>
                {FIXABLE[kind] && (
                  <Button size="sm" onClick={() => fixIssues(kind, list)} data-testid={`jbeam-fix-${kind}`}>
                    {FIXABLE[kind]}
                  </Button>
                )}
              </header>
              <ul className={styles.checkList}>
                {list.slice(0, 50).map((i, n) => (
                  <li key={n}>
                    <button type="button" className={styles.checkRow} onClick={() => selectIssue(i)}>
                      <Circle className={styles.bullet} aria-hidden />
                      {i.message}
                    </button>
                  </li>
                ))}
                {list.length > 50 && <li className={styles.dim}>…and {list.length - 50} more</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </ScrollArea>
  );
}
