import { CircleDot, Disc3, FileInput, Plus, Trash2 } from 'lucide-react';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { startImport } from '@renderer/import/importFlow';
import { pickTread, rimSlot, sizeLabel, TREAD_PRESETS, TREADS, tyreRadius, tyreSlot, type RimSpec, type Tread, type TyreSize, type TyreSpec } from '@shared/wheels/schema';
import { Button } from '@renderer/ui/components/Button';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import styles from '@renderer/jbeam/Jbeam.module.css';
import own from './Wheels.module.css';

/**
 * Tyre and wheel builders (fork): the whole of a tyre or wheel mod. Sizes
 * and grip for tyres, size, lugs and hub for wheels; the model (optional)
 * is imported like any other. Every change is one undo step.
 */

const AXLES = [
  { value: 'both', label: 'Front and rear' },
  { value: 'F', label: 'Front only' },
  { value: 'R', label: 'Rear only' },
] as const;

function setTyre(patch: Partial<TyreSpec>, label: string) {
  projectStore.getState().execute({ label, coalesce: `tyre:${Object.keys(patch).join(',')}`, apply: (d) => void (d.tyre = { ...d.tyre!, ...patch }) });
}

function setRim(patch: Partial<RimSpec>, label: string) {
  projectStore.getState().execute({ label, coalesce: `rim:${Object.keys(patch).join(',')}`, apply: (d) => void (d.rim = { ...d.rim!, ...patch }) });
}

function ModelHint({ what }: { what: string }) {
  const meshes = useProjectStore((s) => s.doc?.sources.length ?? 0);
  return (
    <CollapsibleSection id={`${what}-model`} title="Model" defaultOpen={!meshes}>
      <p className={styles.sub}>
        {meshes
          ? `The imported model is the ${what}'s mesh. Model it centred on the origin, turning about the X axis, like the game's own ${what}s.`
          : `Optional: import the ${what}'s 3D model (centred on the origin, turning about X). Without one it works in the game but can't be seen.`}
      </p>
      <Button size="sm" icon={FileInput} onClick={() => void startImport()}>
        Import {meshes ? 'another' : 'the'} model
      </Button>
    </CollapsibleSection>
  );
}

export function TyreBuilderPanel() {
  const spec = useProjectStore((s) => s.doc?.tyre);
  const advanced = useSettingsStore((s) => s.settings?.jbeamAdvanced ?? false);
  if (!spec) return <EmptyState icon={CircleDot} message="This mod isn't a tyre mod. Start one from New mod → Tyres." />;
  const setSize = (i: number, patch: Partial<TyreSize>) => setTyre({ sizes: spec.sizes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }, 'Change tyre size');
  const num = (key: keyof TyreSpec, label: string, min: number, max: number, step: number, precision: number, unit?: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumberInput value={spec[key] as number} onChange={(v) => setTyre({ [key]: v }, `Change ${label.toLowerCase()}`)} min={min} max={max} step={step} precision={precision} unit={unit} aria-label={label} />
    </Field>
  );
  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.body} data-testid="tyre-builder">
        <div className={own.title}>
          <CircleDot aria-hidden />
          <span>Tyre builder</span>
        </div>
        <p className={styles.sub}>Universal tyres: every car whose rims take a size gets them in its parts menu. One part per size and axle, named like the game’s own.</p>
        <Field label="Name" hint="Shown in the parts menu, before the size.">
          <Input key={spec.name} defaultValue={spec.name} onBlur={(e) => e.target.value.trim() && e.target.value !== spec.name && setTyre({ name: e.target.value.trim() }, 'Rename tyre')} aria-label="Tyre name" />
        </Field>

        <CollapsibleSection id="tyre-sizes" title={`Sizes (${spec.sizes.length})`} defaultOpen>
          <table className={own.sizes}>
            <thead>
              <tr>
                <th>Width mm</th>
                <th>Profile %</th>
                <th>Rim in</th>
                <th>Rim width in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {spec.sizes.map((s, i) => (
                <tr key={i}>
                  <td>
                    <NumberInput value={s.width} onChange={(width) => setSize(i, { width: Math.round(width) })} min={100} max={500} step={5} precision={0} aria-label="Width" />
                  </td>
                  <td>
                    <NumberInput value={s.aspect} onChange={(aspect) => setSize(i, { aspect: Math.round(aspect) })} min={15} max={100} step={5} precision={0} aria-label="Profile" />
                  </td>
                  <td>
                    <NumberInput value={s.rim} onChange={(rim) => setSize(i, { rim: Math.round(rim) })} min={10} max={26} step={1} precision={0} aria-label="Rim diameter" />
                  </td>
                  <td>
                    <NumberInput value={s.rimWidth} onChange={(rimWidth) => setSize(i, { rimWidth })} min={3} max={15} step={0.5} precision={1} aria-label="Rim width" />
                  </td>
                  <td>
                    <IconButton icon={Trash2} label="Remove this size" size="sm" disabled={spec.sizes.length < 2} onClick={() => setTyre({ sizes: spec.sizes.filter((_, j) => j !== i) }, 'Remove tyre size')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={own.summary}>
            {spec.sizes.map((s, i) => (
              <li key={i}>
                <strong>{sizeLabel(s)}</strong> · {Math.round(tyreRadius(s) * 2000)} mm tall · fits {tyreSlot('F', s.rim, s.rimWidth).replace('tire_F_', '')} rims
              </li>
            ))}
          </ul>
          <Button size="sm" icon={Plus} onClick={() => setTyre({ sizes: [...spec.sizes, { ...spec.sizes[spec.sizes.length - 1]! }] }, 'Add tyre size')} data-testid="tyre-add-size">
            Add a size
          </Button>
        </CollapsibleSection>

        <CollapsibleSection id="tyre-tread" title="Tread and grip" defaultOpen>
          <Field label="Kind of tyre" hint={TREAD_PRESETS[spec.tread].hint}>
            <Select<Tread> value={spec.tread} onChange={(t) => setTyre(pickTread(t), 'Change tread')} options={TREADS.map((t) => ({ value: t, label: TREAD_PRESETS[t].label }))} aria-label="Kind of tyre" data-testid="tyre-tread" />
          </Field>
          <Field label="Grip" hint="Peak grip against the road (the game’s road tyres are about 1).">
            <Slider value={spec.frictionCoef} onChange={(frictionCoef) => setTyre({ frictionCoef }, 'Change grip')} min={0.6} max={1.6} step={0.01} format={(v) => v.toFixed(2)} aria-label="Grip" />
          </Field>
          <Field label="Sliding grip" hint="How much grip is left once it slides.">
            <Slider value={spec.slidingFrictionCoef} onChange={(slidingFrictionCoef) => setTyre({ slidingFrictionCoef }, 'Change sliding grip')} min={0.4} max={1.2} step={0.01} format={(v) => v.toFixed(2)} aria-label="Sliding grip" />
          </Field>
          <Field label="Tread depth" hint="0 is a slick; more digs into mud and snow.">
            <Slider value={spec.treadCoef} onChange={(treadCoef) => setTyre({ treadCoef }, 'Change tread depth')} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} aria-label="Tread depth" />
          </Field>
          <Field label="Axles">
            <Select value={spec.axles} onChange={(axles) => setTyre({ axles }, 'Change tyre axles')} options={AXLES} aria-label="Axles" />
          </Field>
        </CollapsibleSection>

        <CollapsibleSection id="tyre-pressure" title="Pressure" defaultOpen>
          <div className={styles.row2}>
            {num('pressureFront', 'Front', 5, 120, 1, 0, 'psi')}
            {num('pressureRear', 'Rear', 5, 120, 1, 0, 'psi')}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="tyre-advanced" title="Construction (advanced)" defaultOpen={advanced}>
          <div className={styles.row2}>
            {num('noLoadCoef', 'Grip with no load', 0.1, 4, 0.01, 2)}
            {num('fullLoadCoef', 'Grip at full load', 0.05, 3, 0.01, 2)}
            {num('loadSensitivitySlope', 'Load sensitivity', 0, 0.01, 0.00001, 5)}
            {num('softnessCoef', 'Softness', 0, 2, 0.05, 2)}
            {num('numRays', 'Rays (nodes around)', 8, 40, 1, 0, undefined, 'More is rounder and heavier to simulate.')}
            {num('nodeWeight', 'Tread node weight', 0.05, 5, 0.01, 2, 'kg')}
            {num('sideSpring', 'Sidewall stiffness', 0, 1e7, 1000, 0, 'N/m')}
            {num('sideDamp', 'Sidewall damping', 0, 1e4, 1, 1)}
            {num('treadSpring', 'Tread stiffness', 0, 1e7, 1000, 0, 'N/m')}
            {num('treadDamp', 'Tread damping', 0, 1e4, 1, 1)}
            {num('peripherySpring', 'Periphery stiffness', 0, 1e7, 1000, 0, 'N/m')}
            {num('peripheryDamp', 'Periphery damping', 0, 1e4, 1, 1)}
          </div>
          {num('value', 'Price', 0, 1_000_000, 10, 0, '$')}
        </CollapsibleSection>

        <ModelHint what="tyre" />
      </div>
    </ScrollArea>
  );
}

export function WheelBuilderPanel() {
  const spec = useProjectStore((s) => s.doc?.rim);
  if (!spec) return <EmptyState icon={Disc3} message="This mod isn't a wheel mod. Start one from New mod → Wheels." />;
  const num = (key: keyof RimSpec, label: string, min: number, max: number, step: number, precision: number, unit?: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumberInput value={spec[key] as number} onChange={(v) => setRim({ [key]: v }, `Change ${label.toLowerCase()}`)} min={min} max={max} step={step} precision={precision} unit={unit} aria-label={label} />
    </Field>
  );
  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.body} data-testid="wheel-builder">
        <div className={own.title}>
          <Disc3 aria-hidden />
          <span>Wheel builder</span>
        </div>
        <p className={styles.sub}>
          Universal wheels: every car whose hubs take {spec.lugs} lugs gets them in its parts menu ({rimSlot('F', spec.lugs)}), and they take the game’s {spec.diameter}x{spec.width} tyres (or a tyre mod’s).
        </p>
        <Field label="Name">
          <Input key={spec.name} defaultValue={spec.name} onBlur={(e) => e.target.value.trim() && e.target.value !== spec.name && setRim({ name: e.target.value.trim() }, 'Rename wheel')} aria-label="Wheel name" />
        </Field>
        <div className={styles.row2}>
          {num('diameter', 'Diameter', 10, 26, 1, 0, 'in')}
          {num('width', 'Width', 3, 15, 0.5, 1, 'in')}
          {num('lugs', 'Lugs', 3, 10, 1, 0)}
          {num('offsetMm', 'Offset', -100, 100, 1, 0, 'mm', 'Positive pulls the wheel in towards the car.')}
        </div>
        <Field label="Axles">
          <Select value={spec.axles} onChange={(axles) => setRim({ axles }, 'Change wheel axles')} options={AXLES} aria-label="Axles" />
        </Field>
        <CollapsibleSection id="wheel-hub" title="Hub (advanced)" defaultOpen={false}>
          <div className={styles.row2}>
            {num('hubNodeWeight', 'Hub node weight', 0.05, 10, 0.05, 2, 'kg')}
            {num('hubBeamSpring', 'Hub stiffness', 0, 1e8, 10000, 0, 'N/m')}
            {num('hubBeamDamp', 'Hub damping', 0, 1e4, 1, 1)}
            {num('value', 'Price', 0, 1_000_000, 10, 0, '$')}
          </div>
        </CollapsibleSection>
        <Toggle checked={spec.axles === 'both'} onChange={(on) => setRim({ axles: on ? 'both' : 'F' }, 'Change wheel axles')} label="Same wheel front and rear" />
        <ModelHint what="wheel" />
      </div>
    </ScrollArea>
  );
}
