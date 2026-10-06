import { create } from 'zustand';
import { ScrollText, RefreshCw } from 'lucide-react';
import type { LogIssue, LogReport } from '@shared/beamng/logReport';
import { exportMeshNames } from '@shared/export/files';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { call } from '@renderer/diagnostics/ipc';
import { focusPart } from '@renderer/parts/focus';
import { switchWorkspace } from '@renderer/shell/workspaceBridge';
import { useEditStore } from '@renderer/structure/editStore';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Modal } from '@renderer/ui/components/Modal';
import styles from './GameLogDialog.module.css';

/**
 * Read the game's log for this car: after spawning it in BeamNG, what went wrong, grouped by
 * cause in plain words, with a way to jump to each part, node or mesh named.
 */

interface GameLogState {
  open: boolean;
  loading: boolean;
  report: (LogReport & { logTime: number }) | null;
  error: string | null;
  set: (patch: Partial<Omit<GameLogState, 'set'>>) => void;
}

export const useGameLog = create<GameLogState>()((set) => ({ open: false, loading: false, report: null, error: null, set: (patch) => set(patch) }));

export async function openGameLog(): Promise<void> {
  const doc = projectStore.getState().doc;
  const g = useGameLog.getState();
  if (!doc) return;
  g.set({ open: true, loading: true, error: null });
  try {
    const report = await call('beamng:logReport', { vehicle: doc.meta.slug });
    g.set({ report, loading: false, error: report ? null : 'No game log to read: set the BeamNG user folder in Settings → BeamNG.drive, then spawn the car in the game.' });
  } catch (err) {
    g.set({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Jump targets: a part of ours (by its jbeam name), a borrowed set (by its tag), a node, a mesh.
function jumpToPart(name: string): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const own = doc.parts.find((p) => p.name === name);
  if (own) {
    switchWorkspace('modelling');
    focusPart(own.id);
    return;
  }
  const tag = new RegExp(`^${doc.meta.slug}_([A-Z]\\d?)_`).exec(name)?.[1];
  if (tag?.startsWith('E') || tag?.startsWith('G')) switchWorkspace('engine');
  else if (tag) switchWorkspace('suspension');
}

function jumpToNodes(ids: readonly string[]): void {
  switchWorkspace('jbeam');
  const e = useEditStore.getState();
  e.setActive(true);
  e.select(ids, []);
}

function jumpToMesh(name: string): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const meshes = Object.values(useSceneStore.getState().sources).flatMap((s) => s.meshes);
  const names = exportMeshNames(doc, meshes);
  const key = [...names].find(([, n]) => n === name)?.[0];
  if (!key) return;
  switchWorkspace('modelling');
  const scene = useSceneStore.getState();
  scene.select([key]);
  scene.requestFrame([key], true);
}

function Targets({ issue }: { issue: LogIssue }) {
  const doc = projectStore.getState().doc;
  const nodeIds = new Set(doc?.nodes.map((n) => n.id) ?? []);
  const ours = issue.nodes.filter((n) => nodeIds.has(n));
  return (
    <div className={styles.targets}>
      {issue.parts.slice(0, 8).map((p) => (
        <Button key={p} size="sm" variant="ghost" onClick={() => jumpToPart(p)} title="Show this part">
          {p}
        </Button>
      ))}
      {ours.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => jumpToNodes(ours)} title="Pick these nodes in the JBeam workspace">
          {ours.length === 1 ? `Node ${ours[0]}` : `${ours.length} nodes`}
        </Button>
      )}
      {issue.nodes.filter((n) => !nodeIds.has(n)).slice(0, 6).map((n) => (
        <Badge key={n}>{n}</Badge>
      ))}
      {issue.meshes.slice(0, 8).map((m) => (
        <Button key={m} size="sm" variant="ghost" onClick={() => jumpToMesh(m)} title="Show this mesh">
          {m}
        </Button>
      ))}
      {[...issue.materials, ...issue.variables].slice(0, 8).map((m) => (
        <Badge key={m}>{m}</Badge>
      ))}
    </div>
  );
}

export function GameLogDialog() {
  const { open, loading, report, error, set } = useGameLog();
  if (!open) return null;
  const when = report ? new Date(report.logTime).toLocaleString() : '';
  return (
    <Modal open onOpenChange={(o) => set({ open: o })} title="What the game said about this car" size="lg">
      <div className={styles.body} data-testid="game-log">
        <p className={styles.note}>
          From BeamNG.drive’s log ({when || 'not read yet'}): the last time this car was loaded and spawned. Spawn it in the game, then read the log again.
        </p>
        {loading && <p className={styles.note}>Reading the log…</p>}
        {error && <Callout tone="warning">{error}</Callout>}
        {report && !report.found && <Callout tone="info">The log has no load of {report.vehicle}. Spawn the car in the game (export it with Install first), then read the log again.</Callout>}
        {report?.found && report.issues.length === 0 && <Callout tone="success">Nothing went wrong: the car loaded and spawned without errors.</Callout>}
        {report?.issues.map((i) => (
          <section key={i.kind} className={styles.issue} data-testid={`game-log-${i.kind}`}>
            <header className={styles.head}>
              <Badge tone={i.severity === 'error' ? 'danger' : 'warning'}>{i.count}×</Badge>
              <strong>{i.title}</strong>
            </header>
            <p className={styles.note}>{i.hint}</p>
            <Targets issue={i} />
            <details className={styles.lines}>
              <summary>The game’s lines</summary>
              <pre>{i.lines.join('\n')}</pre>
            </details>
          </section>
        ))}
        <div className={styles.row}>
          <Button icon={RefreshCw} onClick={() => void openGameLog()} disabled={loading} data-testid="game-log-refresh">
            Read it again
          </Button>
          <span className={styles.note}>
            <ScrollText aria-hidden className={styles.icon} /> Earlier problems often cause later ones: fix from the top.
          </span>
        </div>
      </div>
    </Modal>
  );
}
