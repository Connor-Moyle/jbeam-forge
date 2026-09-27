import { useEffect } from 'react';
import { DoorOpen, FlipHorizontal2, Trash2, WandSparkles } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { useEditStore } from '@renderer/structure/editStore';
import { Button } from '@renderer/ui/components/Button';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import { HINGE_DEFAULTS } from '@shared/hinges/schema';
import type { Part } from '@shared/project/schema';
import { addHinge, hingeFromSelection, hingeProblem, removeHinge, reguessHinge, updateHinge, useHingeUi } from './commands';
import styles from './HingeSection.module.css';

/** The game's input actions that open things (what the player presses, and what handles trigger). */
const ACTIONS = ['door_FL', 'door_FR', 'door_RL', 'door_RR', 'door_L', 'door_R', 'hoodRelease', 'trunk', 'tailgate', 'fuelDoor'];

const fmtVec = (p: readonly number[]) => p.map((v) => v.toFixed(2)).join(', ');

/** Inspector section for parts that open: hinge line, how far it swings, latch, handles and strength. */
export function HingeSection({ part }: { part: Part }) {
  const hinge = useProjectStore((s) => s.doc?.hinges.find((h) => h.partId === part.id));
  const problem = useProjectStore((s) => (s.doc ? hingeProblem(s.doc, part.id) : null));
  const selected = useEditStore((s) => s.nodes);
  const swing = useHingeUi((s) => s.swing);
  const pushStatus = useUiStore((s) => s.pushStatus);

  // Show this part's hinge in the viewport while its section is open.
  useEffect(() => {
    useHingeUi.getState().show(part.id);
    return () => {
      if (useHingeUi.getState().partId === part.id) useHingeUi.getState().show(null);
    };
  }, [part.id]);

  if (!hinge) {
    return (
      <FieldGroup title="Hinge">
        <p className={styles.note}>{problem ?? 'Opens on a hinge with a latch, like the stock cars: it swings to a stop, latches shut, and handles or a key open it.'}</p>
        <Button icon={DoorOpen} variant="primary" onClick={() => addHinge(part.id)} disabled={!!problem} data-testid="hinge-add">
          Add hinge
        </Button>
      </FieldGroup>
    );
  }
  const set = (patch: Parameters<typeof updateHinge>[1], label?: string) => updateHinge(part.id, patch, label);
  const fromSelection = (what: 'axis' | 'latch' | 'handle') => {
    const err = hingeFromSelection(part.id, what, selected);
    if (err) pushStatus(err, 'warning');
  };
  return (
    <FieldGroup title="Hinge">
      <Field label="Swing preview" hint="Shows it opening in the viewport (the see-through copy). Nothing is changed.">
        <Slider value={swing} onChange={(v) => useHingeUi.getState().setSwing(v)} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * hinge.openAngle)}°`} aria-label="Swing preview" />
      </Field>
      <Field label="Opens to">
        <Slider value={hinge.openAngle} onChange={(openAngle) => set({ openAngle }, 'Change opening angle')} min={5} max={180} step={1} format={(v) => `${v}°`} aria-label="Opening angle" />
      </Field>
      <div className={styles.row}>
        <Field label="Opened by" hint="The game’s key for it; handles trigger the same.">
          <Select value={hinge.action} onChange={(action) => set({ action }, 'Change hinge action')} options={[...new Set([hinge.action, ...ACTIONS])].map((a) => ({ value: a, label: a }))} aria-label="Opened by" />
        </Field>
        <Field label="Direction">
          <Button icon={FlipHorizontal2} onClick={() => set({ direction: hinge.direction === 1 ? -1 : 1 }, 'Flip swing direction')} data-testid="hinge-flip">
            Flip swing
          </Button>
        </Field>
      </div>
      <dl className={styles.points} data-testid="hinge-points">
        <dt>Hinge line</dt>
        <dd>
          {fmtVec(hinge.axis[0])} → {fmtVec(hinge.axis[1])}
        </dd>
        <dt>Latch</dt>
        <dd>{hinge.latch ? fmtVec(hinge.latch) : 'none (swings freely)'}</dd>
        <dt>Handles</dt>
        <dd>{hinge.handles.length ? hinge.handles.map((h) => `${h.inside ? 'inside' : 'outside'} ${fmtVec(h.pos)}`).join('; ') : 'none'}</dd>
      </dl>
      <p className={styles.note}>To move them, select nodes in edit mode (Tab), then:</p>
      <div className={styles.actions}>
        <Button size="sm" onClick={() => fromSelection('axis')} disabled={selected.length !== 2}>
          Hinge line from 2 nodes
        </Button>
        <Button size="sm" onClick={() => fromSelection('latch')} disabled={selected.length !== 1}>
          Latch here
        </Button>
        <Button size="sm" onClick={() => fromSelection('handle')} disabled={selected.length !== 1}>
          Add handle here
        </Button>
        {hinge.latch && (
          <Button size="sm" variant="ghost" onClick={() => set({ latch: null }, 'Remove latch')}>
            No latch
          </Button>
        )}
        {hinge.handles.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => set({ handles: [] }, 'Remove handles')}>
            Clear handles
          </Button>
        )}
      </div>
      <div className={styles.row}>
        <Toggle checked={hinge.autoLatch} onChange={(autoLatch) => set({ autoLatch })} label="Latches when shut" />
        <Toggle checked={hinge.popOpen} onChange={(popOpen) => set({ popOpen })} label="Pops open when unlatched" />
      </div>
      <CollapsibleSection id="hinge-advanced" title="Strength" defaultOpen={false}>
        <div className={styles.row}>
          <Field label="Hinge spring" hint={`Stock ${HINGE_DEFAULTS.stiffness.toLocaleString()}`}>
            <NumberInput value={hinge.stiffness} onChange={(stiffness) => set({ stiffness })} min={1000} max={1e8} step={10000} precision={0} unit="N/m" />
          </Field>
          <Field label="Damping">
            <NumberInput value={hinge.damping} onChange={(damping) => set({ damping })} min={0} max={10000} step={10} precision={0} />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Tears off at" hint="Hinge strength">
            <NumberInput value={hinge.strength} onChange={(strength) => set({ strength })} min={100} max={1e7} step={1000} precision={0} unit="N" />
          </Field>
          <Field label="Latch holds" hint="A harder hit pops it">
            <NumberInput value={hinge.latchStrength} onChange={(latchStrength) => set({ latchStrength })} min={100} max={1e7} step={1000} precision={0} unit="N" />
          </Field>
        </div>
      </CollapsibleSection>
      <div className={styles.actions}>
        <Button icon={WandSparkles} size="sm" onClick={() => reguessHinge(part.id)}>
          Guess again
        </Button>
        <Button icon={Trash2} size="sm" variant="ghost" onClick={() => removeHinge(part.id)} data-testid="hinge-remove">
          Remove hinge
        </Button>
      </div>
    </FieldGroup>
  );
}
