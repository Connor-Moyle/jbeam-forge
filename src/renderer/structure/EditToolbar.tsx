import { FlipHorizontal2, Magnet, MousePointer2, Network, Trash2, X } from 'lucide-react';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Slider } from '@renderer/ui/components/Slider';
import { useSplitTool } from '@renderer/split/splitTool';
import styles from '@renderer/split/SplitToolbar.module.css';
import { useEditStore } from './editStore';
import { deleteSelection, selectConnected } from './editCommands';

/** Floating structure-edit controls over the viewport while edit mode is on. */
export function EditToolbar() {
  const active = useEditStore((s) => s.active);
  const nodes = useEditStore((s) => s.nodes.length);
  const beams = useEditStore((s) => s.beams.length);
  const symmetry = useEditStore((s) => s.symmetry);
  const soft = useEditStore((s) => s.soft);
  const softRadius = useEditStore((s) => s.softRadius);
  const setOptions = useEditStore((s) => s.setOptions);
  const setActive = useEditStore((s) => s.setActive);
  const splitting = useSplitTool((s) => s.meshKey !== null);
  if (!active || splitting) return null;

  return (
    <div className={styles.bar} role="toolbar" aria-label="Structure editing" data-testid="edit-toolbar">
      <span className={styles.title}>
        <MousePointer2 aria-hidden />
        Edit structure
      </span>
      <div className={styles.group}>
        <IconButton icon={FlipHorizontal2} label="Symmetry: moving a node moves its left/right partner too" size="sm" active={symmetry} onClick={() => setOptions({ symmetry: !symmetry })} data-testid="edit-symmetry" />
        <IconButton icon={Magnet} label="Soft-move: nearby nodes follow with a falloff" size="sm" active={soft} onClick={() => setOptions({ soft: !soft })} data-testid="edit-soft" />
      </div>
      {soft && (
        <label className={styles.control}>
          Radius
          <Slider value={softRadius} onChange={(r) => setOptions({ softRadius: r })} min={0.02} max={1.5} step={0.01} format={(v) => `${v.toFixed(2)} m`} aria-label="Soft-move radius" className={styles.slider} />
          <span className={styles.value}>{softRadius.toFixed(2)} m</span>
        </label>
      )}
      <span className={styles.count} data-testid="edit-count">
        {nodes ? `${nodes} node${nodes === 1 ? '' : 's'}` : beams ? `${beams} beam${beams === 1 ? '' : 's'}` : 'Click or drag to select'}
      </span>
      <div className={styles.group}>
        <IconButton icon={Network} label="Select connected (L)" size="sm" onClick={selectConnected} disabled={!nodes} />
        <IconButton icon={Trash2} label="Delete (Del)" size="sm" onClick={deleteSelection} disabled={!nodes && !beams} data-testid="edit-delete" />
      </div>
      <span className={styles.hint}>Right-drag orbits · arrows nudge</span>
      <IconButton icon={X} label="Leave edit mode (Tab)" size="sm" onClick={() => setActive(false)} data-testid="edit-exit" />
    </div>
  );
}
