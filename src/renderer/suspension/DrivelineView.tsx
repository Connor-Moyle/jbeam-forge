import { useEffect, useMemo } from 'react';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import { DIFF_SETTINGS, DIFF_TYPES, differentials, settingValue, WHEEL_SETTINGS, wheelSettings } from '@shared/powertrain/driveline';
import type { Axle } from '@shared/project/schema';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { resetDriveline, setDrivelineValue, useSetData, useSuspensionUi } from './commands';
import styles from '@renderer/workshop/Workshop.module.css';

/**
 * The driveline builder for one axle: each differential its fitted
 * suspension brings (the game's own), with its type, final drive and
 * locking. Numbers the game ties to a tuning variable stay on the tuning page.
 */
export function DrivelineView({ axle }: { axle: Axle & { fitted: NonNullable<Axle['fitted']> } }) {
  const data = useSetData((s) => s.data[axle.fitted.setId]);
  useEffect(() => void useSetData.getState().ensure([axle.fitted.setId]), [axle.fitted.setId]);
  const diffs = useMemo(() => (data ? differentials(data.parts) : []), [data]);
  const wheels = useMemo(() => (data ? wheelSettings(data.parts) : []), [data]);
  const edited = !!axle.edits && (Object.keys(axle.edits.fields).length > 0 || Object.keys(axle.edits.texts ?? {}).length > 0);
  return (
    <div className={styles.panel} data-testid="driveline-view">
      <header className={styles.head}>
        <Button icon={ChevronLeft} size="sm" variant="ghost" onClick={() => useSuspensionUi.getState().drive(null)}>
          Back
        </Button>
        <span className={styles.crumbs}>
          {axle.name} · differentials and brakes
        </span>
        {edited && (
          <Button icon={RotateCcw} size="sm" variant="ghost" onClick={() => resetDriveline(axle.id)}>
            Game&rsquo;s values
          </Button>
        )}
      </header>
      <ScrollArea className={styles.scroll}>
        {!data && <p className={styles.note}>Reading its jbeam…</p>}
        {wheels.length > 0 && (
          <section className={styles.card} data-testid="axle-brakes">
            <strong className={styles.cardTitle}>Brakes and wheels</strong>
            <span className={styles.note}>Set on every wheel of this axle.</span>
            {WHEEL_SETTINGS.map((s) => {
              const w = wheels.find((x) => x.name === s.name);
              if (!w) return null;
              const edited = axle.edits?.fields[w.key];
              return (
                <Field key={s.name} label={s.label} hint={s.hint}>
                  <div className={styles.tuneRow}>
                    <NumberInput value={edited ?? w.value} onChange={(v) => setDrivelineValue(axle.id, w.key, v)} min={s.min} max={s.max} step={s.step} precision={s.step < 0.1 ? 2 : s.step < 1 ? 1 : 0} unit={s.unit} aria-label={s.label} />
                    {edited !== undefined && (
                      <Button size="sm" variant="ghost" onClick={() => setDrivelineValue(axle.id, w.key, null)}>
                        Reset
                      </Button>
                    )}
                  </div>
                </Field>
              );
            })}
          </section>
        )}
        {data && !diffs.length && <p className={styles.note}>This suspension has no differential of its own (it isn&rsquo;t driven, or its differential comes with the gearbox).</p>}
        {diffs.map((d) => {
          const type = axle.edits?.texts?.[d.diffType.key] ?? d.diffType.value ?? 'open';
          return (
            <section key={`${d.part}/${d.device}`} className={styles.card}>
              <strong className={styles.cardTitle}>{d.device}</strong>
              <span className={styles.note}>{d.part}</span>
              {d.kind === 'differential' && (
                <Field label="Type" hint="Open lets the wheels turn freely; LSD and viscous lock partly; locked drives both the same">
                  <Select value={type} onChange={(v) => setDrivelineValue(axle.id, d.diffType.key, v === (d.diffType.value ?? 'open') ? null : v)} options={DIFF_TYPES.map((t) => ({ value: t.value, label: t.label }))} aria-label={`${d.device} type`} />
                </Field>
              )}
              {DIFF_SETTINGS.filter((s) => !s.types || s.types.includes(type)).map((s) => {
                const setting = d.settings.find((x) => x.name === s.name)!;
                const value = settingValue(setting, axle.edits);
                if (typeof setting.value === 'string' && axle.edits?.fields[setting.key] === undefined) {
                  return (
                    <Field key={s.name} label={s.label} hint={s.hint}>
                      <span className={styles.note}>Set on the tuning page ({setting.value}).</span>
                    </Field>
                  );
                }
                if (value === null && !s.types?.includes(type)) return null;
                return (
                  <Field key={s.name} label={s.label} hint={s.hint}>
                    <div className={styles.tuneRow}>
                      <NumberInput value={value ?? 0} onChange={(v) => setDrivelineValue(axle.id, setting.key, v)} min={s.min} max={s.max} step={s.step} precision={s.step < 0.1 ? 2 : s.step < 1 ? 1 : 0} unit={s.unit} aria-label={`${d.device} ${s.label}`} />
                      {axle.edits?.fields[setting.key] !== undefined && (
                        <Button size="sm" variant="ghost" onClick={() => setDrivelineValue(axle.id, setting.key, null)}>
                          Reset
                        </Button>
                      )}
                    </div>
                  </Field>
                );
              })}
            </section>
          );
        })}
      </ScrollArea>
    </div>
  );
}
