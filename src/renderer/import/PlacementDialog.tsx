import { create } from 'zustand';
import { useProjectStore, projectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { Modal } from '@renderer/ui/components/Modal';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { IDENTITY_PLACEMENT, type Placement } from '@shared/project/schema';
import styles from './PlacementDialog.module.css';

export const usePlacementUi = create<{
  sourceId: string | null;
  open: (id: string) => void;
  close: () => void;
}>()((set) => ({
  sourceId: null,
  open: (sourceId) => set({ sourceId }),
  close: () => set({ sourceId: null }),
}));

/** Move a model: every change shows in the viewport straight away and is one undo step. */
export function setPlacement(sourceId: string, placement: Placement): void {
  projectStore.getState().execute({
    label: 'Move model',
    coalesce: `placement:${sourceId}`,
    apply: (d) => {
      const s = d.sources.find((x) => x.id === sourceId);
      if (s) s.placement = placement;
    },
  });
}

const AXES = ['X', 'Y', 'Z'] as const;

/** Position (m), rotation (°) and scale of one imported model, e.g. a caliper added from the Objects library. */
export function PlacementDialog() {
  const sourceId = usePlacementUi((s) => s.sourceId);
  const close = usePlacementUi((s) => s.close);
  const source = useProjectStore((s) => s.doc?.sources.find((x) => x.id === sourceId));
  if (!sourceId || !source) return null;
  const p = source.placement;
  const set = (next: Partial<Placement>) => setPlacement(sourceId, { ...p, ...next });
  const vec = (key: 'position' | 'rotation', i: number, v: number) => {
    const next = [...p[key]] as [number, number, number];
    next[i] = v;
    set({ [key]: next });
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={`Placement · ${source.path.split(/[\\/]/).pop() ?? ''}`}
      size="sm"
      footer={
        <>
          <Button onClick={() => set(IDENTITY_PLACEMENT)} data-testid="placement-reset">
            Reset
          </Button>
          <Button variant="primary" onClick={close} data-testid="placement-done">
            Done
          </Button>
        </>
      }
    >
      <Field label="Position (m)" hint="BeamNG axes: +X left, +Y rearward, +Z up.">
        <div className={styles.row}>
          {AXES.map((a, i) => (
            <NumberInput key={a} aria-label={`Position ${a}`} value={p.position[i]!} step={0.01} precision={3} unit={a} onChange={(v) => vec('position', i, v)} />
          ))}
        </div>
      </Field>
      <Field label="Rotation (°)">
        <div className={styles.row}>
          {AXES.map((a, i) => (
            <NumberInput key={a} aria-label={`Rotation ${a}`} value={p.rotation[i]!} step={5} precision={1} min={-360} max={360} unit={a} onChange={(v) => vec('rotation', i, v)} />
          ))}
        </div>
      </Field>
      <Field label="Scale">
        <NumberInput aria-label="Scale" value={p.scale} step={0.05} precision={3} min={0.001} max={1000} onChange={(v) => set({ scale: v })} />
      </Field>
    </Modal>
  );
}
