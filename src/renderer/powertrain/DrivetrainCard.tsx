import { useEffect, useMemo } from 'react';
import { Waypoints } from 'lucide-react';
import { CENTRE_DIFFS, DEFAULT_DRIVETRAIN, DRIVE_LAYOUTS, planDrivetrain, type DrivetrainSettings } from '@shared/powertrain/drivetrain';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSetData } from '@renderer/suspension/commands';
import { Callout } from '@renderer/ui/components/Callout';
import { Field } from '@renderer/ui/components/Field';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import styles from '@renderer/workshop/Workshop.module.css';
import { setDrivetrain } from './commands';

/**
 * Drive shafts: which axles the gearbox drives and how. The fitted axles
 * come from the game's cars with their own differentials; the export adds
 * the shafts (and a centre differential for all-wheel drive) that join them
 * to this gearbox.
 */
export function DrivetrainCard() {
  const doc = useProjectStore((s) => s.doc);
  const data = useSetData((s) => s.data);
  const pt = doc?.powertrain;
  const axles = useProjectStore((s) => s.doc?.axles ?? EMPTY_ARR);
  const ids = useMemo(() => [...axles.flatMap((a) => (a.fitted ? [a.fitted.setId] : [])), ...(pt?.engine ? [pt.engine.setId] : []), ...(pt?.gearbox ? [pt.gearbox.setId] : [])], [axles, pt]);
  useEffect(() => {
    void useSetData.getState().ensure(ids);
  }, [ids]);
  const settings: DrivetrainSettings = pt?.drivetrain ?? DEFAULT_DRIVETRAIN;
  const plan = useMemo(() => {
    const fitted = axles.flatMap((a, index) => {
      const set = a.fitted ? data[a.fitted.setId] : undefined;
      return set ? [{ index, name: a.name, y: a.y, parts: set.parts }] : [];
    });
    if (!fitted.length) return null;
    const engine = pt?.engine ? (data[pt.engine.setId]?.parts ?? null) : null;
    const gearbox = pt?.gearbox ? (data[pt.gearbox.setId]?.parts ?? null) : null;
    return planDrivetrain({ engine, gearbox, axles: fitted }, settings);
  }, [axles, data, pt, settings]);

  if (!pt?.engine && !pt?.gearbox) return null;
  const awd = plan ? plan.axles.filter((a) => a.driven).length > 1 : settings.layout === 'awd';
  return (
    <section className={styles.card} data-testid="drivetrain-card">
      <header className={styles.axleHead}>
        <strong>
          <Waypoints aria-hidden className={styles.icon} /> Drive shafts
        </strong>
      </header>
      <Field label="Driven wheels">
        <Select value={settings.layout} onChange={(layout) => setDrivetrain({ layout: layout })} options={DRIVE_LAYOUTS.map((l) => ({ value: l.value, label: l.label }))} aria-label="Driven wheels" data-testid="drive-layout" />
      </Field>
      {awd && (
        <>
          <Field label="Front share" hint="Torque to the front axle through the centre differential">
            <Slider value={settings.frontShare} onChange={(frontShare) => setDrivetrain({ frontShare })} min={0.1} max={0.9} step={0.05} format={(x) => `${Math.round(x * 100)} / ${Math.round((1 - x) * 100)}`} aria-label="Front torque share" />
          </Field>
          <Field label="Centre differential">
            <Select value={settings.centre} onChange={(centre) => setDrivetrain({ centre: centre })} options={CENTRE_DIFFS.map((c) => ({ value: c.value, label: c.label }))} aria-label="Centre differential" />
          </Field>
        </>
      )}
      {plan ? (
        <ul className={styles.chain} data-testid="drive-chain">
          {plan.axles.map((a) => (
            <li key={a.index} className={a.driven ? styles.driven : styles.note}>
              <strong>{a.name}</strong>: {a.driven ? `driven, through ${a.via}` : a.via}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>Fit suspensions to the axles to see how the gearbox reaches them.</p>
      )}
      {plan?.problems.map((p) => (
        <Callout key={p} tone="warning">
          {p}
        </Callout>
      ))}
    </section>
  );
}
