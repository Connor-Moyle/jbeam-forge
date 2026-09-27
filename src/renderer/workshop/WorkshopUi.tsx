import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CarFront, ChevronLeft } from 'lucide-react';
import type { SuspensionSet } from '@shared/ipc-contract';
import { tuningVariables } from '@shared/suspension/transplant';
import { call } from '@renderer/diagnostics/ipc';
import { objectThumbnail } from '@renderer/materials/preview';
import { useSetData } from '@renderer/suspension/commands';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Slider } from '@renderer/ui/components/Slider';
import styles from './Workshop.module.css';

/**
 * The pieces every workshop (suspension, engine, gearbox) shares: a Type →
 * Brand → Car picker over sets cut from the game, brand logos, previews, and
 * a tuning page over a set's jbeam variables.
 */

/** A local image file (brand logo) as an object URL. */
export function useLocalImage(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let made: string | null = null;
    void call('import:readFile', { path })
      .then((bytes) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }));
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url;
}

export function BrandTile({ set, count, onClick }: { set: SuspensionSet; count: number; onClick: () => void }) {
  const logo = useLocalImage(set.logo);
  return (
    <button type="button" className={styles.brand} onClick={onClick} data-testid="workshop-brand">
      <span className={styles.logo}>{logo ? <img src={logo} alt="" /> : <CarFront aria-hidden />}</span>
      <span>{set.brand}</span>
      <span className={styles.count}>{count}</span>
    </button>
  );
}

export function SetThumb({ set }: { set: SuspensionSet }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void objectThumbnail({ id: `set:${set.id}`, mesh: set.mesh, material: null }).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [set]);
  return <span className={styles.thumb}>{src && <img src={src} alt="" />}</span>;
}

/** Type → brand → car → that car's sets; `details` adds a spec line or chart per set. */
export function SetPicker({ title, sets, onBack, onFit, details, testId }: { title: string; sets: readonly SuspensionSet[]; onBack: () => void; onFit: (s: SuspensionSet) => Promise<void>; details?: (s: SuspensionSet) => ReactNode; testId: string }) {
  const [type, setType] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const types = useMemo(() => [...new Set(sets.map((s) => s.type))].sort(), [sets]);
  const ofType = sets.filter((s) => !type || s.type === type);
  const brands = [...new Map(ofType.map((s) => [s.brand, s])).values()].sort((a, b) => a.brand.localeCompare(b.brand));
  const vehicles = [...new Map(ofType.filter((s) => s.brand === brand).map((s) => [s.vehicle, s])).values()];
  const choices = ofType.filter((s) => s.vehicle === vehicle);
  const back = () => (vehicle ? setVehicle(null) : brand ? setBrand(null) : type ? setType(null) : onBack());
  const step = vehicle ? 'one to fit' : brand ? 'car' : type ? 'brand' : 'type';
  const fit = async (s: SuspensionSet) => {
    setBusy(true);
    try {
      await onFit(s);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.panel} data-testid={testId}>
      <header className={styles.head}>
        <Button icon={ChevronLeft} size="sm" variant="ghost" onClick={back}>
          Back
        </Button>
        <span className={styles.crumbs}>
          {title} · {[type ?? 'Type', brand, vehicles.find((v) => v.vehicle === vehicle)?.vehicleName].filter(Boolean).join(' › ')}
        </span>
      </header>
      <p className={styles.note}>Choose the {step}.</p>
      <ScrollArea className={styles.scroll}>
        {!type && (
          <div className={styles.chips}>
            {types.map((t) => (
              <button key={t} type="button" className={styles.chip} onClick={() => setType(t)} data-testid="workshop-type">
                {t} <span className={styles.count}>{sets.filter((s) => s.type === t).length}</span>
              </button>
            ))}
          </div>
        )}
        {type && !brand && (
          <div className={styles.brands}>
            {brands.map((b) => (
              <BrandTile key={b.brand} set={b} count={ofType.filter((s) => s.brand === b.brand).length} onClick={() => setBrand(b.brand)} />
            ))}
          </div>
        )}
        {brand && !vehicle && (
          <ul className={styles.list}>
            {vehicles.map((v) => (
              <li key={v.vehicle}>
                <button type="button" className={styles.listItem} onClick={() => setVehicle(v.vehicle)} data-testid="workshop-vehicle">
                  <CarFront aria-hidden className={styles.icon} />
                  {v.vehicleName}
                  <span className={styles.count}>{ofType.filter((s) => s.vehicle === v.vehicle).length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {vehicle && (
          <ul className={styles.sets}>
            {choices.map((s) => (
              <li key={s.id} className={styles.setCard}>
                <SetThumb set={s} />
                <div className={styles.setText}>
                  <strong>{s.name}</strong>
                  <span className={styles.note}>
                    {s.type} · {s.parts.length} parts
                  </span>
                  {details?.(s)}
                </div>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void fit(s)} data-testid="workshop-fit">
                  Fit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

/** A fitted set's tuning variables as sliders; values become the jbeam defaults on export. */
export function TuningView({ title, setId, tuning, onChange, onBack }: { title: string; setId: string; tuning: Readonly<Record<string, number>>; onChange: (name: string, value: number | null) => void; onBack: () => void }) {
  const data = useSetData((s) => s.data[setId]);
  useEffect(() => void useSetData.getState().ensure([setId]), [setId]);
  const vars = useMemo(() => (data ? tuningVariables(data.parts) : []), [data]);
  const groups = useMemo(() => [...new Set(vars.map((v) => v.category || 'Other'))], [vars]);
  return (
    <div className={styles.panel} data-testid="workshop-tuning">
      <header className={styles.head}>
        <Button icon={ChevronLeft} size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <span className={styles.crumbs}>{title}</span>
      </header>
      <p className={styles.note}>These become the defaults in your mod, and stay adjustable in the game&rsquo;s tuning menu.</p>
      <ScrollArea className={styles.scroll}>
        {!data && <p className={styles.note}>Reading its jbeam…</p>}
        {data && !vars.length && <p className={styles.note}>This one has no tuning settings of its own.</p>}
        {groups.map((g) => (
          <section key={g} className={styles.card}>
            <strong className={styles.cardTitle}>{g}</strong>
            {vars
              .filter((v) => (v.category || 'Other') === g)
              .map((v) => {
                const value = tuning[v.name] ?? v.default;
                const step = v.step ?? (v.max - v.min) / 100;
                const digits = Math.max(0, Math.min(4, -Math.floor(Math.log10(step || 1))));
                return (
                  <Field key={v.name} label={v.title} hint={v.description || undefined}>
                    <div className={styles.tuneRow}>
                      <Slider value={value} onChange={(x) => onChange(v.name, x)} min={v.min} max={v.max} step={step} format={(x) => `${x.toFixed(digits)}${v.unit ? ` ${v.unit}` : ''}`} aria-label={v.title} />
                      {tuning[v.name] !== undefined && (
                        <Button size="sm" variant="ghost" onClick={() => onChange(v.name, null)}>
                          Reset
                        </Button>
                      )}
                    </div>
                  </Field>
                );
              })}
          </section>
        ))}
      </ScrollArea>
    </div>
  );
}
