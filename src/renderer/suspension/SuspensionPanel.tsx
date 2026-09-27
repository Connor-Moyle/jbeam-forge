import { useEffect, useMemo, useState } from 'react';
import { CarFront, ChevronLeft, Plus, Trash2, Wrench } from 'lucide-react';
import type { SuspensionSet } from '@shared/ipc-contract';
import type { Axle } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { call } from '@renderer/diagnostics/ipc';
import { objectThumbnail } from '@renderer/materials/preview';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Toggle } from '@renderer/ui/components/Toggle';
import { cx } from '@renderer/ui/cx';
import { addAxle, axleKind, fitSuspension, removeAxle, removeSuspension, setTuning, setUpAxles, updateAxle, useSetData, useSuspensionCatalogue, useSuspensionUi } from './commands';
import { tuningVariables } from '@shared/suspension/transplant';
import { Slider } from '@renderer/ui/components/Slider';
import styles from './SuspensionPanel.module.css';

/** A local image file (brand logo) as an object URL. */
function useLocalImage(path: string | null): string | null {
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

/** Suspension workshop: the car's axles, and a complete suspension from the game on each. */
export function SuspensionPanel() {
  const axles = useProjectStore((s) => s.doc?.axles ?? EMPTY_ARR);
  const sets = useSuspensionCatalogue((s) => s.sets);
  const load = useSuspensionCatalogue((s) => s.load);
  const picking = useSuspensionUi((s) => s.axleId);
  useEffect(() => {
    void load();
    const off = window.forge.on('library:changed', () => void load(true));
    return off;
  }, [load]);

  const tuning = useSuspensionUi((s) => s.tuneId);
  const axle = axles.find((a) => a.id === picking);
  if (axle && sets) return <Picker axle={axle} axles={axles} sets={sets} />;
  const tuned = axles.find((a) => a.id === tuning);
  if (tuned?.fitted) return <Tuning axle={tuned} />;
  if (!axles.length) {
    return <EmptyState icon={Wrench} message="Suspension works axle by axle. Set up the car's axles first: front and rear go where its wheels are, and you can add more." action={{ label: 'Set up axles', icon: Plus, onClick: setUpAxles }} />;
  }
  return (
    <div className={styles.panel} data-testid="suspension-panel">
      <ScrollArea className={styles.scroll}>
        {axles.map((a) => (
          <AxleCard key={a.id} axle={a} />
        ))}
        <Button icon={Plus} size="sm" onClick={addAxle} data-testid="axle-add">
          Add axle
        </Button>
        {sets && sets.length === 0 && <p className={styles.note}>No suspensions yet: they come from your BeamNG.drive install. Set its folder in Settings.</p>}
      </ScrollArea>
    </div>
  );
}

function AxleCard({ axle }: { axle: Axle }) {
  return (
    <section className={styles.axle} data-testid="axle-card">
      <header className={styles.axleHead}>
        <strong>{axle.name}</strong>
        <Button icon={Trash2} size="sm" variant="ghost" onClick={() => removeAxle(axle.id)} aria-label={`Remove ${axle.name}`} />
      </header>
      <div className={styles.axleFields}>
        <Field label="Position" hint="Along the car (− is forward)">
          <NumberInput aria-label="Axle position" value={axle.y} onChange={(y) => updateAxle(axle.id, { y })} step={0.01} precision={3} unit="m" />
        </Field>
        <Field label="Track" hint="Wheel centre to centre">
          <NumberInput aria-label="Track width" value={axle.track} onChange={(track) => updateAxle(axle.id, { track })} step={0.01} min={0.3} max={4} precision={3} unit="m" />
        </Field>
        <Toggle checked={axle.steered} onChange={(steered) => updateAxle(axle.id, { steered })} label="Steers" />
      </div>
      {axle.fitted ? (
        <div className={styles.fitted}>
          <div>
            <div className={styles.fittedName}>{axle.fitted.vehicle}</div>
            <div className={styles.note}>
              {axle.fitted.name} · {axle.fitted.type}
            </div>
          </div>
          <div className={styles.row}>
            <Button size="sm" variant="primary" onClick={() => useSuspensionUi.getState().tune(axle.id)} data-testid="axle-tune">
              Tune
            </Button>
            <Button size="sm" onClick={() => useSuspensionUi.getState().pick(axle.id)}>
              Change
            </Button>
            <Button size="sm" variant="ghost" onClick={() => removeSuspension(axle.id)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button icon={Wrench} variant="primary" size="sm" onClick={() => useSuspensionUi.getState().pick(axle.id)} data-testid="axle-choose">
          Choose suspension
        </Button>
      )}
    </section>
  );
}

/** Type → brand → car → the car's suspensions for this axle. */
function Picker({ axle, axles, sets }: { axle: Axle; axles: readonly Axle[]; sets: SuspensionSet[] }) {
  const kind = axleKind(axles, axle);
  const suitable = useMemo(() => sets.filter((s) => s.axle === kind || s.axle === 'any'), [sets, kind]);
  const [type, setType] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = (f: (s: SuspensionSet) => boolean) => suitable.filter(f).length;
  const types = [...new Set(suitable.map((s) => s.type))].sort();
  const ofType = suitable.filter((s) => !type || s.type === type);
  const brands = [...new Map(ofType.map((s) => [s.brand, s])).values()].sort((a, b) => a.brand.localeCompare(b.brand));
  const vehicles = [...new Map(ofType.filter((s) => s.brand === brand).map((s) => [s.vehicle, s])).values()];
  const choices = ofType.filter((s) => s.vehicle === vehicle);
  const back = () => (vehicle ? setVehicle(null) : brand ? setBrand(null) : type ? setType(null) : useSuspensionUi.getState().pick(null));
  const fit = async (s: SuspensionSet) => {
    setBusy(true);
    try {
      await fitSuspension(axle.id, s);
      useSuspensionUi.getState().pick(null);
    } finally {
      setBusy(false);
    }
  };
  const step = vehicle ? 'Suspension' : brand ? 'Car' : type ? 'Brand' : 'Type';
  return (
    <div className={styles.panel} data-testid="suspension-picker">
      <header className={styles.pickerHead}>
        <Button icon={ChevronLeft} size="sm" variant="ghost" onClick={back}>
          Back
        </Button>
        <span className={styles.crumbs}>
          {axle.name} · {[type ?? 'Type', brand, vehicles.find((v) => v.vehicle === vehicle)?.vehicleName].filter(Boolean).join(' › ')}
        </span>
      </header>
      <p className={styles.note}>Choose the {step.toLowerCase()}.</p>
      <ScrollArea className={styles.scroll}>
        {!type && (
          <div className={styles.chips}>
            {types.map((t) => (
              <button key={t} type="button" className={styles.chip} onClick={() => setType(t)} data-testid="suspension-type">
                {t} <span className={styles.count}>{count((s) => s.type === t)}</span>
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
                <button type="button" className={styles.listItem} onClick={() => setVehicle(v.vehicle)} data-testid="suspension-vehicle">
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
                </div>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void fit(s)} data-testid="suspension-fit">
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

function BrandTile({ set, count, onClick }: { set: SuspensionSet; count: number; onClick: () => void }) {
  const logo = useLocalImage(set.logo);
  return (
    <button type="button" className={styles.brand} onClick={onClick} data-testid="suspension-brand">
      <span className={styles.logo}>{logo ? <img src={logo} alt="" /> : <CarFront aria-hidden />}</span>
      <span>{set.brand}</span>
      <span className={styles.count}>{count}</span>
    </button>
  );
}

function SetThumb({ set }: { set: SuspensionSet }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void objectThumbnail({ id: `set:${set.id}`, mesh: set.mesh, material: null }).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [set]);
  return <span className={cx(styles.thumb)}>{src && <img src={src} alt="" />}</span>;
}

/** The fitted suspension's tuning: the variables its jbeam offers, as in the game's tuning menu. */
function Tuning({ axle }: { axle: Axle }) {
  const setId = axle.fitted!.setId;
  const data = useSetData((s) => s.data[setId]);
  useEffect(() => void useSetData.getState().ensure([setId]), [setId]);
  const vars = useMemo(() => (data ? tuningVariables(data.parts) : []), [data]);
  const groups = useMemo(() => [...new Set(vars.map((v) => v.category || 'Other'))], [vars]);
  return (
    <div className={styles.panel} data-testid="suspension-tuning">
      <header className={styles.pickerHead}>
        <Button icon={ChevronLeft} size="sm" variant="ghost" onClick={() => useSuspensionUi.getState().tune(null)}>
          Back
        </Button>
        <span className={styles.crumbs}>
          {axle.name} · {axle.fitted!.vehicle} {axle.fitted!.name}
        </span>
      </header>
      <p className={styles.note}>These become the defaults in your mod, and stay adjustable in the game&rsquo;s tuning menu.</p>
      <ScrollArea className={styles.scroll}>
        {!data && <p className={styles.note}>Reading its jbeam…</p>}
        {data && !vars.length && <p className={styles.note}>This suspension has no tuning settings of its own.</p>}
        {groups.map((g) => (
          <section key={g} className={styles.axle}>
            <strong className={styles.fittedName}>{g}</strong>
            {vars
              .filter((v) => (v.category || 'Other') === g)
              .map((v) => {
                const value = axle.tuning[v.name] ?? v.default;
                const step = v.step ?? (v.max - v.min) / 100;
                const digits = Math.max(0, Math.min(4, -Math.floor(Math.log10(step || 1))));
                return (
                  <Field key={v.name} label={v.title} hint={v.description || undefined}>
                    <div className={styles.tuneRow}>
                      <Slider value={value} onChange={(x) => setTuning(axle.id, v.name, x)} min={v.min} max={v.max} step={step} format={(x) => `${x.toFixed(digits)}${v.unit ? ` ${v.unit}` : ''}`} aria-label={v.title} />
                      {axle.tuning[v.name] !== undefined && (
                        <Button size="sm" variant="ghost" onClick={() => setTuning(axle.id, v.name, null)}>
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
