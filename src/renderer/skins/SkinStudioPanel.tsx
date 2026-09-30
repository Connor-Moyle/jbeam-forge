import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, FileImage, FileCode2, ImagePlus, LayoutTemplate, Undo2 } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { errorText } from '@renderer/downloads/format';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Tabs } from '@renderer/ui/components/Tabs';
import { Toggle } from '@renderer/ui/components/Toggle';
import { partColor } from '@shared/uv/skinTemplate';
import { DEFAULT_SKIN_OPTIONS, layoutOptions, type SkinOptions } from '@shared/uv/skinUnwrap';
import { applySkinLayout, chosenKeys, clearSkinLayout, currentSkinLayout, isBodyPart, newSkinFromImage, planSkin, saveTemplate, skinMeshes, templateDrawing, useSkinUi, type SkinPlan } from './commands';
import { drawTemplate } from './drawTemplate';
import { showTemplateOnCar } from './preview';
import styles from './Skins.module.css';

/**
 * The Skin studio (fork): lay the car out for skins, save the template to
 * paint on, and bring the painted skin back.
 */
export function SkinStudioPanel() {
  const doc = useProjectStore((s) => s.doc);
  const sources = useSceneStore((s) => s.sources);
  const include = useSkinUi((s) => s.include);
  const uiOpts = useSkinUi((s) => s.opts);
  const optsTouched = useSkinUi((s) => s.optsTouched);
  const size = useSkinUi((s) => s.size);
  const view = useSkinUi((s) => s.view);
  const preview = useSkinUi((s) => s.preview);
  const shading = useSkinUi((s) => s.shading);
  const set = useSkinUi((s) => s.set);
  const stepNow = useSkinUi((s) => s.step);
  const pushStatus = useUiStore((s) => s.pushStatus);

  // Meshes and their parts (positions read once per model load, not per render).
  const meshes = useMemo(() => (doc ? skinMeshes() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skinMeshes reads these from the stores
    [sources, doc?.assignments, doc?.ignoredMeshes, doc?.parts]);
  const current = useMemo(() => currentSkinLayout(doc), [doc]);
  // Until changed here, the options are the applied layout's own.
  const opts = useMemo(() => (!optsTouched && current.layout ? layoutOptions(current.layout) : uiOpts), [optsTouched, current.layout, uiOpts]);
  const appliedKeys = current.keys.join('|');
  const keys = useMemo(() => chosenKeys(meshes, { include }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the applied layout too
    [meshes, include, appliedKeys]);

  // The plan follows the picks and options, a moment after they settle (big cars take a while).
  const [plan, setPlan] = useState<SkinPlan | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPlan(planSkin(meshes, keys, opts)), 150);
    return () => clearTimeout(t);
  }, [meshes, keys, opts]);

  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !plan) return;
    const px = Math.round(c.clientWidth * (window.devicePixelRatio || 1)) || 512;
    c.width = c.height = px;
    drawTemplate(c, templateDrawing(plan, px, view, shading), { labels: view === 'parts' });
  }, [plan, view, shading]);

  // The template on the car follows the plan while it's shown.
  useEffect(() => {
    if (preview === 'template' && plan) showTemplateOnCar(templateDrawing(plan, 2048, 'parts', shading));
  }, [preview, plan, shading]);

  const applied = current.keys.length > 0;
  const stale = applied && (current.keys.length !== keys.size || current.keys.some((k) => !keys.has(k)) || !sameOptions(current.layout, opts));

  // Parts, with their meshes, for the picker.
  const groups = useMemo(() => {
    const byPart = new Map<string, { name: string; partId: string | null; keys: string[]; body: boolean }>();
    for (const m of meshes) {
      const id = m.partId ?? '';
      const g = byPart.get(id) ?? { name: m.partName, partId: m.partId, keys: [], body: doc ? isBodyPart(doc, m.partId) : false };
      g.keys.push(m.key);
      byPart.set(id, g);
    }
    return [...byPart.values()].sort((a, b) => Number(b.body) - Number(a.body) || a.name.localeCompare(b.name));
  }, [meshes, doc]);

  if (!doc || !meshes.length) return <EmptyState icon={LayoutTemplate} message="Import the car's model first: the Skin studio lays its body panels out for painting skins." />;

  const pick = (list: readonly string[], on: boolean) => {
    const next: Record<string, boolean> = Object.fromEntries(meshes.map((m) => [m.key, keys.has(m.key)]));
    for (const k of list) next[k] = on;
    set({ include: next });
  };
  const setOpt = (patch: Partial<SkinOptions>) => set({ opts: { ...opts, ...patch }, optsTouched: true });
  const partIndex = new Map(doc.parts.map((p, i) => [p.id, i]));
  const save = async (kind: 'png' | 'svg') => {
    if (!plan) return;
    try {
      const path = await saveTemplate(plan, size, kind, (c, d) => drawTemplate(c, d));
      if (path) pushStatus(`Template saved: ${path}`, 'success');
    } catch (err) {
      pushStatus(`The template could not be saved: ${errorText(err)}`, 'danger');
    }
  };
  const stats = plan?.stats;

  const step = stepNow;
  const go = (n: 1 | 2 | 3) => set({ step: n });
  const lay = () => {
    if (applySkinLayout(keys, opts)) go(3);
  };
  const steps: { n: 1 | 2 | 3; label: string; done: boolean }[] = [
    { n: 1, label: 'Choose panels', done: keys.size > 0 },
    { n: 2, label: 'Lay out', done: applied && !stale },
    { n: 3, label: 'Template & skins', done: doc.features.skins.length > 0 },
  ];

  const sheet = (
    <>
      <div className={styles.previewHead}>
        <Tabs
          value={view}
          onChange={(v) => set({ view: v === 'stretch' ? 'stretch' : 'parts' })}
          items={[
            { value: 'parts', label: 'Parts' },
            { value: 'stretch', label: 'Stretch' },
          ]}
        />
        {stats && <span className={styles.stats} data-testid="skin-stats">{Math.round(stats.stretched * 100)} % stretched</span>}
      </div>
      <canvas ref={canvas} className={styles.sheet} data-testid="skin-sheet" aria-label="The skin layout" />
      {view === 'stretch' && <p className={styles.note}>Green faces its view squarely; amber is slanted; red is stretched more than twice (a surface nearly edge-on to its view). A little red on tight curves is normal.</p>}
    </>
  );

  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.panel} data-testid="skin-studio">
        <p className={styles.intro}>Make a skin in three steps: choose the body panels, lay them out flat like a paint template (every panel where it sits on the car, so a stripe runs straight across the doors), then save the template, paint it in any image editor and bring it back.</p>
        <ol className={styles.stepper} aria-label="Steps">
          {steps.map((st) => (
            <li key={st.n}>
              <button type="button" className={st.n === step ? styles.stepOn : styles.stepBtn} onClick={() => go(st.n)} aria-current={st.n === step ? 'step' : undefined} data-testid={`skin-step-${st.n}`}>
                <span className={st.done ? styles.stepDone : styles.stepNum}>{st.done ? '✓' : st.n}</span>
                {st.label}
              </button>
            </li>
          ))}
        </ol>

        {step === 1 && (
          <>
            <p className={styles.note}>The body panels are picked for you. Glass, lights, wheels, the interior and parts from the game (fitted engines and suspensions, BeamNG materials) are left out: their textures aren&rsquo;t yours to repaint.</p>
            <div className={styles.row}>
              <Button size="sm" onClick={() => set({ include: Object.fromEntries(meshes.map((m) => [m.key, isBodyPart(doc, m.partId)])) })}>
                Body panels
              </Button>
              <Button size="sm" variant="ghost" onClick={() => pick(meshes.map((m) => m.key), true)}>
                Everything
              </Button>
              <Button size="sm" variant="ghost" onClick={() => pick(meshes.map((m) => m.key), false)}>
                None
              </Button>
              <Badge tone={keys.size ? 'accent' : 'warning'}>{keys.size} of {meshes.length} meshes</Badge>
            </div>
            <ul className={styles.parts} data-testid="skin-parts">
              {groups.map((g) => {
                const on = g.keys.filter((k) => keys.has(k)).length;
                return (
                  <li key={g.partId ?? 'none'} className={styles.part}>
                    <span className={styles.swatch} style={{ background: partColor(g.partId ? (partIndex.get(g.partId) ?? 0) : doc.parts.length) }} aria-hidden />
                    <Checkbox checked={on === g.keys.length} onChange={(v) => pick(g.keys, v)} label={g.name} />
                    <span className={styles.count}>{on < g.keys.length && on > 0 ? `${on}/` : ''}{g.keys.length}</span>
                  </li>
                );
              })}
            </ul>
            <div className={styles.footer}>
              <Button variant="primary" icon={ArrowRight} disabled={!keys.size} onClick={() => go(2)} data-testid="skin-next">
                Next: lay them out
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {sheet}
            <FieldGroup title="How it's laid out">
              <Toggle checked={opts.bothSides} onChange={(bothSides) => setOpt({ bothSides })} label="One design for both sides (the right side mirrored)" />
              <Toggle checked={opts.bottom} onChange={(bottom) => setOpt({ bottom })} label="Give the underside a view of its own" />
              <Field label="Curved panels lean to the side views" hint="Higher keeps rounded doors and flanks whole on the sides; lower sends more of them to the top view.">
                <Slider value={opts.sideBias} onChange={(sideBias) => setOpt({ sideBias })} min={0.8} max={2.5} step={0.05} format={(v) => v.toFixed(2)} aria-label="Side bias" />
              </Field>
              <CollapsibleSection id="skin-advanced" title="More" defaultOpen={false}>
                <Field label="…and to the top view">
                  <Slider value={opts.topBias} onChange={(topBias) => setOpt({ topBias })} min={0.8} max={2.5} step={0.05} format={(v) => v.toFixed(2)} aria-label="Top bias" />
                </Field>
                <Field label="Tidy-up passes" hint="Lone triangles take their neighbours' view, so panels don't break into specks.">
                  <Slider value={opts.smoothing} onChange={(smoothing) => setOpt({ smoothing })} min={0} max={8} step={1} format={(v) => String(v)} aria-label="Tidy-up passes" />
                </Field>
                <Field label="Space between views">
                  <Slider value={opts.padding} onChange={(padding) => setOpt({ padding })} min={0.005} max={0.06} step={0.005} format={(v) => `${Math.round(v * 1000) / 10} %`} aria-label="Space between views" />
                </Field>
                <Button size="sm" variant="ghost" onClick={() => set({ opts: DEFAULT_SKIN_OPTIONS, optsTouched: true })}>
                  Back to the defaults
                </Button>
              </CollapsibleSection>
            </FieldGroup>
            {stale && <Callout tone="info">The picks or options changed: lay it out again so the car and the template match.</Callout>}
            <div className={styles.footer}>
              <Button variant="ghost" icon={ArrowLeft} onClick={() => go(1)}>
                Back
              </Button>
              {applied && (
                <Button icon={Undo2} variant="ghost" onClick={clearSkinLayout}>
                  Remove the layout
                </Button>
              )}
              <Button variant="primary" icon={LayoutTemplate} disabled={!keys.size} onClick={lay} data-testid="skin-apply">
                {applied ? 'Lay out again' : 'Lay out for skins'}
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {!applied || stale ? (
              <Callout tone="warning">
                {applied ? 'The picks or options changed since the layout was made.' : 'Nothing is laid out yet.'}{' '}
                <Button size="sm" onClick={() => go(2)}>
                  Go to step 2
                </Button>
              </Callout>
            ) : (
              <Callout tone="success">{current.keys.length} meshes are laid out for skins. Their other textures now use this layout too.</Callout>
            )}
            {sheet}
            <FieldGroup title="The template to paint on">
              <Field label="Size" hint="4096 suits most skins; 8192 for fine detail on large cars.">
                <Select value={String(size)} onChange={(v) => set({ size: Number(v) as 2048 | 4096 | 8192 })} options={[2048, 4096, 8192].map((n) => ({ value: String(n), label: `${n} × ${n}` }))} aria-label="Template size" />
              </Field>
              <Toggle checked={shading} onChange={(on) => set({ shading: on })} label="Shade the panels (a light guide to their shape, on its own layer)" />
              <div className={styles.row}>
                <Button icon={FileImage} disabled={!applied || stale} onClick={() => void save('png')} data-testid="skin-save-png">
                  Save PNG
                </Button>
                <Button icon={FileCode2} disabled={!applied || stale} onClick={() => void save('svg')} data-testid="skin-save-svg">
                  Save layered SVG
                </Button>
              </div>
              <Toggle
                checked={preview === 'template'}
                onChange={(on) => {
                  // The texture first: the viewport rebuilds its materials as soon as the preview changes.
                  if (on && plan) showTemplateOnCar(templateDrawing(plan, 2048));
                  set({ preview: on ? 'template' : null });
                }}
                label="Show the template on the car"
                disabled={!applied}
              />
            </FieldGroup>
            <FieldGroup title="Your skins">
              <p className={styles.note}>Paint over the template (keep its size), save it as PNG, then bring it in here. Each skin becomes a paint design players pick in the game.</p>
              <Button variant="primary" icon={ImagePlus} disabled={!applied || stale} onClick={() => void newSkinFromImage()} data-testid="skin-new">
                New skin from a painted template…
              </Button>
              {doc.features.skins.length > 0 && (
                <ul className={styles.skins}>
                  {doc.features.skins.map((sk) => (
                    <li key={sk.id} className={styles.skin}>
                      <span>{sk.name}</span>
                      <IconButton icon={preview === sk.id ? Eye : EyeOff} size="sm" label={preview === sk.id ? 'Showing on the car' : 'Show on the car'} active={preview === sk.id} onClick={() => set({ preview: preview === sk.id ? null : sk.id })} />
                    </li>
                  ))}
                </ul>
              )}
            </FieldGroup>
            <div className={styles.footer}>
              <Button variant="ghost" icon={ArrowLeft} onClick={() => go(2)}>
                Back
              </Button>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function sameOptions(layout: ReturnType<typeof currentSkinLayout>['layout'], o: SkinOptions): boolean {
  if (!layout) return false;
  const l = layoutOptions(layout);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return l.bothSides === o.bothSides && l.bottom === o.bottom && l.smoothing === o.smoothing && near(l.sideBias, o.sideBias) && near(l.topBias, o.topBias) && near(l.padding, o.padding);
}
