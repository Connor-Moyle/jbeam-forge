import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { JbeamObject } from '@shared/jbeam/parse';
import type { FittedSet } from '@shared/project/schema';
import { tuningVariables } from '@shared/suspension/transplant';
import { applyPowertrainEdits, curveOps, curvePeaks, editableFields, effectiveRatios, effectiveTorque, fieldKey, MASS_SCALE, SECTION_LABELS, setMass, spacedRatios, speedAt, torquePart, type EditableField } from '@shared/powertrain/edits';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSetData } from '@renderer/suspension/commands';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Slider } from '@renderer/ui/components/Slider';
import { resetPowertrainEdits, setGearRatios, setPowertrainField, setTorqueCurve, usePowertrainUi, type PowertrainKind } from './commands';
import styles from './Builder.module.css';

/**
 * The engine builder and gearbox builder: the fitted set's own numbers from
 * the game, changed here and written into the mod's copy of its jbeam.
 */

const hp = (kw: number) => kw * 1.341;
const kwAt = (rpm: number, nm: number) => (nm * rpm * 2 * Math.PI) / 60000;

function useFitted(kind: PowertrainKind): { fitted: FittedSet | null; parts: Record<string, JbeamObject> | null; root: string } {
  const fitted = useProjectStore((s) => s.doc?.powertrain[kind] ?? null);
  const data = useSetData((s) => (fitted ? s.data[fitted.setId] : undefined));
  useEffect(() => {
    if (fitted) void useSetData.getState().ensure([fitted.setId]);
  }, [fitted]);
  return { fitted, parts: data?.parts ?? null, root: data?.root ?? '' };
}

function Header({ title, onReset }: { title: string; onReset: () => void }) {
  return (
    <header className={styles.head}>
      <Button icon={ChevronLeft} size="sm" variant="ghost" onClick={() => usePowertrainUi.getState().show(null)}>
        Back
      </Button>
      <span className={styles.crumbs}>{title}</span>
      <Button icon={RotateCcw} size="sm" variant="ghost" onClick={onReset}>
        Reset all
      </Button>
    </header>
  );
}

const digitsFor = (v: number) => (Number.isInteger(v) && Math.abs(v) >= 10 ? 0 : Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 3 : 5);

/** Every other number of the set, grouped by part and section, with a filter. */
function FieldList({ kind, fields, edits, hide }: { kind: PowertrainKind; fields: readonly EditableField[]; edits: Readonly<Record<string, number>>; hide?: ReadonlySet<string> }) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = fields.filter((f) => !hide?.has(f.key) && (!q || `${f.label} ${f.name} ${f.section} ${f.part}`.toLowerCase().includes(q)));
  const groups = [...new Set(shown.map((f) => `${f.part}\u0000${f.section}`))];
  return (
    <FieldGroup title={`Everything else the game lets you set (${fields.length})`}>
      <Input placeholder="Filter: rpm, boost, sound, shift…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter settings" />
      {groups.map((g) => {
        const [part, section] = g.split('\u0000') as [string, string];
        return (
          <section key={g} className={styles.group} data-testid={`${kind}-section-${section}`}>
            <strong className={styles.groupTitle}>
              {SECTION_LABELS[section] ?? section} <span className={styles.muted}>· {part}</span>
            </strong>
            {shown
              .filter((f) => f.part === part && f.section === section)
              .map((f) => {
                const value = edits[f.key] ?? f.value;
                const changed = edits[f.key] !== undefined;
                const digits = digitsFor(f.value);
                return (
                  <div key={f.key} className={styles.fieldRow} title={f.hint || f.name}>
                    <span className={changed ? styles.changed : undefined}>{f.label}</span>
                    <NumberInput value={value} precision={digits} step={digits ? 10 ** -Math.min(digits, 3) : 1} unit={f.unit || undefined} onChange={(v) => setPowertrainField(kind, f.key, v)} aria-label={f.label} />
                    <span className={styles.muted}>{changed ? `game: ${f.value}` : ''}</span>
                    <IconButton icon={RotateCcw} size="sm" label="Back to the game's value" disabled={!changed} onClick={() => setPowertrainField(kind, f.key, null)} />
                  </div>
                );
              })}
          </section>
        );
      })}
    </FieldGroup>
  );
}

const W = 320;
const H = 180;
const PAD = { l: 34, r: 34, t: 10, b: 20 };

/** Torque (accent) and power (warning) against rpm; drag a point to change its torque. */
function DynoEditor({ curve, reference, limit, selected, onSelect, onChange }: { curve: [number, number][]; reference: [number, number][] | null; limit: number; selected: number | null; onSelect: (i: number | null) => void; onChange: (curve: [number, number][], drag: string) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; id: string } | null>(null);
  const all = [...curve, ...(reference ?? [])];
  const maxRpm = Math.max(limit, ...all.map(([r]) => r), 1000);
  const maxNm = Math.max(...all.map(([, t]) => t), 1) * 1.15;
  const maxKw = Math.max(...all.map(([r, t]) => kwAt(r, t)), 1) * 1.15;
  const x = (r: number) => PAD.l + (r / maxRpm) * (W - PAD.l - PAD.r);
  const yT = (t: number) => H - PAD.b - (t / maxNm) * (H - PAD.t - PAD.b);
  const yP = (kw: number) => H - PAD.b - (kw / maxKw) * (H - PAD.t - PAD.b);
  const line = (c: readonly [number, number][], f: (r: number, t: number) => number) => c.map(([r, t]) => `${x(r).toFixed(1)},${f(r, t).toFixed(1)}`).join(' ');
  const nmAt = (e: ReactPointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const py = ((e.clientY - box.top) / box.height) * H;
    return Math.max(0, ((H - PAD.b - py) / (H - PAD.t - PAD.b)) * maxNm);
  };
  const ticks = Array.from({ length: Math.floor(maxRpm / 1000) + 1 }, (_, i) => i * 1000).filter((r) => r % (maxRpm > 10000 ? 2000 : 1000) === 0);
  return (
    <svg
      ref={svg}
      className={styles.dyno}
      viewBox={`0 0 ${W} ${H}`}
      aria-label="Torque and power curve"
      onPointerMove={(e) => {
        if (!drag.current) return;
        onChange(curveOps.set(curve, drag.current.i, Math.round(nmAt(e))), drag.current.id);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      {ticks.map((r) => (
        <g key={r}>
          <line className={styles.grid} x1={x(r)} x2={x(r)} y1={PAD.t} y2={H - PAD.b} />
          <text className={styles.axis} x={x(r)} y={H - 6} textAnchor="middle">
            {r / 1000}k
          </text>
        </g>
      ))}
      <line className={styles.limit} x1={x(limit)} x2={x(limit)} y1={PAD.t} y2={H - PAD.b} />
      <text className={styles.axisTorque} x={4} y={PAD.t + 8}>
        {Math.round(maxNm)} Nm
      </text>
      <text className={styles.axisPower} x={W - 4} y={PAD.t + 8} textAnchor="end">
        {Math.round(hp(maxKw))} hp
      </text>
      {reference && <polyline className={styles.reference} points={line(reference, (_r, t) => yT(t))} />}
      <polyline className={styles.torque} points={line(curve, (_r, t) => yT(t))} />
      <polyline className={styles.power} points={line(curve, (r, t) => yP(kwAt(r, t)))} />
      {curve.map(([r, t], i) => (
        <circle
          key={i}
          className={i === selected ? styles.pointOn : styles.point}
          cx={x(r)}
          cy={yT(t)}
          r={i === selected ? 4.5 : 3.5}
          data-testid="dyno-point"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
            drag.current = { i, id: `drag:${Date.now()}` };
            onSelect(i);
          }}
        />
      ))}
    </svg>
  );
}

export function EngineBuilder() {
  const { fitted, parts, root } = useFitted('engine');
  const [selected, setSelected] = useState<number | null>(null);
  const fields = useMemo(() => (parts ? editableFields(parts) : []), [parts]);
  if (!fitted) return null;
  if (!parts) return <p className={styles.note}>Reading its jbeam…</p>;
  const edits = fitted.edits;
  const curve = effectiveTorque(parts, root, edits);
  const gameCurve = effectiveTorque(parts, root, { ...edits, torque: null });
  const tp = torquePart(parts, root);
  const maxKey = tp ? fieldKey(tp, 'mainEngine', 'maxRPM') : null;
  const limiterKey = tp ? fieldKey(tp, 'mainEngine', 'revLimiterRPM') : null;
  const idleKey = tp ? fieldKey(tp, 'mainEngine', 'idleRPM') : null;
  const field = (key: string | null) => (key ? fields.find((f) => f.key === key) : undefined);
  const valueOf = (key: string | null) => (key ? (edits.fields[key] ?? field(key)?.value ?? null) : null);
  const limit = valueOf(maxKey) ?? Math.max(...curve.map(([r]) => r), 1);
  const peaks = curvePeaks(curve, limit);
  const gamePeaks = curvePeaks(gameCurve, field(maxKey)?.value ?? null);
  const massScale = edits.fields[MASS_SCALE] ?? 1;
  const mass = setMass(applyPowertrainEdits(parts, root, edits));
  const pt = selected !== null ? curve[selected] : undefined;
  const drag = (c: [number, number][], id: string) => setTorqueCurve(c, id);

  /** Rev it higher or lower: the curve stretched, and the limits moved with it. */
  const revTo = (rpm: number) => {
    const top = Math.max(...curve.map(([r]) => r), 1);
    const k = rpm / top;
    setTorqueCurve(curveOps.stretch(curve, rpm));
    for (const key of [maxKey, limiterKey]) {
      const v = valueOf(key);
      if (key && v !== null && field(key)) setPowertrainField('engine', key, Math.round(v * k));
    }
  };

  return (
    <div className={styles.panel} data-testid="engine-builder">
      <Header title={`Engine builder · ${fitted.vehicle} ${fitted.name}`} onReset={() => resetPowertrainEdits('engine')} />
      <ScrollArea className={styles.scroll}>
        <div className={styles.stats}>
          <Stat label="Power" value={peaks.power ? `${Math.round(hp(peaks.power.kw))} hp` : '—'} sub={peaks.power ? `${Math.round(peaks.power.kw)} kW @ ${Math.round(peaks.power.rpm)}` : ''} was={gamePeaks.power ? Math.round(hp(gamePeaks.power.kw)) : null} now={peaks.power ? Math.round(hp(peaks.power.kw)) : null} />
          <Stat label="Torque" value={peaks.torque ? `${Math.round(peaks.torque.nm)} Nm` : '—'} sub={peaks.torque ? `@ ${Math.round(peaks.torque.rpm)} rpm` : ''} was={gamePeaks.torque ? Math.round(gamePeaks.torque.nm) : null} now={peaks.torque ? Math.round(peaks.torque.nm) : null} />
          <Stat label="Rev limit" value={`${Math.round(limit)} rpm`} sub={valueOf(idleKey) !== null ? `idle ${Math.round(valueOf(idleKey)!)}` : ''} was={null} now={null} />
          <Stat label="Weight" value={`${Math.round(mass)} kg`} sub={massScale !== 1 ? `× ${massScale.toFixed(2)}` : 'as the game has it'} was={null} now={null} />
        </div>
        {curve.length > 1 ? (
          <FieldGroup title="Torque curve">
            <DynoEditor curve={curve} reference={edits.torque ? gameCurve : null} limit={limit} selected={selected} onSelect={setSelected} onChange={drag} />
            <p className={styles.note}>Drag a point to change its torque. Blue is torque, amber is power; the grey line is the game&rsquo;s curve.</p>
            <div className={styles.row}>
              {[0.9, 0.95, 1.05, 1.1, 1.25].map((k) => (
                <Button key={k} size="sm" onClick={() => setTorqueCurve(curveOps.scale(curve, k))}>
                  {k < 1 ? `−${Math.round((1 - k) * 100)}%` : `+${Math.round((k - 1) * 100)}%`}
                </Button>
              ))}
              <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!edits.torque} onClick={() => setTorqueCurve(null)}>
                Game curve
              </Button>
            </div>
            <Field label="Rev range" hint="Stretches the curve to end here and moves the rev limit with it">
              <NumberInput value={Math.max(...curve.map(([r]) => r))} precision={0} step={250} min={1000} max={30000} unit="rpm" onChange={revTo} aria-label="Rev range" />
            </Field>
            {pt && selected !== null && (
              <div className={styles.pointRow} data-testid="dyno-point-editor">
                <span className={styles.muted}>Point {selected + 1}</span>
                <NumberInput value={pt[0]} precision={0} step={100} min={0} unit="rpm" onChange={(r) => setTorqueCurve(curve.map((p, j): [number, number] => (j === selected ? [r, p[1]] : p)).sort((a, b) => a[0] - b[0]))} aria-label="Point rpm" />
                <NumberInput value={pt[1]} precision={1} step={5} min={0} unit="Nm" onChange={(t) => setTorqueCurve(curveOps.set(curve, selected, t))} aria-label="Point torque" />
                <IconButton icon={Plus} size="sm" label="Add a point after this one" onClick={() => setTorqueCurve(curveOps.insertAfter(curve, selected))} />
                <IconButton icon={Trash2} size="sm" label="Remove this point" disabled={curve.length <= 2} onClick={() => {
                  setTorqueCurve(curveOps.remove(curve, selected));
                  setSelected(null);
                }} />
              </div>
            )}
          </FieldGroup>
        ) : (
          <p className={styles.note}>This engine&rsquo;s torque comes from a formula or a variable, so there&rsquo;s no curve to draw; its other numbers are below.</p>
        )}
        <FieldGroup title="Weight">
          <Field label="Engine weight" hint="Every node of the engine and its parts, scaled">
            <Slider value={massScale} min={0.3} max={2} step={0.01} format={(v) => `× ${v.toFixed(2)}`} onChange={(v) => setPowertrainField('engine', MASS_SCALE, Math.abs(v - 1) < 0.005 ? null : v)} aria-label="Engine weight" />
          </Field>
        </FieldGroup>
        <FieldList kind="engine" fields={fields} edits={edits.fields} />
        <p className={styles.note}>Turbo and supercharger sections appear when the engine comes with one. In-game tuning sliders (boost, fuel, ignition…) are on the Tune page.</p>
      </ScrollArea>
    </div>
  );
}

function Stat({ label, value, sub, was, now }: { label: string; value: string; sub: string; was: number | null; now: number | null }) {
  const delta = was !== null && now !== null && was !== now ? now - was : null;
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      <span className={styles.muted}>
        {sub}
        {delta !== null && <span className={delta > 0 ? styles.up : styles.down}> {delta > 0 ? `+${delta}` : delta}</span>}
      </span>
    </div>
  );
}

export function GearboxBuilder() {
  const { fitted, parts, root } = useFitted('gearbox');
  const engine = useFitted('engine');
  const [finalDrive, setFinalDrive] = useState(3.9);
  const [tyre, setTyre] = useState(0.31);
  const fields = useMemo(() => (parts ? editableFields(parts) : []), [parts]);
  const varDefaults = useMemo(() => (parts ? Object.fromEntries(tuningVariables(parts).map((v) => [v.name, v.default])) : {}), [parts]);
  if (!fitted) return null;
  if (!parts) return <p className={styles.note}>Reading its jbeam…</p>;
  const { ratios, usesVariables } = effectiveRatios(parts, root, fitted.edits, fitted.tuning, varDefaults);
  const reverse = ratios.find((r) => r < 0) ?? -3.3;
  const forward = ratios.filter((r) => r > 0);
  const set = (next: number[], coalesce?: string) => setGearRatios(next, coalesce);
  const withForward = (f: number[]) => [...ratios.filter((r) => r <= 0), ...f];
  // Speeds at the engine's rev limit (the fitted engine's, else a typical one).
  let redline = 7000;
  if (engine.parts && engine.fitted) {
    const tp = torquePart(engine.parts, engine.root);
    const key = tp ? fieldKey(tp, 'mainEngine', 'maxRPM') : null;
    const m = tp ? engine.parts[tp]!.mainEngine : undefined;
    const game = m && typeof m === 'object' && !Array.isArray(m) && typeof (m).maxRPM === 'number' ? ((m).maxRPM) : null;
    redline = (key ? engine.fitted.edits.fields[key] : undefined) ?? game ?? redline;
  }
  const top = Math.max(...forward.map((g) => speedAt(redline, g, finalDrive, tyre)), 1);
  const ratioKey = (i: number) => `ratio:${i}`;

  return (
    <div className={styles.panel} data-testid="gearbox-builder">
      <Header title={`Gearbox builder · ${fitted.vehicle} ${fitted.name}`} onReset={() => resetPowertrainEdits('gearbox')} />
      <ScrollArea className={styles.scroll}>
        <FieldGroup title={`${forward.length} forward gears`}>
          {usesVariables && !fitted.edits.gearRatios && <p className={styles.note}>Some ratios are adjustable in the game&rsquo;s tuning menu. Changing any ratio here fixes all of them to what you set.</p>}
          <div className={styles.gears}>
            {ratios.map((r, i) => {
              const name = r < 0 ? 'Reverse' : r === 0 ? 'Neutral' : `Gear ${ratios.slice(0, i).filter((x) => x > 0).length + 1}`;
              const kmh = r > 0 ? speedAt(redline, r, finalDrive, tyre) : 0;
              return (
                <div key={i} className={styles.gearRow} data-testid="gear-row">
                  <span>{name}</span>
                  {r === 0 ? (
                    <span className={styles.muted}>0</span>
                  ) : (
                    <NumberInput value={r} precision={3} step={0.01} min={r < 0 ? -20 : 0.05} max={r < 0 ? -0.05 : 20} onChange={(v) => set(ratios.map((x, j) => (j === i ? v : x)), ratioKey(i))} aria-label={`${name} ratio`} />
                  )}
                  {r > 0 ? (
                    <span className={styles.bar}>
                      <span className={styles.barFill} style={{ inlineSize: `${(kmh / top) * 100}%` }} />
                      <span className={styles.barText}>{Math.round(kmh)} km/h</span>
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
          <div className={styles.row}>
            <Button size="sm" icon={Plus} disabled={forward.length >= 12} onClick={() => set(withForward([...forward, Math.round((forward.at(-1) ?? 1) * 0.82 * 1000) / 1000]))}>
              Add a gear
            </Button>
            <Button size="sm" icon={Minus} disabled={forward.length <= 1} onClick={() => set(withForward(forward.slice(0, -1)))}>
              Remove top gear
            </Button>
            <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!fitted.edits.gearRatios} onClick={() => setGearRatios(null)}>
              Game ratios
            </Button>
          </div>
        </FieldGroup>
        <FieldGroup title="Spread the gears evenly">
          <Spacer key={`${forward[0]}|${forward.at(-1)}|${forward.length}`} reverse={reverse} first={forward[0] ?? 3.5} top={forward.at(-1) ?? 0.8} gears={forward.length || 5} onApply={(r) => set(r)} />
        </FieldGroup>
        <FieldGroup title="Road speed at the rev limit">
          <p className={styles.note}>At {Math.round(redline)} rpm. The final drive is on the axle&rsquo;s differential, so these two are only for the chart.</p>
          <div className={styles.row}>
            <Field label="Final drive">
              <NumberInput value={finalDrive} precision={2} step={0.05} min={1} max={10} onChange={setFinalDrive} aria-label="Final drive" />
            </Field>
            <Field label="Tyre radius">
              <NumberInput value={tyre} precision={3} step={0.005} min={0.15} max={1} unit="m" onChange={setTyre} aria-label="Tyre radius" />
            </Field>
          </div>
        </FieldGroup>
        <FieldList kind="gearbox" fields={fields} edits={fitted.edits.fields} />
      </ScrollArea>
    </div>
  );
}

function Spacer({ reverse, first, top, gears, onApply }: { reverse: number; first: number; top: number; gears: number; onApply: (ratios: number[]) => void }) {
  const [v, setV] = useState({ first, top, gears });
  return (
    <div className={styles.row}>
      <Field label="First">
        <NumberInput value={v.first} precision={3} step={0.05} min={0.1} max={20} onChange={(first) => setV({ ...v, first })} aria-label="First gear ratio" />
      </Field>
      <Field label="Top">
        <NumberInput value={v.top} precision={3} step={0.05} min={0.1} max={20} onChange={(t) => setV({ ...v, top: t })} aria-label="Top gear ratio" />
      </Field>
      <Field label="Gears">
        <NumberInput value={v.gears} precision={0} min={1} max={12} onChange={(g) => setV({ ...v, gears: g })} aria-label="Number of gears" />
      </Field>
      <Button size="sm" variant="primary" onClick={() => onApply(spacedRatios(reverse, v.first, v.top, v.gears))} data-testid="gear-spacer-apply">
        Apply
      </Button>
    </div>
  );
}
