import { useEffect } from 'react';
import { Cog, Gauge } from 'lucide-react';
import type { SuspensionSet } from '@shared/ipc-contract';
import type { FittedSet } from '@shared/project/schema';
import type { EngineSpecs } from '@shared/powertrain/specs';
import { useProjectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { SetPicker, TuningView } from '@renderer/workshop/WorkshopUi';
import { addEngineOption, fitPowertrain, makeDefaultEngine, removeEngineOption, removePowertrain, setPowertrainChoices, setPowertrainTuning, usePowertrainCatalogue, usePowertrainUi, type PowertrainKind } from './commands';
import { useUnits } from '@renderer/settings/useUnits';
import styles from '@renderer/workshop/Workshop.module.css';
import { EngineBuilder, GearboxBuilder } from './Builder';
import { DrivetrainCard } from './DrivetrainCard';

const LABEL: Record<PowertrainKind, string> = { engine: 'Engine', gearbox: 'Gearbox' };

/** Engine and gearbox workshop: complete engines and gearboxes from the game's cars. */
export function PowertrainPanel() {
  const sets = usePowertrainCatalogue((s) => s.sets);
  const load = usePowertrainCatalogue((s) => s.load);
  const view = usePowertrainUi((s) => s.view);
  const powertrain = useProjectStore((s) => s.doc?.powertrain);
  useEffect(() => {
    void load();
    const off = window.forge.on('library:changed', () => void load(true));
    return off;
  }, [load]);

  if (view && sets && view.page === 'option') {
    return (
      <SetPicker
        title="Another engine"
        sets={sets.filter((s) => s.kind === 'engine')}
        testId="engine-option-picker"
        onBack={() => usePowertrainUi.getState().show(null)}
        details={(s) => <EngineLine set={s} />}
        onFit={async (s) => {
          await addEngineOption(s);
          usePowertrainUi.getState().show(null);
        }}
      />
    );
  }
  if (view && sets && view.page === 'pick') {
    return (
      <SetPicker
        title={LABEL[view.kind]}
        sets={sets.filter((s) => s.kind === view.kind)}
        testId={`${view.kind}-picker`}
        onBack={() => usePowertrainUi.getState().show(null)}
        details={(s) => (view.kind === 'engine' ? <EngineLine set={s} /> : <GearboxLine set={s} />)}
        onFit={async (s) => {
          await fitPowertrain(view.kind, s);
          usePowertrainUi.getState().show(null);
        }}
      />
    );
  }
  if (view?.page === 'build' && powertrain?.[view.kind]) return view.kind === 'engine' ? <EngineBuilder /> : <GearboxBuilder />;
  const tuned = view?.page === 'tune' ? powertrain?.[view.kind] : null;
  if (view && tuned) {
    return <TuningView title={`${LABEL[view.kind]} · ${tuned.vehicle} ${tuned.name}`} setId={tuned.setId} tuning={tuned.tuning} onChange={(name, v) => setPowertrainTuning(view.kind, name, v)} onBack={() => usePowertrainUi.getState().show(null)} choices={tuned.choices} onChoices={(c) => setPowertrainChoices(view.kind, c)} />;
  }
  return (
    <div className={styles.panel} data-testid="powertrain-panel">
      <ScrollArea className={styles.scroll}>
        <Card kind="engine" fitted={powertrain?.engine ?? null} />
        {powertrain?.engine && <EngineOptions alternates={powertrain.alternates ?? []} />}
        <Card kind="gearbox" fitted={powertrain?.gearbox ?? null} />
        <DrivetrainCard />
        {sets && sets.length === 0 && <p className={styles.note}>No engines or gearboxes yet: they come from your BeamNG.drive install. Set its folder in Settings.</p>}
        <p className={styles.note}>The gearbox bolts to the engine&rsquo;s transmission slot, so pick one that suits the engine&rsquo;s drive layout. Differentials come with the suspension on each axle; Drive shafts joins them to the gearbox.</p>
      </ScrollArea>
    </div>
  );
}

function Card({ kind, fitted }: { kind: PowertrainKind; fitted: FittedSet | null }) {
  const Icon = kind === 'engine' ? Gauge : Cog;
  const set = usePowertrainCatalogue((s) => s.sets?.find((x) => x.id === fitted?.setId));
  return (
    <section className={styles.card} data-testid={`${kind}-card`}>
      <header className={styles.axleHead}>
        <strong>
          <Icon aria-hidden className={styles.icon} /> {LABEL[kind]}
        </strong>
      </header>
      {fitted ? (
        <div className={styles.fitted}>
          <div>
            <div className={styles.cardTitle}>{fitted.vehicle}</div>
            <div className={styles.note}>
              {fitted.name} · {fitted.type}
            </div>
            {set && (kind === 'engine' ? <EngineLine set={set} /> : <GearboxLine set={set} />)}
            {Object.keys(fitted.edits.fields).length + (fitted.edits.torque ? 1 : 0) + (fitted.edits.gearRatios ? 1 : 0) > 0 && <span className={styles.spec}>Changed in the builder: the figures above are the game&rsquo;s.</span>}
          </div>
          <div className={styles.row}>
            <Button size="sm" variant="primary" onClick={() => usePowertrainUi.getState().show({ kind, page: 'build' })} data-testid={`${kind}-build`}>
              Build
            </Button>
            <Button size="sm" onClick={() => usePowertrainUi.getState().show({ kind, page: 'tune' })} data-testid={`${kind}-tune`}>
              Tune
            </Button>
            <Button size="sm" onClick={() => usePowertrainUi.getState().show({ kind, page: 'pick' })}>
              Change
            </Button>
            <Button size="sm" variant="ghost" onClick={() => removePowertrain(kind)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button icon={Icon} variant="primary" size="sm" onClick={() => usePowertrainUi.getState().show({ kind, page: 'pick' })} data-testid={`${kind}-choose`}>
          Choose {kind}
        </Button>
      )}
    </section>
  );
}

/** The car's other engines: each configuration (and the player) picks one; the card above is the default. */
function EngineOptions({ alternates }: { alternates: readonly FittedSet[] }) {
  return (
    <section className={styles.card} data-testid="engine-options">
      <strong className={styles.cardTitle}>More engines</strong>
      <p className={styles.note}>Ship several engines: they share the engine slot, so the game&rsquo;s parts menu offers them and each configuration picks one (Configurations panel). The one above is the default.</p>
      {alternates.map((a) => (
        <div key={a.sourceId} className={styles.fitted}>
          <div>
            <div className={styles.cardTitle}>{a.vehicle}</div>
            <div className={styles.note}>
              {a.name} · {a.type}
            </div>
          </div>
          <div className={styles.row}>
            <Button size="sm" onClick={() => makeDefaultEngine(a.sourceId)} title="Swap it with the default engine (to build or tune it)">
              Make default
            </Button>
            <Button size="sm" variant="ghost" onClick={() => removeEngineOption(a.sourceId)}>
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" onClick={() => usePowertrainUi.getState().show({ kind: 'engine', page: 'option' })} data-testid="engine-add-option">
        Add another engine
      </Button>
    </section>
  );
}

function EngineLine({ set }: { set: SuspensionSet }) {
  const units = useUnits();
  const e = set.engine;
  if (!e) return null;
  const bits = [
    e.peakPower && `${units.power(e.peakPower.kw)} @ ${Math.round(e.peakPower.rpm)}`,
    e.peakTorque && `${units.torque(e.peakTorque.nm)} @ ${Math.round(e.peakTorque.rpm)}`,
    e.displacementL && `${e.displacementL} L`,
    e.fuel !== 'petrol' && e.fuel,
    e.forcedInduction,
    e.maxRPM && `${Math.round(e.maxRPM)} rpm limit`,
  ].filter(Boolean);
  return (
    <>
      <span className={styles.spec}>{bits.join(' · ')}</span>
      <Dyno e={e} />
    </>
  );
}

/** A small dyno chart: torque (accent) and power (warning), up to the rev limit. */
function Dyno({ e }: { e: EngineSpecs }) {
  const limit = e.maxRPM ?? Math.max(...e.torqueCurve.map(([r]) => r), 1);
  const pts = e.torqueCurve.filter(([r]) => r <= limit);
  if (pts.length < 2) return null;
  const maxNm = Math.max(...pts.map(([, t]) => t), 1);
  const maxKw = Math.max(...pts.map(([r, t]) => (t * r * 2 * Math.PI) / 60000), 1);
  const x = (r: number) => (r / limit) * 100;
  const line = (f: (r: number, t: number) => number) => pts.map(([r, t]) => `${x(r).toFixed(1)},${(30 - f(r, t) * 28).toFixed(1)}`).join(' ');
  return (
    <svg className={styles.dyno} viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Torque and power curve">
      <polyline className={styles.dynoTorque} points={line((_r, t) => t / maxNm)} vectorEffect="non-scaling-stroke" />
      <polyline className={styles.dynoPower} points={line((r, t) => (t * r * 2 * Math.PI) / 60000 / maxKw)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function GearboxLine({ set }: { set: SuspensionSet }) {
  const g = set.gearbox;
  if (!g) return null;
  const forward = g.ratios.filter((r) => r > 0);
  return <span className={styles.spec}>{[`${g.gears}-speed ${g.kind.toLowerCase()}`, forward.length ? forward.map((r) => r.toFixed(2)).join(' · ') : null].filter(Boolean).join(' · ')}</span>;
}
