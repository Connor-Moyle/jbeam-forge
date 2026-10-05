import { useUiStore } from '@renderer/app/stores/ui';
import { useMemo } from 'react';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useProjectStore } from '@renderer/app/stores/project';
import { EMPTY_ARR } from '@shared/empty';
import { cx } from '@renderer/ui/cx';
import { Tooltip } from '@renderer/ui/components/Tooltip';
import { massBalance } from '@shared/structure/balance';
import { useShell } from './ShellContext';
import { PRESET_LABELS } from './presets';
import styles from './StatusBar.module.css';

/** Structure totals (live with edits); "tris" are collision triangles once structure exists, else visible mesh triangles. */
const STATS = [
  { id: 'nodes', label: 'nodes' },
  { id: 'beams', label: 'beams' },
  { id: 'tris', label: 'tris' },
  { id: 'mass', label: 'kg' },
] as const;

export function StatusBar() {
  const status = useUiStore((s) => s.status);
  const { preset } = useShell();
  const triangles = useSceneStore((s) => {
    let n = 0;
    for (const src of Object.values(s.sources)) for (const m of src.meshes) if (!s.hidden[m.key]) n += m.triangles;
    return n;
  });
  const nodes = useProjectStore((s) => s.doc?.nodes);
  const beams = useProjectStore((s) => s.doc?.beams.length ?? 0);
  const collisionTris = useProjectStore((s) => s.doc?.tris.length ?? 0);
  const mass = useMemo(() => (nodes ?? EMPTY_ARR).reduce((m, n) => m + n.weight, 0), [nodes]);
  const balance = useMemo(() => massBalance(nodes ?? EMPTY_ARR), [nodes]);
  const hasStructure = (nodes?.length ?? 0) > 0;
  const values: Partial<Record<(typeof STATS)[number]['id'], string>> = hasStructure
    ? { nodes: nodes!.length.toLocaleString(), beams: beams.toLocaleString(), tris: collisionTris.toLocaleString(), mass: mass.toFixed(1) }
    : { tris: triangles ? triangles.toLocaleString() : undefined };
  const labels: Partial<Record<(typeof STATS)[number]['id'], string>> = hasStructure ? {} : { tris: 'mesh tris' };

  return (
    <footer className={styles.bar} data-testid="status-bar">
      {STATS.map((s) => (
        <span key={s.id} className={styles.stat} data-stat={s.id}>
          <span className={styles.value}>{values[s.id] ?? '—'}</span> {labels[s.id] ?? s.label}
        </span>
      ))}
      {balance && (
        <Tooltip side="top" content={`Centre of gravity ${balance.cog.map((v) => v.toFixed(2)).join(', ')} m (X left, Y rear, Z up). Front/rear is split about the middle of the structure until the car has axles.`}>
          <span className={styles.stat} data-stat="balance" tabIndex={0}>
            F/R <span className={styles.value}>{Math.round(balance.front * 100)}/{100 - Math.round(balance.front * 100)}</span> · L/R{' '}
            <span className={styles.value}>{Math.round(balance.left * 100)}/{100 - Math.round(balance.left * 100)}</span>
          </span>
        </Tooltip>
      )}
      <span className={styles.sep} aria-hidden />
      <span className={styles.stat}>
        workspace <span className={styles.value}>{PRESET_LABELS[preset]}</span>
      </span>
      <div className={styles.messageSlot} aria-live="polite">
        {status && (
          <span key={status.id} className={cx(styles.message, styles[status.tone])}>
            {status.text}
          </span>
        )}
      </div>
    </footer>
  );
}
