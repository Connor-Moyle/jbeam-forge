import { startPlacing } from '@renderer/scene/placeFitted';
import { useEffect, useMemo } from 'react';
import { Move, Plus, Trash2, Wrench } from 'lucide-react';
import type { Axle } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Toggle } from '@renderer/ui/components/Toggle';
import { SetPicker, TuningView } from '@renderer/workshop/WorkshopUi';
import { addAxle, axleKind, fitSuspension, removeAxle, removeSuspension, setSuspensionChoices, setTuning, setUpAxles, updateAxle, showGameMeshes, showOwnMeshes, useSuspensionCatalogue, useSuspensionUi } from './commands';
import { DrivelineView } from './DrivelineView';
import styles from '@renderer/workshop/Workshop.module.css';

/** Suspension workshop: the car's axles, and a complete suspension from the game on each. */
export function SuspensionPanel() {
  const axles = useProjectStore((s) => s.doc?.axles ?? EMPTY_ARR);
  const sets = useSuspensionCatalogue((s) => s.sets);
  const load = useSuspensionCatalogue((s) => s.load);
  const picking = useSuspensionUi((s) => s.axleId);
  const tuning = useSuspensionUi((s) => s.tuneId);
  const driving = useSuspensionUi((s) => s.driveId);
  useEffect(() => {
    void load();
    const off = window.forge.on('library:changed', () => void load(true));
    return off;
  }, [load]);

  const axle = axles.find((a) => a.id === picking);
  const suitable = useMemo(() => {
    if (!axle || !sets) return [];
    const kind = axleKind(axles, axle);
    return sets.filter((s) => s.axle === kind || s.axle === 'any');
  }, [axle, axles, sets]);
  if (axle && sets) {
    return (
      <SetPicker
        title={axle.name}
        sets={suitable}
        testId="suspension-picker"
        onBack={() => useSuspensionUi.getState().pick(null)}
        onFit={async (s) => {
          await fitSuspension(axle.id, s);
          useSuspensionUi.getState().pick(null);
        }}
      />
    );
  }
  const driven = axles.find((a) => a.id === driving);
  if (driven?.fitted) return <DrivelineView axle={{ ...driven, fitted: driven.fitted }} />;
  const tuned = axles.find((a) => a.id === tuning);
  if (tuned?.fitted) {
    return <TuningView title={`${tuned.name} · ${tuned.fitted.vehicle} ${tuned.fitted.name}`} setId={tuned.fitted.setId} tuning={tuned.tuning} onChange={(name, v) => setTuning(tuned.id, name, v)} onBack={() => useSuspensionUi.getState().tune(null)} choices={tuned.fitted.choices} onChoices={(c) => setSuspensionChoices(tuned.id, c)} />;
  }
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
  const selection = useSceneStore((s) => s.selection);
  const own = axle.ownMeshes.length;
  return (
    <section className={styles.card} data-testid="axle-card">
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
        <>
          <div className={styles.fitted}>
            <div>
              <div className={styles.cardTitle}>{axle.fitted.vehicle}</div>
              <div className={styles.note}>
                {axle.fitted.name} · {axle.fitted.type}
                {own ? ` · showing your ${own} mesh${own === 1 ? '' : 'es'}` : ''}
              </div>
            </div>
            <div className={styles.row}>
              <Button size="sm" variant="primary" onClick={() => useSuspensionUi.getState().tune(axle.id)} data-testid="axle-tune">
                Tune
              </Button>
              <Button size="sm" onClick={() => useSuspensionUi.getState().drive(axle.id)} data-testid="axle-driveline">
                Differential
              </Button>
              <Button size="sm" icon={Move} onClick={() => startPlacing(axle.fitted!.sourceId, 'suspension')} title="Pick it up with the arrows: its physics moves with it" data-testid="axle-move">
                Move
              </Button>
              <Button size="sm" onClick={() => useSuspensionUi.getState().pick(axle.id)}>
                Change
              </Button>
              <Button size="sm" variant="ghost" onClick={() => removeSuspension(axle.id)}>
                Remove
              </Button>
            </div>
          </div>
          <div className={styles.row}>
            {own ? (
              <Button size="sm" variant="ghost" onClick={() => showGameMeshes(axle.id)}>
                Use the game&rsquo;s meshes
              </Button>
            ) : (
              <Button size="sm" onClick={() => showOwnMeshes(axle.id, selection)} disabled={!selection.length} data-testid="axle-own-meshes">
                Use my selected meshes
              </Button>
            )}
          </div>
          {!own && <p className={styles.note}>Made your own suspension? Select its meshes and use them: this set&rsquo;s jbeam does the physics, your meshes are what you see.</p>}
        </>
      ) : (
        <Button icon={Wrench} variant="primary" size="sm" onClick={() => useSuspensionUi.getState().pick(axle.id)} data-testid="axle-choose">
          Choose suspension
        </Button>
      )}
    </section>
  );
}
