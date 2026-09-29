import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Pause, Play, Plus, Square, X } from 'lucide-react';
import { controllerData, scriptActions, type TestScenario } from '@shared/lua/templates';
import { headUnitConfig, headUnitHtml, mountHeadUnit } from '@shared/lua/library/display';
import type { SandboxResult } from '@shared/lua/sandbox';
import type { VehicleScript } from '@shared/lua/types';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { IconButton } from '@renderer/ui/components/IconButton';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import { useScriptUi } from './commands';
import { templateById } from './registry';
import { runScriptTest } from './runner';
import { SCENARIOS } from './scenarios';
import styles from './Scripts.module.css';

const OWN = 'own';

/** The value of a recorded series at a time (nearest sample). */
export function valueAt(result: Pick<SandboxResult, 'times' | 'series' | 'inputs'>, name: string, t: number): number | undefined {
  const s = result.series[name] ?? result.inputs[name];
  if (!s || !result.times.length) return undefined;
  let lo = 0;
  let hi = result.times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (result.times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return s[lo];
}

/** Every electrics value at a time (the scenario's and the script's). */
export function electricsAt(result: SandboxResult, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of [...Object.keys(result.inputs), ...Object.keys(result.series)]) {
    const v = valueAt(result, name, t);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** The car's structure for v.data: nodes, and beams (glass ones in a glass break group). */
function vdataOf(): { nodes: { cid: number; pos: [number, number, number] }[]; beams: { cid: number; breakGroup?: string }[] } {
  const doc = projectStore.getState().doc;
  if (!doc) return { nodes: [], beams: [] };
  const glassParts = new Set(doc.parts.filter((p) => /glass|window|windscreen|windshield/i.test(`${p.taxonomyId} ${p.name}`)).map((p) => p.id));
  return {
    nodes: doc.nodes.slice(0, 5000).map((n, i) => ({ cid: i, pos: [n.pos[0], n.pos[1], n.pos[2]] as [number, number, number] })),
    beams: doc.beams.slice(0, 20000).map((b, i) => ({ cid: i, ...(glassParts.has(b.partId) ? { breakGroup: 'glass' } : {}) })),
  };
}

function Strip({ name, values, times, t, tone }: { name: string; values: number[]; times: number[]; t: number | null; tone: 'out' | 'in' }) {
  const w = 600;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const end = times[times.length - 1] || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((times[i]! / end) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join('');
  const now = t !== null ? valueAt({ times, series: { [name]: values }, inputs: {} }, name, t) : values[values.length - 1];
  return (
    <div className={styles.strip}>
      <div className={styles.stripHead}>
        <code className={tone === 'out' ? styles.stripName : styles.stripInput}>{name}</code>
        <span className={styles.mono}>{now === undefined ? '' : +now.toFixed(3)}</span>
      </div>
      <svg className={styles.stripSvg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <path d={d} className={tone === 'out' ? styles.lineOut : styles.lineIn} />
        {t !== null && <line x1={(t / end) * w} x2={(t / end) * w} y1={0} y2={h} className={styles.cursor} />}
      </svg>
    </div>
  );
}

function HeadUnitPreview({ script, result, t }: { script: VehicleScript; result: SandboxResult | null; t: number | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const unit = useRef<ReturnType<typeof mountHeadUnit> | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.style.setProperty('--screen-scale', String(el.clientWidth / 1280)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The page without its script (the app's security policy keeps scripts out of frames); the app runs it instead.
  const html = useMemo(() => headUnitHtml({ name: script.name, params: script.params }, { script: false }), [script.name, script.params]);
  const config = useMemo(() => headUnitConfig({ name: script.name, params: script.params }), [script.name, script.params]);
  useEffect(() => {
    let reported = false;
    const timer = setInterval(() => {
      try {
        unit.current?.render();
      } catch (err) {
        if (!reported) console.error('head unit preview:', err);
        reported = true;
      }
    }, 50);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!result || t === null) return;
    unit.current?.update(electricsAt(result, t));
  }, [result, t]);
  return (
    <div ref={wrap} className={styles.screenWrap}>
      <iframe
        ref={frame}
        title="Head unit preview"
        className={styles.screen}
        srcDoc={html}
        sandbox="allow-same-origin"
        onLoad={() => {
          const doc = frame.current?.contentDocument;
          unit.current = doc?.getElementById('screen') ? mountHeadUnit(doc, config) : null;
          if (result && t !== null) unit.current?.update(electricsAt(result, t));
        }}
        data-testid="headunit-preview"
      />
    </div>
  );
}

/** Test a script in a driving scenario, see what it writes, and play it on the car. */
export function ScriptTestPanel() {
  const selected = useScriptUi((s) => s.selected);
  const script = useProjectStore((s) => s.doc?.scripts?.find((x) => x.id === selected) ?? null);
  const slug = useProjectStore((s) => s.doc?.meta.slug ?? 'car');
  const result = useScriptUi((s) => s.result);
  const running = useScriptUi((s) => s.running);
  const playT = useScriptUi((s) => s.playT);
  const [scenarioId, setScenarioId] = useState(OWN);
  const [presses, setPresses] = useState<{ at: number; action: string }[] | null>(null);
  const [breakGlass, setBreakGlass] = useState(false);
  const [playing, setPlaying] = useState(false);
  const template = script?.templateId ? templateById(script.templateId) : undefined;
  const actions = script ? scriptActions(template ?? null, script) : [];
  const base: TestScenario = scenarioId === OWN && template ? template.test : (SCENARIOS.find((s) => s.id === scenarioId)?.scenario ?? SCENARIOS[0]!.scenario);
  const shownPresses = presses ?? (scenarioId === OWN && template ? template.test.presses : []);

  // Playback: advance the time on the viewport's clock.
  useEffect(() => {
    if (!playing || !result) return;
    let raf = 0;
    let last = performance.now();
    const end = result.times[result.times.length - 1] ?? 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const t = (useScriptUi.getState().playT ?? 0) + dt;
      if (t >= end) {
        useScriptUi.getState().set({ playT: end });
        setPlaying(false);
        return;
      }
      useScriptUi.getState().set({ playT: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, result]);

  if (!script) return <EmptyState icon={FlaskConical} message="Pick a script to test it." />;

  const run = async () => {
    const code = script.code ?? template?.lua ?? '';
    const vdata = vdataOf();
    const glass = vdata.beams.filter((b) => b.breakGroup).slice(0, 50);
    useScriptUi.getState().set({ running: true, playT: null });
    setPlaying(false);
    const r = await runScriptTest({
      fps: useSettingsStore.getState().settings?.scriptTestFps ?? 60,
      code,
      jbeamData: controllerData(template ?? null, script, slug),
      vdata,
      scenario: {
        ...base,
        presses: shownPresses.flatMap((p) => {
          const a = actions.find((x) => x.id === p.action);
          return a ? [{ at: p.at, call: a.call, label: a.label }] : [];
        }),
        ...(breakGlass ? { breaks: glass.map((b) => ({ at: base.seconds / 2, cid: b.cid })) } : {}),
      },
    });
    useScriptUi.getState().set({ running: false, result: r, playT: r.ok ? 0 : null });
    if (r.ok) setPlaying(true);
  };

  const end = result?.times[result.times.length - 1] ?? base.seconds;
  return (
    <div className={styles.panel} data-testid="script-test">
      <div className={styles.row}>
        <Select
          value={scenarioId}
          onChange={(v) => {
            setScenarioId(v);
            setPresses(null);
          }}
          options={[...(template ? [{ value: OWN, label: `Its own test (${template.test.seconds} s)` }] : []), ...SCENARIOS.map((s) => ({ value: s.id, label: s.label }))]}
          aria-label="Scenario"
          className={styles.grow}
        />
        <Toggle checked={breakGlass} onChange={setBreakGlass} label="Break the glass halfway" />
        <Button variant="primary" icon={FlaskConical} onClick={() => void run()} disabled={running} data-testid="script-run">
          {running ? 'Running…' : 'Run test'}
        </Button>
      </div>
      <div className={styles.presses}>
        {shownPresses.map((p, i) => (
          <div key={i} className={styles.press}>
            <NumberInput value={p.at} onChange={(at) => setPresses(shownPresses.map((x, j) => (j === i ? { ...x, at } : x)))} min={0} max={base.seconds} step={0.1} precision={1} aria-label="Pressed at (s)" />
            <Select value={p.action} onChange={(action) => setPresses(shownPresses.map((x, j) => (j === i ? { ...x, action } : x)))} options={actions.map((a) => ({ value: a.id, label: a.label }))} aria-label="Key" />
            <IconButton icon={X} label="Remove" onClick={() => setPresses(shownPresses.filter((_, j) => j !== i))} />
          </div>
        ))}
        {actions.length > 0 && (
          <Button size="sm" icon={Plus} variant="ghost" onClick={() => setPresses([...shownPresses, { at: Math.min(base.seconds, 1 + shownPresses.length), action: actions[0]!.id }])}>
            Press a key
          </Button>
        )}
      </div>
      {result && !result.ok && result.error && (
        <Callout tone="danger" title={result.error.line ? `Line ${result.error.line}${result.error.at ? ` at ${result.error.at.toFixed(2)} s` : ''}` : 'The script stopped'}>
          {result.error.message}
        </Callout>
      )}
      {result && (
        <div className={styles.row}>
          <IconButton icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play on the car'} onClick={() => setPlaying(!playing)} data-testid="script-play" />
          <Slider value={playT ?? 0} onChange={(t) => useScriptUi.getState().set({ playT: t })} min={0} max={end || 1} step={0.01} format={(x) => `${x.toFixed(2)} s`} aria-label="Time" className={styles.grow} />
          <IconButton
            icon={Square}
            label="Stop and put the car back"
            onClick={() => {
              setPlaying(false);
              useScriptUi.getState().set({ playT: null });
            }}
          />
        </div>
      )}
      <ScrollArea className={styles.scroll}>
        {template?.id === 'head_unit' && <HeadUnitPreview script={script} result={result} t={playT} />}
        {result && (
          <div className={styles.results} data-testid="script-results">
            {Object.entries(result.series).map(([name, values]) => (
              <Strip key={name} name={name} values={values} times={result.times} t={playT} tone="out" />
            ))}
            {Object.entries(result.sounds).map(([id, s]) => (
              <Strip key={id} name={`sound ${s.file.split('/').pop()} volume`} values={s.volume} times={result.times} t={playT} tone="out" />
            ))}
            {Object.entries(result.inputs).map(([name, values]) => (
              <Strip key={name} name={name} values={values} times={result.times} t={playT} tone="in" />
            ))}
            <ul className={styles.log} data-testid="script-log">
              {result.log.map((l, i) => (
                <li key={i} className={l.kind === 'error' ? styles.logError : l.kind === 'press' ? styles.logPress : undefined}>
                  <span className={styles.mono}>{l.t.toFixed(2)}s</span> <span className={styles.note}>{l.kind}</span> {l.msg}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!result && <p className={styles.note}>Runs the script in a Lua sandbox with stand-ins for the game: the scenario drives speed, revs, pedals and doors, and presses keys at set times. You see every value it writes, and its animations play on the car.</p>}
      </ScrollArea>
    </div>
  );
}
