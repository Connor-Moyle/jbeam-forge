import { useEffect, useState } from 'react';
import { ArrowDownToLine, Ruler, Square } from 'lucide-react';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Slider } from '@renderer/ui/components/Slider';
import { playDrop, poseRide, runRideCheck, stopRide, useRideCheck } from '@renderer/sim/rideCheck';
import styles from '@renderer/workshop/Workshop.module.css';

const mm = (m: number) => `${Math.round(m * 1000)} mm`;

/**
 * The quick suspension check: drop the car onto its wheels, or push the body
 * down by hand, and see whether the tyres clear the arches and the lowest
 * part clears the ground at full compression.
 */
export function RideCheck() {
  const travel = useRideCheck((s) => s.travel);
  const report = useRideCheck((s) => s.report);
  const split = useRideCheck((s) => s.split);
  const playing = useRideCheck((s) => s.playing);
  const [pose, setPose] = useState(0);
  // Let go of any pose when leaving.
  useEffect(() => () => stopRide(), []);

  const check = () => {
    const doc = projectStore.getState().doc;
    if (doc) runRideCheck(doc, travel);
  };
  const drop = () => {
    check();
    playDrop(travel);
  };
  const noWheels = split !== null && split.corners.length === 0;
  const worst = report?.gaps.reduce((a, b) => (b.distance < a.distance ? b : a), report.gaps[0]!);
  // As the Scene tree names it (the mod's own name first); never the internal key.
  const names = useProjectStore((s) => s.doc?.meshNames);
  const nameOf = (key: string | null) => (key ? (names?.[key]?.name ?? useSceneStore.getState().sources[key.slice(0, key.indexOf(':'))]?.meshes.find((m) => m.key === key)?.name ?? key.slice(key.indexOf(':') + 1)) : '—');

  return (
    <FieldGroup title="Suspension check">
      <p className={`${styles.note} ${styles.spaced}`}>Drop the car on its wheels, or push the body down, to see that the tyres clear the arches and nothing hits the ground at full compression. A quick visual check, not the game&rsquo;s physics.</p>
      <Field label="Travel to the bump stop" hint="How far the wheels can go up into the body from where the car sits.">
        <NumberInput value={travel * 1000} onChange={(v) => useRideCheck.getState().set({ travel: v / 1000, report: null })} min={20} max={300} step={5} precision={0} unit="mm" aria-label="Suspension travel" />
      </Field>
      <div className={`${styles.row} ${styles.spaced}`}>
        <Button size="sm" variant="primary" icon={ArrowDownToLine} onClick={drop} disabled={playing} data-testid="ride-drop">
          Drop it
        </Button>
        <Button size="sm" icon={Ruler} onClick={check} data-testid="ride-measure">
          Measure at full bump
        </Button>
        {playing && (
          <Button size="sm" variant="ghost" icon={Square} onClick={stopRide}>
            Stop
          </Button>
        )}
      </div>
      <Field label="Push the body down">
        <Slider
          value={pose}
          onChange={(v) => {
            setPose(v);
            if (!split) check();
            poseRide(v > 0 ? v / 1000 : null);
          }}
          min={0}
          max={travel * 1000}
          step={1}
          format={(v) => `${Math.round(v)} mm`}
          aria-label="Push the body down"
        />
      </Field>
      {noWheels && <p className={styles.note}>No wheels found: sort the tyres and rims into Wheel and Tire parts, or fit a suspension to each axle.</p>}
      {report && (
        <ul className={styles.rideList} data-testid="ride-report">
          {report.gaps.map((g) => (
            <li key={g.corner}>
              {g.atRest < 0.001 ? (
                <Badge tone="warning">in the body</Badge>
              ) : (
                <Badge tone={g.distance < 0.003 ? 'danger' : g.distance < 0.015 ? 'warning' : 'success'}>{g.distance === Infinity ? 'clear' : g.distance < 0.001 ? 'touches' : mm(g.distance)}</Badge>
              )}{' '}
              {g.corner}
              {g.atRest < 0.001 ? (
                <span className={styles.note}> already overlaps {nameOf(g.meshKey)} as modelled (a closed body shell around the wheels?): cut the arches, or check it by eye</span>
              ) : (
                Number.isFinite(g.distance) && <span className={styles.note}> at full bump, from {nameOf(g.meshKey)} ({mm(g.atRest)} at rest)</span>
              )}
            </li>
          ))}
          {Number.isFinite(report.ground.atRest) && (
            <li>
              <Badge tone={report.ground.atBump < 0 ? 'danger' : report.ground.atBump < 0.03 ? 'warning' : 'success'}>{report.ground.atBump < 0 ? 'hits the ground' : mm(report.ground.atBump)}</Badge> Ground clearance at full bump ({mm(report.ground.atRest)} at rest)
              <span className={styles.note}> lowest: {nameOf(report.ground.meshKey)}</span>
            </li>
          )}
          {worst && worst.distance < 0.003 && worst.atRest >= 0.001 && <li className={styles.note}>At full bump a tyre meets the body: raise the arch, lower the travel, or move the wheels.</li>}
        </ul>
      )}
    </FieldGroup>
  );
}
