import { BoxSelect, Brush, FlipHorizontal2, Lasso, PaintBucket, Scissors, SquareSplitHorizontal, X } from 'lucide-react';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { applySplitSelection, boundsRange, findMesh, useSplitTool, type PlaneAxis, type SplitMode } from './splitTool';
import styles from './SplitToolbar.module.css';

const MODES: { mode: SplitMode; icon: typeof BoxSelect; label: string }[] = [
  { mode: 'fill', icon: PaintBucket, label: 'Fill: click a face, grows until an edge sharper than the angle limit' },
  { mode: 'box', icon: BoxSelect, label: 'Box: drag a rectangle (selects through the mesh)' },
  { mode: 'lasso', icon: Lasso, label: 'Lasso: draw around faces (selects through the mesh)' },
  { mode: 'paint', icon: Brush, label: 'Paint: drag over faces (brush radius)' },
  { mode: 'plane', icon: SquareSplitHorizontal, label: 'Plane cut: everything on one side of a plane' },
];

/** Floating split-tool controls over the viewport (SPEC §4.2 face-selection split + plane cut). */
export function SplitToolbar() {
  const meshKey = useSplitTool((s) => s.meshKey);
  const mode = useSplitTool((s) => s.mode);
  const selected = useSplitTool((s) => s.selected);
  const angle = useSplitTool((s) => s.angleDeg);
  const radius = useSplitTool((s) => s.radius);
  const plane = useSplitTool((s) => s.plane);
  const setMode = useSplitTool((s) => s.setMode);
  const setAngle = useSplitTool((s) => s.setAngle);
  const setRadius = useSplitTool((s) => s.setRadius);
  const setPlane = useSplitTool((s) => s.setPlane);
  const select = useSplitTool((s) => s.select);
  const cancel = useSplitTool((s) => s.cancel);
  if (!meshKey) return null;
  const mesh = findMesh(meshKey);
  const range = mesh ? boundsRange(mesh.geometry, plane.axis) : ([0, 1] as [number, number]);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Split tool" data-testid="split-toolbar">
      <span className={styles.title}>
        <Scissors aria-hidden />
        Split {mesh?.name ?? ''}
      </span>
      <div className={styles.group}>
        {MODES.map((m) => (
          <IconButton key={m.mode} icon={m.icon} label={m.label} active={mode === m.mode} size="sm" onClick={() => setMode(m.mode)} data-testid={`split-mode-${m.mode}`} />
        ))}
      </div>
      {mode === 'fill' && (
        <label className={styles.control}>
          Angle
          <Slider value={angle} onChange={setAngle} min={1} max={90} step={1} format={(v) => `${v}°`} aria-label="Angle limit" className={styles.slider} />
          <span className={styles.value}>{angle}°</span>
        </label>
      )}
      {mode === 'paint' && (
        <label className={styles.control}>
          Radius
          <Slider value={radius} onChange={setRadius} min={0.01} max={1} step={0.01} format={(v) => `${v.toFixed(2)} m`} aria-label="Brush radius" className={styles.slider} />
          <span className={styles.value}>{radius.toFixed(2)} m</span>
        </label>
      )}
      {mode === 'plane' && (
        <>
          <Select<PlaneAxis>
            value={plane.axis}
            onChange={(axis) => setPlane({ axis })}
            options={[
              { value: 'x', label: 'X · left/right' },
              { value: 'y', label: 'Y · front/rear' },
              { value: 'z', label: 'Z · up/down' },
            ]}
            className={styles.axis}
          />
          <Slider value={plane.offset} onChange={(offset) => setPlane({ offset })} min={range[0]} max={range[1]} step={(range[1] - range[0]) / 200 || 0.01} format={(v) => `${v.toFixed(3)} m`} aria-label="Plane position" className={styles.slider} />
          <IconButton icon={FlipHorizontal2} label="Flip side" size="sm" active={plane.flip} onClick={() => setPlane({ flip: !plane.flip })} />
        </>
      )}
      <span className={styles.count} data-testid="split-count">
        {selected.length.toLocaleString()} / {(mesh?.triangles ?? 0).toLocaleString()} tris
      </span>
      <Button size="sm" variant="ghost" onClick={() => select([], 'replace')} disabled={selected.length === 0}>
        Clear
      </Button>
      <Button size="sm" variant="primary" icon={Scissors} onClick={() => void applySplitSelection()} disabled={selected.length === 0} data-testid="split-apply">
        Split off
      </Button>
      <IconButton icon={X} label="Cancel (Esc)" size="sm" onClick={cancel} />
    </div>
  );
}
