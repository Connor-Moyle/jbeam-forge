import { useState } from 'react';
import { Activity } from 'lucide-react';
import type { Axle } from '@shared/project/schema';
import { sweepSummary, sweepSuspension, type SweepResult } from '@shared/suspension/sweep';
import { Button } from '@renderer/ui/components/Button';
import { useSetData } from './commands';
import styles from '@renderer/workshop/Workshop.module.css';

/**
 * A fitted suspension worked through its travel on a rig: how far each wheel moves for a load, and
 * what its camber and toe do on the way. Bump steer shows as toe that changes with travel.
 */
export function TravelCheck({ axle }: { axle: Axle & { fitted: NonNullable<Axle['fitted']> } }) {
  const [result, setResult] = useState<SweepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await useSetData.getState().ensure([axle.fitted.setId]);
      const data = useSetData.getState().data[axle.fitted.setId];
      // Off the click, so the button shows it is working.
      await new Promise((r) => setTimeout(r, 30));
      setResult(data ? sweepSuspension(data.parts, data.anchors, axle.tuning) : { wheels: [], problem: 'This suspension’s jbeam could not be read.' });
    } finally {
      setBusy(false);
    }
  };
  const summary = result ? sweepSummary(result) : null;
  const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}°`;
  return (
    <div data-testid="travel-check">
      <div className={styles.row}>
        <Button size="sm" icon={Activity} onClick={() => void run()} disabled={busy} title="Works the suspension up and down on a rig and reads off its camber and toe" data-testid="travel-run">
          {busy ? 'Working…' : result ? 'Work its travel again' : 'Travel, camber and toe'}
        </Button>
        {result && (
          <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
            Hide
          </Button>
        )}
      </div>
      {result?.problem && <p className={styles.note}>{result.problem}</p>}
      {summary && (
        <p className={styles.note} data-testid="travel-summary">
          Over {summary.travel} mm of travel the camber changes by {summary.camberChange.toFixed(2)}° and the toe by {summary.toeChange.toFixed(2)}°.
          {summary.toeChange > 1 ? ' That much toe change is bump steer you will feel: the tie rod doesn’t follow the arms.' : ''}
          {' Steering held straight, each wheel on its own, with the tuning set here.'}
        </p>
      )}
      {result?.wheels.map((w) => (
        <table key={w.wheel} className={styles.note} data-testid="travel-table">
          <thead>
            <tr>
              <th align="left">{w.wheel}: load</th>
              <th align="right">travel</th>
              <th align="right">camber</th>
              <th align="right">toe-in</th>
            </tr>
          </thead>
          <tbody>
            {w.points.map((p) => (
              <tr key={p.load}>
                <td>{p.load < 0 ? `hanging (${p.load} N)` : `${p.load} N`}</td>
                <td align="right">{p.travel} mm</td>
                <td align="right">{signed(p.camber)}</td>
                <td align="right">{signed(p.toeIn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
