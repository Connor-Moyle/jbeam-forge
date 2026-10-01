import { useMemo, useState } from "react";
import { ChevronLeft, RotateCcw, SlidersHorizontal, Wand2 } from "lucide-react";
import {
  ASPIRATIONS,
  BLOCK_MATERIALS,
  cylinderChoices,
  DEFAULT_DESIGN,
  DESIGN_PRESETS,
  designEngine,
  designName,
  displacementOf,
  ENGINE_LAYOUTS,
  EXHAUSTS,
  FLYWHEELS,
  FUEL_SYSTEMS,
  FUELS,
  INTAKES,
  tidyDesign,
  VALVETRAINS,
  type EngineDesign,
} from "@shared/powertrain/design";
import { designTarget, effectiveTorque } from "@shared/powertrain/edits";
import { Button } from "@renderer/ui/components/Button";
import { Callout } from "@renderer/ui/components/Callout";
import { Field } from "@renderer/ui/components/Field";
import { NumberInput } from "@renderer/ui/components/NumberInput";
import { ScrollArea } from "@renderer/ui/components/ScrollArea";
import { Select } from "@renderer/ui/components/Select";
import { Slider } from "@renderer/ui/components/Slider";
import { TabPanel, Tabs } from "@renderer/ui/components/Tabs";
import { Toggle } from "@renderer/ui/components/Toggle";
import { useUnits } from "@renderer/settings/useUnits";
import { useFitted } from "./Builder";
import {
  applyEngineDesign,
  fitDesignedEngine,
  matchingBaseEngine,
  resetPowertrainEdits,
  useEngineDraft,
  usePowertrainCatalogue,
  usePowertrainUi,
} from "./commands";
import styles from "./EngineDesigner.module.css";

/**
 * The engine designer (Engine workspace): design an engine the way you'd
 * build one, stage by stage, and watch its power, torque, weight and
 * reliability change as you go. The design is put on the fitted engine
 * (the game engine underneath gives it mounts, a shape and a sound); with
 * none fitted yet, the closest game engine is suggested to carry it.
 */

type Stage =
  | "start"
  | "block"
  | "top"
  | "breathing"
  | "induction"
  | "fuel"
  | "revs";

const LABELS = {
  layout: {
    inline: "Inline",
    v: "V",
    flat: "Flat (boxer)",
    w: "W",
    rotary: "Rotary",
    electric: "Electric motor",
  },
  material: {
    iron: "Cast iron",
    aluminium: "Aluminium",
    magnesium: "Magnesium",
  },
  valvetrain: {
    ohv: "Pushrods (OHV)",
    sohc: "Single cam (SOHC)",
    dohc: "Twin cam (DOHC)",
  },
  aspiration: {
    na: "Naturally aspirated",
    turbo: "Turbo",
    "twin-turbo": "Twin turbo",
    supercharger: "Supercharger",
  },
  fuel: {
    petrol: "Regular petrol",
    premium: "Premium petrol",
    race: "Race fuel",
    e85: "E85 ethanol",
    diesel: "Diesel",
  },
  fuelSystem: {
    carburettor: "Carburettor",
    "single-point": "Single-point injection",
    port: "Port injection",
    direct: "Direct injection",
  },
  intake: {
    economy: "Economy",
    standard: "Standard",
    sport: "Sport",
    itb: "Individual throttle bodies",
  },
  exhaust: {
    restrictive: "Restrictive",
    standard: "Standard",
    sport: "Sport",
    race: "Race (straight through)",
  },
  flywheel: {
    heavy: "Heavy",
    standard: "Standard",
    light: "Light",
    race: "Race",
  },
} as const;

const options = <V extends string>(
  values: readonly V[],
  labels: Record<V, string>,
) => values.map((value) => ({ value, label: labels[value] }));

export function EngineDesigner() {
  const { fitted, parts, root } = useFitted("engine");
  const draft = useEngineDraft((s) => s.design);
  const sets = usePowertrainCatalogue((s) => s.sets);
  const units = useUnits();
  const [stage, setStage] = useState<Stage>("start");
  const design = fitted?.edits.design ?? draft;
  const target = useMemo(
    () => (parts ? designTarget(parts, root) : null),
    [parts, root],
  );
  const result = useMemo(() => designEngine(design), [design]);
  const gameCurve = useMemo(
    () =>
      parts
        ? effectiveTorque(parts, root, {
            fields: {},
            torque: null,
            gearRatios: null,
          })
        : null,
    [parts, root],
  );
  const base = useMemo(
    () => (sets && !fitted ? matchingBaseEngine(design, sets) : null),
    [sets, fitted, design],
  );
  const electric = design.layout === "electric";

  const change = (patch: Partial<EngineDesign>, key: string) => {
    const next = tidyDesign({ ...design, ...patch });
    if (fitted && target) applyEngineDesign(next, target, `design:${key}`);
    else useEngineDraft.getState().set(next);
  };

  const stages: { value: Stage; label: string }[] = electric
    ? [
        { value: "start", label: "Start" },
        { value: "revs", label: "Motor" },
      ]
    : [
        { value: "start", label: "Start" },
        { value: "block", label: "Block" },
        { value: "top", label: "Top end" },
        { value: "breathing", label: "Breathing" },
        { value: "induction", label: "Induction" },
        { value: "fuel", label: "Fuel & tune" },
        { value: "revs", label: "Revs" },
      ];

  return (
    <div className={styles.panel} data-testid="engine-designer">
      <header className={styles.head}>
        <Button
          icon={ChevronLeft}
          size="sm"
          variant="ghost"
          onClick={() => usePowertrainUi.getState().show(null)}
        >
          Back
        </Button>
        <span className={styles.title} data-testid="engine-design-name">
          {designName(design)}
        </span>
        {fitted && (
          <Button
            icon={RotateCcw}
            size="sm"
            variant="ghost"
            onClick={() => resetPowertrainEdits("engine")}
            title="Back to the game engine as it was"
          >
            Undo design
          </Button>
        )}
      </header>

      <div className={styles.stats} data-testid="engine-design-stats">
        <Stat
          label="Power"
          value={units.power(result.peakPower.kw)}
          sub={`@ ${Math.round(result.peakPower.rpm)} rpm`}
        />
        <Stat
          label="Torque"
          value={units.torque(result.peakTorque.nm)}
          sub={`@ ${Math.round(result.peakTorque.rpm)} rpm`}
        />
        <Stat
          label={electric ? "Motor" : "Size"}
          value={
            electric
              ? `${Math.round(design.motorKw)} kW`
              : `${result.displacementL.toFixed(2)} L`
          }
          sub={
            electric
              ? `${Math.round(design.motorRpm)} rpm top`
              : `${design.cylinders} ${design.layout === "rotary" ? "rotors" : "cyl"}`
          }
        />
        <Stat
          label="Weight"
          value={`${result.massKg} kg`}
          sub={`${Math.round((result.peakPower.kw / result.massKg) * 1000) / 1000} kW/kg`}
        />
        <Stat
          label="Limit"
          value={`${result.revLimiterRPM} rpm`}
          sub={electric ? "" : `idle ${result.idleRPM}`}
        />
        <Meter label="Reliability" value={result.reliability} />
      </div>

      <DesignDyno
        curve={result.curve}
        reference={gameCurve}
        limit={result.revLimiterRPM}
      />
      {result.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}

      <Tabs
        value={stage}
        onChange={setStage}
        items={stages}
        aria-label="Design stage"
        className={styles.tabs}
      >
        <ScrollArea className={styles.scroll}>
          <TabPanel value="start">
            <p className={styles.note}>
              Start from a ready-made engine, or pick a layout and work through
              the stages. Everything updates as you go; every change is one undo
              step.
            </p>
            <div className={styles.presets}>
              {DESIGN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={styles.preset}
                  onClick={() =>
                    change({ ...DEFAULT_DESIGN, ...p.design }, `preset:${p.id}`)
                  }
                  data-testid={`engine-preset-${p.id}`}
                >
                  <strong>{p.label}</strong>
                  <span>{designName({ ...DEFAULT_DESIGN, ...p.design })}</span>
                </button>
              ))}
            </div>
            <Field
              label="Layout"
              hint="How the cylinders are arranged. Inline is simple and narrow, a V is short, flat sits low, a rotary is light and revs high."
            >
              <Select
                value={design.layout}
                onChange={(layout) => change({ layout }, "layout")}
                options={options(ENGINE_LAYOUTS, LABELS.layout)}
                aria-label="Layout"
                data-testid="engine-layout"
              />
            </Field>
            {!electric && (
              <Field
                label={design.layout === "rotary" ? "Rotors" : "Cylinders"}
              >
                <Select
                  value={String(design.cylinders)}
                  onChange={(c) =>
                    change({ cylinders: Number(c) }, "cylinders")
                  }
                  options={cylinderChoices(design.layout).map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                  aria-label="Cylinders"
                  data-testid="engine-cylinders"
                />
              </Field>
            )}
          </TabPanel>

          <TabPanel value="block">
            {design.layout !== "rotary" && (
              <>
                <Dial
                  label="Bore"
                  hint="Cylinder width. Bigger breathes better and revs higher."
                  value={design.bore}
                  min={50}
                  max={130}
                  step={0.1}
                  format={(v) => `${v.toFixed(1)} mm`}
                  onChange={(bore) => change({ bore }, "bore")}
                  aria-label="Bore"
                />
                <Dial
                  label="Stroke"
                  hint="How far the piston travels. Longer makes torque low down but limits the revs."
                  value={design.stroke}
                  min={50}
                  max={130}
                  step={0.1}
                  format={(v) => `${v.toFixed(1)} mm`}
                  onChange={(stroke) => change({ stroke }, "stroke")}
                  aria-label="Stroke"
                />
                <p className={styles.note}>
                  {displacementOf(design).toFixed(2)} L ·{" "}
                  {design.bore > design.stroke * 1.02
                    ? "oversquare (likes revs)"
                    : design.stroke > design.bore * 1.02
                      ? "undersquare (likes torque)"
                      : "square"}{" "}
                  · piston speed {result.pistonSpeed} m/s at the limit
                </p>
              </>
            )}
            <Field
              label="Block material"
              hint="Iron is strong and heavy; aluminium saves weight; magnesium saves more but wears."
            >
              <Select
                value={design.block}
                onChange={(block) => change({ block }, "block")}
                options={options(BLOCK_MATERIALS, LABELS.material)}
                aria-label="Block material"
              />
            </Field>
          </TabPanel>

          <TabPanel value="top">
            <Field label="Head material">
              <Select
                value={design.head}
                onChange={(head) => change({ head }, "head")}
                options={options(BLOCK_MATERIALS, LABELS.material)}
                aria-label="Head material"
              />
            </Field>
            {design.layout !== "rotary" && (
              <>
                <Field
                  label="Valvetrain"
                  hint="Twin cams rev highest; pushrods are compact and torquey but run out of revs sooner."
                >
                  <Select
                    value={design.valvetrain}
                    onChange={(valvetrain) =>
                      change({ valvetrain }, "valvetrain")
                    }
                    options={options(VALVETRAINS, LABELS.valvetrain)}
                    aria-label="Valvetrain"
                  />
                </Field>
                <Field label="Valves per cylinder">
                  <Select
                    value={String(design.valves)}
                    onChange={(v) => change({ valves: Number(v) }, "valves")}
                    options={[2, 3, 4, 5].map((n) => ({
                      value: String(n),
                      label: String(n),
                    }))}
                    aria-label="Valves per cylinder"
                  />
                </Field>
              </>
            )}
            <Toggle
              checked={design.vvt}
              onChange={(vvt) => change({ vvt }, "vvt")}
              label="Variable valve timing (a broader curve)"
            />
          </TabPanel>

          <TabPanel value="breathing">
            <Dial
              label="Cam profile"
              hint="Mild cams pull from low down; race cams make their power near the limit."
              value={design.cam}
              min={0}
              max={1}
              step={0.01}
              format={(v) =>
                v < 0.25
                  ? "Mild"
                  : v < 0.55
                    ? "Street"
                    : v < 0.8
                      ? "Sport"
                      : "Race"
              }
              onChange={(cam) => change({ cam }, "cam")}
              aria-label="Cam profile"
            />
            <Field label="Intake">
              <Select
                value={design.intake}
                onChange={(intake) => change({ intake }, "intake")}
                options={options(INTAKES, LABELS.intake)}
                aria-label="Intake"
              />
            </Field>
            <Field
              label="Exhaust"
              hint="Freer exhausts make more power (and noise)."
            >
              <Select
                value={design.exhaust}
                onChange={(exhaust) => change({ exhaust }, "exhaust")}
                options={options(EXHAUSTS, LABELS.exhaust)}
                aria-label="Exhaust"
              />
            </Field>
          </TabPanel>

          <TabPanel value="induction">
            <Field label="Induction">
              <Select
                value={design.aspiration}
                onChange={(aspiration) => change({ aspiration }, "aspiration")}
                options={options(ASPIRATIONS, LABELS.aspiration)}
                aria-label="Induction"
                data-testid="engine-aspiration"
              />
            </Field>
            {design.aspiration !== "na" && (
              <>
                <Dial
                  label="Boost"
                  hint="How hard it's pushed: more power, more heat, less reliability."
                  value={design.boost}
                  min={1}
                  max={40}
                  step={0.5}
                  format={(v) =>
                    `${v.toFixed(1)} psi (${(v * 0.0689).toFixed(2)} bar)`
                  }
                  onChange={(boost) => change({ boost }, "boost")}
                  aria-label="Boost"
                />
                {design.aspiration !== "supercharger" && (
                  <Dial
                    label="Turbo size"
                    hint="Small turbos boost early with little lag; big ones come in late and make more at the top."
                    value={design.turboSize}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(v) =>
                      v < 0.33 ? "Small" : v < 0.66 ? "Medium" : "Large"
                    }
                    onChange={(turboSize) => change({ turboSize }, "turboSize")}
                    aria-label="Turbo size"
                  />
                )}
                {fitted &&
                  target &&
                  !target.hasTurbo &&
                  design.aspiration !== "supercharger" && (
                    <p className={styles.note}>
                      This base engine has no turbo, so the boost is built into
                      its curve: you won&rsquo;t hear a turbo or feel lag in
                      game. Pick a turbo base engine for that.
                    </p>
                  )}
              </>
            )}
          </TabPanel>

          <TabPanel value="fuel">
            <Field
              label="Fuel"
              hint="Better fuel takes more compression and boost before it knocks."
            >
              <Select
                value={design.fuel}
                onChange={(fuel) => change({ fuel }, "fuel")}
                options={options(FUELS, LABELS.fuel)}
                aria-label="Fuel"
              />
            </Field>
            <Field label="Fuel system">
              <Select
                value={design.fuelSystem}
                onChange={(fuelSystem) => change({ fuelSystem }, "fuelSystem")}
                options={options(FUEL_SYSTEMS, LABELS.fuelSystem)}
                aria-label="Fuel system"
              />
            </Field>
            <Dial
              label="Compression"
              hint="Higher squeezes more from each bang, up to where the fuel knocks."
              value={design.compression}
              min={6}
              max={22}
              step={0.1}
              format={(v) => `${v.toFixed(1)} : 1`}
              onChange={(compression) => change({ compression }, "compression")}
              aria-label="Compression ratio"
            />
            <Dial
              label="Tune"
              hint="Rich is safe and cool; lean and aggressive makes more power and wears it faster."
              value={design.tune}
              min={0}
              max={1}
              step={0.01}
              format={(v) =>
                v < 0.33
                  ? "Rich and safe"
                  : v < 0.66
                    ? "Balanced"
                    : "Lean and aggressive"
              }
              onChange={(tune) => change({ tune }, "tune")}
              aria-label="Tune"
            />
            <p className={styles.note}>
              About {result.economy} L/100 km at a steady cruise.
            </p>
          </TabPanel>

          <TabPanel value="revs">
            {electric ? (
              <>
                <Dial
                  label="Motor power"
                  value={design.motorKw}
                  min={10}
                  max={1200}
                  step={5}
                  format={(v) => units.power(v)}
                  onChange={(motorKw) => change({ motorKw }, "motorKw")}
                  aria-label="Motor power"
                />
                <Field label="Top speed of the motor">
                  <NumberInput
                    value={design.motorRpm}
                    min={3000}
                    max={25000}
                    step={500}
                    precision={0}
                    unit="rpm"
                    onChange={(motorRpm) =>
                      change({ motorRpm, redline: motorRpm }, "motorRpm")
                    }
                    aria-label="Motor top speed"
                  />
                </Field>
              </>
            ) : (
              <>
                <Field
                  label="Rev limit"
                  hint="Where the limiter cuts in. The valvetrain and piston speed decide how high it can safely go."
                >
                  <NumberInput
                    value={design.redline}
                    min={2500}
                    max={20000}
                    step={100}
                    precision={0}
                    unit="rpm"
                    onChange={(redline) => change({ redline }, "redline")}
                    aria-label="Rev limit"
                    data-testid="engine-redline"
                  />
                </Field>
                <Field label="Idle">
                  <NumberInput
                    value={design.idle}
                    min={400}
                    max={2000}
                    step={25}
                    precision={0}
                    unit="rpm"
                    onChange={(idle) => change({ idle }, "idle")}
                    aria-label="Idle speed"
                  />
                </Field>
                <Field
                  label="Flywheel"
                  hint="Lighter revs up and down faster; heavier is smoother and easier to pull away with."
                >
                  <Select
                    value={design.flywheel}
                    onChange={(flywheel) => change({ flywheel }, "flywheel")}
                    options={options(FLYWHEELS, LABELS.flywheel)}
                    aria-label="Flywheel"
                  />
                </Field>
              </>
            )}
          </TabPanel>
        </ScrollArea>
      </Tabs>

      <footer className={styles.footer}>
        {fitted ? (
          <>
            <span className={styles.note}>
              Built on the {fitted.vehicle} {fitted.name}: its mounts, shape and
              sound.
            </span>
            <div className={styles.row}>
              <Button
                size="sm"
                icon={SlidersHorizontal}
                onClick={() =>
                  usePowertrainUi
                    .getState()
                    .show({ kind: "engine", page: "build" })
                }
                data-testid="engine-design-finetune"
              >
                Fine-tune every number
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  usePowertrainUi
                    .getState()
                    .show({ kind: "engine", page: "pick" })
                }
              >
                Change the base engine
              </Button>
            </div>
          </>
        ) : base ? (
          <>
            <span className={styles.note}>
              Your design goes on a game engine, which gives it mounts, a shape
              and a sound. The closest:{" "}
              <strong>
                {base.vehicleName} {base.name}
              </strong>
              .
            </span>
            <div className={styles.row}>
              <Button
                size="sm"
                variant="primary"
                icon={Wand2}
                onClick={() => void fitDesignedEngine(design, base)}
                data-testid="engine-design-fit"
              >
                Fit it with my design
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  usePowertrainUi
                    .getState()
                    .show({ kind: "engine", page: "pick" })
                }
              >
                Pick another
              </Button>
            </div>
          </>
        ) : (
          <span className={styles.note}>
            {sets
              ? "No game engines found: set the BeamNG.drive folder in Settings to carry your design."
              : "Reading the game engines…"}
          </span>
        )}
      </footer>
    </div>
  );
}

/** A slider with its value in the label, so it reads without dragging. */
interface DialProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  'aria-label': string;
}

function Dial({ label, hint, format, ...slider }: DialProps) {
  return (
    <Field label={`${label} · ${format(slider.value)}`} hint={hint}>
      <Slider {...slider} format={format} />
    </Field>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      <span className={styles.muted}>{sub}</span>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 70 ? styles.good : value >= 45 ? styles.fair : styles.poor;
  return (
    <div className={styles.stat} title="How long it would last driven hard">
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      <span className={styles.meter}>
        <span
          className={`${styles.meterFill} ${tone}`}
          style={{ inlineSize: `${value}%` }}
        />
      </span>
    </div>
  );
}

const W = 360;
const H = 150;
const PAD = { l: 36, r: 36, t: 10, b: 20 };
const kwAt = (rpm: number, nm: number) => (nm * rpm * 2 * Math.PI) / 60000;

/** The design's dyno: torque (accent) and power (warning), the base engine's curve dashed. */
function DesignDyno({
  curve,
  reference,
  limit,
}: {
  curve: [number, number][];
  reference: [number, number][] | null;
  limit: number;
}) {
  const units = useUnits();
  const shown = curve.filter(([r]) => r <= limit);
  const all = [...shown, ...(reference ?? [])];
  const maxRpm = Math.max(limit, 1000);
  const maxNm = Math.max(...all.map(([, t]) => t), 1) * 1.12;
  const maxKw = Math.max(...shown.map(([r, t]) => kwAt(r, t)), 1) * 1.12;
  const x = (r: number) =>
    PAD.l + (Math.min(r, maxRpm) / maxRpm) * (W - PAD.l - PAD.r);
  const yT = (t: number) => H - PAD.b - (t / maxNm) * (H - PAD.t - PAD.b);
  const yP = (kw: number) => H - PAD.b - (kw / maxKw) * (H - PAD.t - PAD.b);
  const line = (
    c: readonly [number, number][],
    f: (r: number, t: number) => number,
  ) =>
    c
      .filter(([r]) => r <= maxRpm)
      .map(([r, t]) => `${x(r).toFixed(1)},${f(r, t).toFixed(1)}`)
      .join(" ");
  const every = maxRpm > 12000 ? 2000 : 1000;
  const ticks = Array.from(
    { length: Math.floor(maxRpm / every) + 1 },
    (_, i) => i * every,
  );
  return (
    <svg
      className={styles.dyno}
      viewBox={`0 0 ${W} ${H}`}
      aria-label="Power and torque of the design"
      data-testid="engine-design-dyno"
    >
      {ticks.map((r) => (
        <g key={r}>
          <line
            className={styles.grid}
            x1={x(r)}
            x2={x(r)}
            y1={PAD.t}
            y2={H - PAD.b}
          />
          <text className={styles.axis} x={x(r)} y={H - 6} textAnchor="middle">
            {r / 1000}k
          </text>
        </g>
      ))}
      <text className={styles.axisTorque} x={4} y={PAD.t + 8}>
        {units.torque(maxNm)}
      </text>
      <text
        className={styles.axisPower}
        x={W - 4}
        y={PAD.t + 8}
        textAnchor="end"
      >
        {units.power(maxKw)}
      </text>
      {reference && reference.length > 1 && (
        <polyline
          className={styles.reference}
          points={line(reference, (_r, t) => yT(t))}
        />
      )}
      <polyline
        className={styles.torque}
        points={line(shown, (_r, t) => yT(t))}
      />
      <polyline
        className={styles.power}
        points={line(shown, (r, t) => yP(kwAt(r, t)))}
      />
    </svg>
  );
}
