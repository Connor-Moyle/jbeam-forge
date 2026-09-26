import { useUiStore } from '@renderer/app/stores/ui';
import { useSceneStore } from '@renderer/app/stores/scene';
import { cx } from '@renderer/ui/cx';
import { useShell } from './ShellContext';
import { PRESET_LABELS } from './presets';
import styles from './StatusBar.module.css';

/** Counters are placeholders until geometry exists (Phase 4). */
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
  const values: Partial<Record<(typeof STATS)[number]['id'], string>> = { tris: triangles ? triangles.toLocaleString() : undefined };

  return (
    <footer className={styles.bar} data-testid="status-bar">
      {STATS.map((s) => (
        <span key={s.id} className={styles.stat} data-stat={s.id}>
          <span className={styles.value}>{values[s.id] ?? '—'}</span> {s.label}
        </span>
      ))}
      <span className={styles.sep} aria-hidden />
      <span className={styles.stat}>
        mode <span className={styles.value}>{PRESET_LABELS[preset]}</span>
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
