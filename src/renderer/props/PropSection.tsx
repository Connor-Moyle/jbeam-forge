import { MovePartSwitch } from '@renderer/moving/MovePartSwitch';
import { useEffect } from 'react';
import { FlipHorizontal2, RotateCw, Trash2 } from 'lucide-react';
import { EMPTY_ARR } from '@shared/empty';
import { PROP_KINDS, propAmount } from '@shared/props/props';
import { useProjectStore } from '@renderer/app/stores/project';
import { useEditStore } from '@renderer/structure/editStore';
import { Button } from '@renderer/ui/components/Button';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { Field } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { addProp, guessPivot, removeProp, updateProp, usePropUi } from './commands';
import styles from '@renderer/scene/MeshSection.module.css';

const AXES: { label: string; v: [number, number, number] }[] = [
  { label: 'X', v: [1, 0, 0] },
  { label: 'Y', v: [0, 1, 0] },
  { label: 'Z', v: [0, 0, 1] },
];

/** Inspector: make the selected mesh an animated part (prop): what drives it, where it turns, how far. */
export function PropSection({ meshKey }: { meshKey: string }) {
  const prop = useProjectStore((s) => (s.doc?.props ?? EMPTY_ARR).find((p) => p.meshKey === meshKey));
  const value = usePropUi((s) => s.value);
  const nodes = useEditStore((s) => s.nodes);
  const nodePos = useProjectStore((s) => (nodes.length === 1 ? s.doc?.nodes.find((n) => n.id === nodes[0])?.pos : undefined));
  useEffect(() => {
    if (prop) usePropUi.getState().show(prop.id);
    return () => {
      if (prop && usePropUi.getState().propId === prop.id) usePropUi.getState().show(null);
    };
  }, [prop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!prop) {
    return (
      <CollapsibleSection id="mesh-prop" title="Animation" defaultOpen={false}>
        <p className={styles.note}>Make it move in the game: a steering wheel that turns, needles that read the revs, speed, fuel or temperature, pedals that press.</p>
        <Select value={undefined} onChange={(k) => addProp(meshKey, k)} options={PROP_KINDS.map((k) => ({ value: k.id, label: k.label }))} placeholder="Animate it as…" aria-label="Animate as" data-testid="prop-add" />
      </CollapsibleSection>
    );
  }
  const kind = PROP_KINDS.find((k) => k.func === prop.func && k.id !== 'custom');
  const slides = Math.hypot(...prop.axis) < 1e-9;
  const range = Math.max(Math.abs(prop.min), Math.abs(prop.max)) / Math.max(1e-9, Math.abs(prop.multiplier));
  const amount = propAmount(prop, value);
  return (
    <CollapsibleSection id="mesh-prop" title={`Animation: ${kind?.label ?? prop.func}`} defaultOpen>
      <Field label="Driven by" hint="The game's electrics value: steering, rpmTacho, wheelspeed (m/s), fuel, watertemp, throttle, brake, clutch, parkingbrake…">
        <Input value={prop.func} onChange={(e) => e.target.value.trim() && updateProp(prop.id, { func: e.target.value.trim() })} mono aria-label="Electrics value" />
      </Field>
      <Field label="Try it" hint={slides ? `Slides ${(amount * 100).toFixed(1)} cm` : `Turns ${amount.toFixed(0)}° in the viewport`}>
        <Slider value={value} onChange={(v) => usePropUi.getState().setValue(v)} min={-range} max={range} step={range / 200 || 0.01} format={(v) => v.toFixed(Math.abs(range) < 10 ? 2 : 0)} aria-label="Test value" />
      </Field>
      <MovePartSwitch />
      <Field label="Turns about" hint="Its pivot (where it turns) and axis, in BeamNG space">
        <div className={styles.triple}>
          {[0, 1, 2].map((i) => (
            <NumberInput key={i} value={prop.pivot[i]!} onChange={(v) => updateProp(prop.id, { pivot: prop.pivot.map((p, j) => (j === i ? v : p)) as [number, number, number] })} step={0.005} precision={3} unit={'XYZ'[i]} aria-label={`Pivot ${'XYZ'[i]}`} />
          ))}
        </div>
      </Field>
      <div className={styles.actions}>
        {AXES.map((a) => (
          <Button key={a.label} size="sm" variant={prop.axis.every((c, i) => Math.abs(c - a.v[i]!) < 1e-6) ? 'primary' : 'default'} onClick={() => updateProp(prop.id, { axis: a.v }, 'Change axis')}>
            Axis {a.label}
          </Button>
        ))}
        <Button size="sm" icon={FlipHorizontal2} onClick={() => updateProp(prop.id, { axis: prop.axis.map((c) => -c || 0) as [number, number, number] }, 'Reverse direction')}>
          Reverse
        </Button>
        <Button size="sm" icon={RotateCw} variant="ghost" onClick={() => updateProp(prop.id, guessPivot(meshKey, kind?.id ?? ''), 'Guess pivot')}>
          Guess
        </Button>
        {nodePos && (
          <Button size="sm" variant="ghost" onClick={() => updateProp(prop.id, { pivot: [...nodePos] as [number, number, number] }, 'Pivot at node')}>
            Pivot at selected node
          </Button>
        )}
      </div>
      <div className={styles.pair}>
        <Field label="× Multiplier">
          <NumberInput value={prop.multiplier} onChange={(multiplier) => updateProp(prop.id, { multiplier })} step={0.01} precision={4} aria-label="Multiplier" />
        </Field>
        <Field label="+ Offset">
          <NumberInput value={prop.offset} onChange={(offset) => updateProp(prop.id, { offset })} step={1} precision={2} aria-label="Offset" />
        </Field>
        <Field label="Least">
          <NumberInput value={prop.min} onChange={(min) => updateProp(prop.id, { min })} step={1} precision={1} unit={slides ? 'm' : '°'} aria-label="Minimum" />
        </Field>
        <Field label="Most">
          <NumberInput value={prop.max} onChange={(max) => updateProp(prop.id, { max })} step={1} precision={1} unit={slides ? 'm' : '°'} aria-label="Maximum" />
        </Field>
      </div>
      <p className={styles.note}>Exported as the part&rsquo;s props: the game turns it by value × multiplier + offset, kept between least and most. It rides on its part&rsquo;s nodes instead of bending with them.</p>
      <Button size="sm" icon={Trash2} variant="ghost" onClick={() => removeProp(prop.id)}>
        Stop animating
      </Button>
    </CollapsibleSection>
  );
}
