import { ArrowUpFromLine, Check, CircleDot, FlipVertical2, Move, Pentagon, Rotate3d, Scaling, Spline, Trash2, Triangle } from 'lucide-react';
import { IconButton } from '@renderer/ui/components/IconButton';
import { useProjectStore } from '@renderer/app/stores/project';
import styles from '@renderer/split/SplitToolbar.module.css';
import { deleteSelection, enterModelling, extrudeSelection, fillSelection, flipSelection, sceneMesh, setSelectMode, useModelUi, type ModelGizmo, type SelectMode } from './commands';

const MODES: { mode: SelectMode; label: string; icon: typeof CircleDot }[] = [
  { mode: 'vertex', label: 'Points (1)', icon: CircleDot },
  { mode: 'edge', label: 'Edges (2)', icon: Spline },
  { mode: 'face', label: 'Faces (3)', icon: Triangle },
];

const GIZMOS: { mode: ModelGizmo; label: string; icon: typeof Move }[] = [
  { mode: 'translate', label: 'Move (G)', icon: Move },
  { mode: 'rotate', label: 'Turn (R)', icon: Rotate3d },
  { mode: 'scale', label: 'Resize (S)', icon: Scaling },
];

/** Floating Modelling controls over the viewport while a mesh is being reshaped. */
export function ModelPill() {
  const key = useModelUi((s) => s.key);
  const mode = useModelUi((s) => s.mode);
  const gizmo = useModelUi((s) => s.gizmo);
  const count = useModelUi((s) => (s.mode === 'vertex' ? s.points.length : s.mode === 'edge' ? s.edges.length : s.faces.length));
  const name = useProjectStore((s) => (key ? (s.doc?.meshNames[key]?.name ?? sceneMesh(key)?.name ?? key) : ''));
  if (!key) return null;
  const noun = mode === 'vertex' ? 'point' : mode === 'edge' ? 'edge' : 'face';
  return (
    <div className={styles.bar} role="toolbar" aria-label="Modelling" data-testid="model-toolbar">
      <span className={styles.title}>
        <Pentagon aria-hidden />
        Reshaping {name}
      </span>
      <div className={styles.group}>
        {MODES.map((m) => (
          <IconButton key={m.mode} icon={m.icon} label={m.label} size="sm" active={mode === m.mode} onClick={() => setSelectMode(m.mode)} data-testid={`model-mode-${m.mode}`} />
        ))}
      </div>
      <div className={styles.group}>
        {GIZMOS.map((g) => (
          <IconButton key={g.mode} icon={g.icon} label={g.label} size="sm" active={gizmo === g.mode} onClick={() => useModelUi.getState().set({ gizmo: g.mode })} data-testid={`model-gizmo-${g.mode}`} />
        ))}
      </div>
      <span className={styles.count} data-testid="model-count">
        {count ? `${count} ${noun}${count === 1 ? '' : 's'}` : `Click a ${noun}; Shift adds`}
      </span>
      <div className={styles.group}>
        <IconButton icon={ArrowUpFromLine} label="Extrude (E)" size="sm" onClick={extrudeSelection} disabled={!count} data-testid="model-extrude" />
        <IconButton icon={Pentagon} label="Fill a face from 3–4 points (F)" size="sm" onClick={fillSelection} disabled={!count} data-testid="model-fill" />
        <IconButton icon={FlipVertical2} label="Flip normals (Alt+N)" size="sm" onClick={flipSelection} disabled={!count} data-testid="model-flip" />
        <IconButton icon={Trash2} label="Delete (X)" size="sm" onClick={deleteSelection} disabled={!count} data-testid="model-delete" />
      </div>
      <IconButton icon={Check} label="Done (Tab)" size="sm" onClick={() => enterModelling(null)} data-testid="model-done" />
    </div>
  );
}
