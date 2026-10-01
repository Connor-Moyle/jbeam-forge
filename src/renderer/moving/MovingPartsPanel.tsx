import { MovePartSwitch } from './MovePartSwitch';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { DoorOpen, FileCode, Gauge, GraduationCap, MoveHorizontal, WandSparkles, type LucideIcon } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { allMeshes, useSceneStore } from '@renderer/app/stores/scene';
import { useTaxonomy } from '@renderer/parts/taxonomy';
import { hingeAll, unhingedParts } from '@renderer/hinges/commands';
import { HingeSection } from '@renderer/hinges/HingeSection';
import { addProp } from '@renderer/props/commands';
import { PropSection } from '@renderer/props/PropSection';
import { addFromTemplate, useScriptUi } from '@renderer/scripts/commands';
import { allTemplates, templateById } from '@renderer/scripts/registry';
import { ScriptPanel } from '@renderer/scripts/ScriptPanel';
import { withMeshNames } from '@shared/parts/meshNames';
import { PROP_KINDS } from '@shared/props/props';
import type { ScriptTemplate } from '@shared/lua/templates';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { cx } from '@renderer/ui/cx';
import styles from '@renderer/jbeam/Jbeam.module.css';
import own from './Moving.module.css';
import { IconButton } from '@renderer/ui/components/IconButton';
import { useGuide } from '@renderer/help/guide';
import { offerWorkspaceLesson, workspaceLesson } from '@renderer/help/lessons/workspaceLessons';

/**
 * Moving parts workspace (fork): everything on the car that moves, in one
 * list: panels on hinges (doors, hood, trunk), animated parts (steering
 * wheel, needles, pedals) and scripted movement (wipers, windows, mirrors,
 * seats, roofs). Pick one on the left, set it up on the right.
 */

type Pick = { kind: 'hinge'; partId: string } | { kind: 'prop'; meshKey: string } | { kind: 'script'; id: string } | null;

export const useMovingUi = create<{ picked: Pick; pick: (p: Pick) => void }>()((set) => ({ picked: null, pick: (picked) => set({ picked }) }));

/** Templates that move meshes (a mesh list with an animation). */
export function movingTemplates(): ScriptTemplate[] {
  return allTemplates().filter((t) => t.params.some((p) => 'animate' in p && p.animate));
}

/** Meshes worth animating, by their names. */
const SUGGEST: { re: RegExp; kind: string }[] = [
  { re: /steer/i, kind: 'steering' },
  { re: /tach|rpm/i, kind: 'tacho' },
  { re: /speedo|speed_needle/i, kind: 'speedo' },
  { re: /fuel.*needle|needle.*fuel/i, kind: 'fuel' },
  { re: /temp.*needle|needle.*temp/i, kind: 'temp' },
  { re: /throttle|gas_pedal|accel/i, kind: 'throttle' },
  { re: /brake_pedal|pedal_brake/i, kind: 'brake' },
  { re: /clutch/i, kind: 'clutch' },
  { re: /handbrake|parking_?brake/i, kind: 'handbrake' },
];

export function MovingPartsPanel() {
  const doc = useProjectStore((s) => s.doc);
  const sources = useSceneStore((s) => s.sources);
  const picked = useMovingUi((s) => s.picked);
  const tax = useTaxonomy();
  const pick = useMovingUi((s) => s.pick);

  const meshes = useMemo(() => (doc ? withMeshNames(doc, allMeshes(sources)) : []), [doc, sources]);
  useEffect(() => offerWorkspaceLesson('moving'), []);
  if (!doc) return null;
  if (!doc.parts.length) return <EmptyState icon={DoorOpen} message="Sort the model into parts first (Auto-classify in the Scene panel); then doors, hoods, needles and wipers can be made to move here." />;

  const opening = doc.parts.filter((p) => tax.entry(p.taxonomyId)?.openable);
  const ready = unhingedParts(doc).ready.length;
  const props = doc.props ?? [];
  const movingIds = new Set(movingTemplates().map((t) => t.id));
  const scripts = (doc.scripts ?? []).filter((s) => s.templateId && movingIds.has(s.templateId));
  const nameOf = (key: string) => meshes.find((m) => m.key === key)?.name ?? key.slice(key.indexOf(':') + 1);
  const suggestions = meshes
    .filter((m) => !props.some((p) => p.meshKey === m.key))
    .map((m) => ({ m, kind: SUGGEST.find((s) => s.re.test(m.name))?.kind }))
    .filter((x): x is { m: (typeof meshes)[number]; kind: string } => !!x.kind);

  const isPicked = (p: Pick) => JSON.stringify(p) === JSON.stringify(picked);
  const row = (p: Pick, icon: LucideIcon, title: string, meta: string, badge?: { text: string; tone: 'success' | 'warning' | 'neutral' }) => {
    const Icon = icon;
    return (
      <li key={JSON.stringify(p)}>
        <button type="button" className={cx(own.row, isPicked(p) && own.rowOn)} onClick={() => pick(p)}>
          <Icon className={own.icon} aria-hidden />
          <span className={own.name}>{title}</span>
          {badge && (
            <Badge tone={badge.tone} className={own.badge}>
              {badge.text}
            </Badge>
          )}
          <span className={own.meta}>{meta}</span>
        </button>
      </li>
    );
  };

  return (
    <ScrollArea className={styles.scroll}>
      <div className={own.panel} data-testid="moving-parts">
        <div className={own.head}>
          <MovePartSwitch />
          <IconButton icon={GraduationCap} label="Tutorial: moving parts, step by step" onClick={() => useGuide.getState().start(workspaceLesson('moving'))} data-testid="moving-tutorial" />
        </div>
        <section>
          <header className={own.head}>
            <span className={own.title}>Opening panels</span>
            {ready > 0 && (
              <Button size="sm" icon={WandSparkles} onClick={() => hingeAll()} data-testid="moving-hinge-all">
                Hinge all {ready}
              </Button>
            )}
          </header>
          {opening.length ? (
            <ul className={own.list}>
              {opening.map((p) => {
                const h = doc.hinges.find((x) => x.partId === p.id);
                return row({ kind: 'hinge', partId: p.id }, DoorOpen, p.displayName, h ? `opens ${h.openAngle}° · ${h.handles.length} handle${h.handles.length === 1 ? '' : 's'}` : 'swings on a hinge once set up', h ? { text: 'Ready', tone: 'success' } : { text: 'Set up', tone: 'warning' });
              })}
            </ul>
          ) : (
            <p className={own.note}>No doors, hood, trunk or tailgate among the parts.</p>
          )}
        </section>

        <section>
          <header className={own.head}>
            <span className={own.title}>Animated parts</span>
          </header>
          <ul className={own.list}>
            {props.map((p) => row({ kind: 'prop', meshKey: p.meshKey }, Gauge, nameOf(p.meshKey), `follows ${p.func}`))}
            {suggestions.map(({ m, kind }) => (
              <li key={m.key}>
                <button
                  type="button"
                  className={own.suggest}
                  onClick={() => {
                    addProp(m.key, kind);
                    pick({ kind: 'prop', meshKey: m.key });
                  }}
                >
                  <WandSparkles className={own.icon} aria-hidden />
                  <span className={own.name}>{m.name}</span>
                  <span className={own.meta}>Animate as {PROP_KINDS.find((k) => k.id === kind)?.label.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
          <Select
            value={undefined}
            onChange={(key) => {
              addProp(key, SUGGEST.find((s) => s.re.test(nameOf(key)))?.kind ?? 'custom');
              pick({ kind: 'prop', meshKey: key });
            }}
            options={meshes.filter((m) => !props.some((p) => p.meshKey === m.key)).map((m) => ({ value: m.key, label: m.name }))}
            placeholder="Animate another mesh…"
            aria-label="Animate a mesh"
            data-testid="moving-add-prop"
          />
        </section>

        <section>
          <header className={own.head}>
            <span className={own.title}>Scripted movement</span>
          </header>
          <ul className={own.list}>{scripts.map((s) => row({ kind: 'script', id: s.id }, FileCode, s.label, templateById(s.templateId ?? '')?.name ?? s.name, s.enabled ? undefined : { text: 'Off', tone: 'neutral' }))}</ul>
          <Select
            value={undefined}
            onChange={(id) => {
              addFromTemplate(id);
              const sel = useScriptUi.getState().selected;
              if (sel) pick({ kind: 'script', id: sel });
            }}
            options={movingTemplates().map((t) => ({
              value: t.id,
              label: t.name,
            }))}
            placeholder="Add wipers, windows, mirrors…"
            aria-label="Add scripted movement"
            data-testid="moving-add-script"
          />
        </section>
      </div>
    </ScrollArea>
  );
}

/** Moving parts workspace, right: the picked item's settings (hinge, animation or script). */
export function MovingPartPanel() {
  const picked = useMovingUi((s) => s.picked);
  const part = useProjectStore((s) => (picked?.kind === 'hinge' ? s.doc?.parts.find((p) => p.id === picked.partId) : undefined));
  const hasScript = useProjectStore((s) => picked?.kind === 'script' && !!s.doc?.scripts?.some((x) => x.id === picked.id));

  const scriptId = picked?.kind === 'script' ? picked.id : null;
  // The script editor edits the Scripts workspace's pick: point it at this one.
  useEffect(() => {
    if (scriptId && useScriptUi.getState().selected !== scriptId) useScriptUi.getState().set({ selected: scriptId });
  }, [scriptId]);
  if (scriptId && hasScript) return <ScriptPanel />;
  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.body} data-testid="moving-part">
        {picked?.kind === 'hinge' && part ? (
          <>
            <p className={styles.sub}>Set the hinge line, how far it opens and its latch; the ghost in the 3D view shows the swing. Handles are triggers: the Triggers workspace places more.</p>
            <HingeSection part={part} />
          </>
        ) : picked?.kind === 'prop' ? (
          <>
            <p className={styles.sub}>The mesh turns (or slides) with one of the game’s values. Drag Try it to see it move.</p>
            <PropSection meshKey={picked.meshKey} />
          </>
        ) : (
          <EmptyState icon={MoveHorizontal} message="Pick something on the left: a door or hood to hinge, a needle or pedal to animate, or wipers and windows to set up." />
        )}
      </div>
    </ScrollArea>
  );
}
