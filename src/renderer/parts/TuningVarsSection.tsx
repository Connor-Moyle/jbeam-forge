import { useProjectStore, projectStore } from '@renderer/app/stores/project';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Toggle } from '@renderer/ui/components/Toggle';
import { EMPTY_ARR } from '@shared/empty';
import type { Part, TuningVar } from '@shared/project/schema';
import styles from './TuningVarsSection.module.css';

/**
 * Part settings the player can change in the game's tuning menu. Each is a
 * scale (×) on the part's weight, stiffness or strength, between a min and a
 * max; the export writes them as jbeam variables the part's nodes and beams use.
 */

const SETTINGS: { setting: TuningVar['setting']; label: string; hint: string; range: [number, number] }[] = [
  { setting: 'mass', label: 'Weight', hint: 'Lighter or heavier versions of the part', range: [0.5, 1.5] },
  { setting: 'stiffness', label: 'Stiffness', hint: 'How much it flexes', range: [0.7, 1.5] },
  { setting: 'strength', label: 'Strength', hint: 'How much it takes to bend or break it', range: [0.5, 2] },
];

export function setTuningVar(partId: string, setting: TuningVar['setting'], patch: Partial<Omit<TuningVar, 'id' | 'partId' | 'setting'>> | null): void {
  projectStore.getState().execute({
    label: patch === null ? 'Not adjustable in game' : 'Adjustable in game',
    coalesce: `var:${partId}:${setting}:${patch ? Object.keys(patch).join(',') : 'off'}`,
    apply: (d) => {
      const i = d.variables.findIndex((v) => v.partId === partId && v.setting === setting);
      if (patch === null) {
        if (i >= 0) d.variables.splice(i, 1);
        return;
      }
      const def = SETTINGS.find((s) => s.setting === setting)!;
      const cur = i >= 0 ? d.variables[i]! : { id: `var_${crypto.randomUUID().slice(0, 8)}`, partId, setting, min: def.range[0], max: def.range[1], default: 1 };
      const next = { ...cur, ...patch };
      // Keep min ≤ default ≤ max.
      next.min = Math.min(next.min, next.max);
      next.default = Math.min(next.max, Math.max(next.min, next.default));
      if (i >= 0) d.variables[i] = next;
      else d.variables.push(next);
    },
  });
}

export function TuningVarsSection({ part }: { part: Part }) {
  const vars = useProjectStore((s) => s.doc?.variables ?? EMPTY_ARR);
  return (
    <FieldGroup title="Adjustable in game">
      <p className={styles.note}>Ticked settings show in BeamNG&rsquo;s tuning menu for this part, as a scale between min and max.</p>
      {SETTINGS.map(({ setting, label, hint, range }) => {
        const v = vars.find((x) => x.partId === part.id && x.setting === setting);
        return (
          <div key={setting} className={styles.setting} data-testid={`tuning-var-${setting}`}>
            <Toggle checked={!!v} onChange={(on) => setTuningVar(part.id, setting, on ? { min: range[0], max: range[1], default: 1 } : null)} label={label} />
            {v ? (
              <div className={styles.row}>
                <Field label="Min">
                  <NumberInput aria-label={`${label} min`} value={v.min} onChange={(min) => setTuningVar(part.id, setting, { min })} min={0.05} max={10} step={0.05} precision={2} unit="×" />
                </Field>
                <Field label="Default">
                  <NumberInput aria-label={`${label} default`} value={v.default} onChange={(d) => setTuningVar(part.id, setting, { default: d })} min={0.05} max={10} step={0.05} precision={2} unit="×" />
                </Field>
                <Field label="Max">
                  <NumberInput aria-label={`${label} max`} value={v.max} onChange={(max) => setTuningVar(part.id, setting, { max })} min={0.05} max={10} step={0.05} precision={2} unit="×" />
                </Field>
              </div>
            ) : (
              <p className={styles.note}>{hint}</p>
            )}
          </div>
        );
      })}
    </FieldGroup>
  );
}
