import { useState } from 'react';
import { FlaskConical, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { brokenByPart, dragNode, pause, reset, run, runScenario, setGravity, setSpeed, startTestMode, stopTestMode, useSim } from '@renderer/sim/simSession';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Toggle } from '@renderer/ui/components/Toggle';
import { useLiveView } from '@renderer/sim/liveMeshes';
import type { HingeSpec, ScenarioId } from '@shared/sim/scenarios';
import styles from './TestResultsPanel.module.css';

const SPEEDS = [
  { value: '1', label: '1×' },
  { value: '0.5', label: '½×' },
  { value: '0.1', label: '0.1×' },
];

/** Test Mode (SPEC §4.6): live physics, one-click scenarios, pre-checks and results. */
export function TestResultsPanel() {
  const active = useSim((s) => s.active);
  const hasStructure = useProjectStore((s) => (s.doc?.nodes.length ?? 0) > 0);
  if (!active) {
    return hasStructure ? (
      <EmptyState icon={FlaskConical} message="Test the generated structure: drop it, crash it, pull on it, and see what bends and breaks." action={{ label: 'Enter Test Mode', icon: Play, onClick: () => void startTestMode() }} />
    ) : (
      <EmptyState icon={FlaskConical} message="Generate the structure first (Generate in the toolbar), then test it here." />
    );
  }
  return <ActiveTest />;
}

/** Where beams broke, per part; click to select the part in the tree and Inspector. */
function BrokenParts({ broken }: { broken: readonly number[] }) {
  const parts = useProjectStore((s) => s.doc?.parts);
  const assignments = useProjectStore((s) => s.doc?.assignments);
  const selectPart = useSceneStore((s) => s.selectPart);
  const rows = brokenByPart(broken);
  if (!rows.length) return null;
  return (
    <ul className={styles.list} data-testid="sim-broken">
      {rows.map(([partId, n]) => (
        <li key={partId}>
          <button
            type="button"
            className={styles.link}
            onClick={() =>
              selectPart(
                partId,
                Object.keys(assignments ?? {}).filter((k) => assignments?.[k] === partId),
              )
            }
          >
            {parts?.find((p) => p.id === partId)?.displayName ?? partId}
          </button>{' '}
          — {n} beam{n === 1 ? '' : 's'} broke
        </li>
      ))}
    </ul>
  );
}

function ActiveTest() {
  const running = useSim((s) => s.running);
  const speed = useSim((s) => s.speed);
  const gravity = useSim((s) => s.gravity);
  const showMesh = useLiveView((s) => s.showMesh);
  const isolate = useLiveView((s) => s.isolate);
  const stats = useSim((s) => s.stats);
  const nodes = useSim((s) => s.nodes);
  const beams = useSim((s) => s.beams);
  const issues = useSim((s) => s.issues);
  const result = useSim((s) => s.result);
  const busy = useSim((s) => s.busy);
  const activePart = useSceneStore((s) => s.activePart);
  const partName = useProjectStore((s) => s.doc?.parts.find((p) => p.id === activePart)?.displayName);
  const [kmh, setKmh] = useState(50);
  const hinge = useProjectStore((s) => s.doc?.hinges.find((h) => h.partId === activePart));
  const scenario = (id: ScenarioId, params: { kmh?: number; partId?: string; hinge?: HingeSpec } = {}) => {
    dragNode(null);
    runScenario(id, params);
  };
  const realtime = stats.hz / 2000;

  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.panel} data-testid="test-panel">
        <div className={styles.controls}>
          {running ? <IconButton icon={Pause} label="Pause" onClick={pause} data-testid="sim-pause" /> : <IconButton icon={Play} label="Run" onClick={run} data-testid="sim-run" />}
          <IconButton icon={RotateCcw} label="Reset to the authored structure" onClick={reset} data-testid="sim-reset" />
          <Select value={String(speed)} onChange={(v) => setSpeed(Number(v))} options={SPEEDS} className={styles.speed} />
          <Toggle checked={gravity} onChange={setGravity} label="Gravity" />
          <Toggle checked={showMesh} onChange={(v) => useLiveView.getState().set({ showMesh: v })} label="Car mesh" />
          <Toggle checked={isolate} onChange={(v) => useLiveView.getState().set({ isolate: v, showMesh: v || showMesh })} label="Only selected part" />
          <span className={styles.spacer} />
          <Button size="sm" icon={Square} variant="ghost" onClick={stopTestMode} data-testid="sim-exit">
            Exit
          </Button>
        </div>
        <div className={styles.stats} data-testid="sim-stats">
          <span>
            {nodes.toLocaleString()} nodes · {beams.toLocaleString()} beams
          </span>
          <span>{stats.seconds.toFixed(2)} s simulated</span>
          {running && <span>{realtime ? `${realtime.toFixed(2)}× real time` : '—'}</span>}
          {stats.broken > 0 && <Badge tone="danger">{stats.broken} broken</Badge>}
        </div>
        {stats.diverged && (
          <Callout tone="danger">
            Unstable: node {stats.diverged.nodeId} shot off at {Math.round(stats.diverged.speed)} m/s. Add mass to it or soften the beams around it, then reset.
          </Callout>
        )}
        <p className={styles.hint}>Left-drag a node to pull it; right-drag to orbit.</p>

        <FieldGroup title="Scenarios">
          <div className={styles.buttons}>
            <Button size="sm" onClick={() => scenario('settle')} disabled={!!busy} data-testid="scenario-settle">
              Settle
            </Button>
            <Button size="sm" onClick={() => scenario('drop')} disabled={!!busy} data-testid="scenario-drop">
              Drop 1 m
            </Button>
            <Button size="sm" onClick={() => scenario('corner-drop')} disabled={!!busy}>
              20° corner drop
            </Button>
            <Button size="sm" onClick={() => activePart && scenario('yank', { partId: activePart })} disabled={!!busy || !activePart} title={activePart ? undefined : 'Select a part in the Scene tree first'}>
              Yank {partName ?? 'selected part'}
            </Button>
            {hinge && (
              <>
                <Button size="sm" onClick={() => scenario('hinge-swing', { hinge })} disabled={!!busy} title="Push it open to its stop, then shut: checks the swing, the limiter and the seals" data-testid="scenario-hinge-swing">
                  Swing {partName}
                </Button>
                <Button size="sm" onClick={() => scenario('hinge-yank', { hinge })} disabled={!!busy} title="Wrench it outward until the hinges tear: it should come off at the hinges, not rip apart" data-testid="scenario-hinge-yank">
                  Wrench off {partName}
                </Button>
              </>
            )}
          </div>
          <Field label="Crash speed">
            <NumberInput value={kmh} onChange={setKmh} min={5} max={200} step={5} precision={0} unit="km/h" />
          </Field>
          <div className={styles.buttons}>
            <Button size="sm" onClick={() => scenario('crash-pole', { kmh })} disabled={!!busy} data-testid="scenario-pole">
              Pole
            </Button>
            <Button size="sm" onClick={() => scenario('crash-wall', { kmh })} disabled={!!busy}>
              Wall
            </Button>
            <Button size="sm" onClick={() => scenario('crash-offset', { kmh })} disabled={!!busy}>
              40 % offset
            </Button>
          </div>
          {busy && <p className={styles.hint}>Running {busy}…</p>}
        </FieldGroup>

        {result && (
          <FieldGroup title="Result">
            <ul className={styles.list} data-testid="sim-result">
              {result.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <BrokenParts broken={result.broken} />
            <p className={styles.hint}>Beams are coloured by the highest stress they saw (green → yellow → red); broken beams are hidden.</p>
          </FieldGroup>
        )}

        <FieldGroup title="Pre-checks">
          {issues.length === 0 ? (
            <p className={styles.hint}>No orphan nodes, islands, zero-length or duplicate beams; nothing predicted to explode.</p>
          ) : (
            <ul className={styles.list} data-testid="sim-issues">
              {issues.map((i) => (
                <li key={i.code}>
                  <Badge tone={i.severity === 'error' ? 'danger' : 'warning'}>{i.severity}</Badge> {i.message}
                </li>
              ))}
            </ul>
          )}
        </FieldGroup>

        <Callout tone="info">This sandbox checks structure (stability, stiffness, what breaks). It is not BeamNG&rsquo;s solver: drive feel and final deformation tuning are confirmed in the game.</Callout>
      </div>
    </ScrollArea>
  );
}
