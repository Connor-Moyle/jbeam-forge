import { useEffect, useMemo, useState } from 'react';
import { Copy, Crosshair, DoorOpen, FlipHorizontal2, MousePointerClick, Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { TRIGGER_PRESETS } from '@shared/triggers/schema';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { cx } from '@renderer/ui/cx';
import { addTrigger, duplicateTrigger, handlesFromHinges, removeTrigger, triggerActions, triggersOf, updateTrigger, useTriggerUi } from './commands';
import styles from '@renderer/jbeam/Jbeam.module.css';
import own from './Triggers.module.css';

/**
 * Triggers workspace, left: every clickable box on the car. Add one, click
 * where it goes on the car, and pick what it does.
 */
export function TriggersPanel() {
  const doc = useProjectStore((s) => s.doc);
  const selected = useTriggerUi((s) => s.selected);
  const triggers = triggersOf(doc);
  const actions = useMemo(() => triggerActions(doc), [doc]);
  const [kind, setKind] = useState<string>(TRIGGER_PRESETS[0]!.id);

  useEffect(() => {
    useTriggerUi.getState().show(true);
    return () => useTriggerUi.getState().show(false);
  }, []);

  if (!doc) return null;
  if (!doc.nodes.length) return <EmptyState icon={MousePointerClick} message="Triggers sit on a part’s nodes so they move with it: generate the structure first (the wand on the toolbar)." />;

  const labelOf = (action: string) => actions.find((a) => a.value === action)?.label ?? action;
  const partOf = (id: string) => doc.parts.find((p) => p.id === id)?.displayName ?? '?';

  return (
    <div className={styles.panel} data-testid="triggers-panel">
      <div className={own.add}>
        <Select value={kind} onChange={setKind} options={TRIGGER_PRESETS.map((p) => ({ value: p.id, label: p.label }))} aria-label="Kind of trigger" />
        <Button variant="primary" icon={Plus} onClick={() => addTrigger(kind)} data-testid="trigger-add">
          Add
        </Button>
      </div>
      {doc.hinges.length > 0 && (
        <div className={own.add}>
          <Button size="sm" icon={DoorOpen} onClick={handlesFromHinges} data-testid="trigger-handles">
            A handle for every door, hood and trunk
          </Button>
        </div>
      )}
      <ScrollArea className={styles.scroll}>
        {triggers.length === 0 ? (
          <p className={own.empty}>
            Triggers are the spots players click in the game: door handles, the hood release, a light switch or a horn button. Pick a kind, click Add, then click on the car where it goes.
          </p>
        ) : (
          <ul className={own.list} data-testid="trigger-list">
            {triggers.map((t) => (
              <li key={t.id}>
                <button type="button" className={cx(own.row, t.id === selected && own.rowOn)} onClick={() => useTriggerUi.getState().select(t.id)} data-trigger={t.id}>
                  <MousePointerClick className={own.icon} aria-hidden />
                  <span className={own.name}>{t.id}</span>
                  <span className={own.meta}>
                    {labelOf(t.action)} · {partOf(t.partId)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

const AXES = ['X (left +)', 'Y (rear +)', 'Z (up +)'] as const;

/** Triggers workspace, right: the picked trigger's place, size and action. */
export function TriggerPanel() {
  const doc = useProjectStore((s) => s.doc);
  const selected = useTriggerUi((s) => s.selected);
  const placing = useTriggerUi((s) => s.placing);
  const advanced = useSettingsStore((s) => s.settings?.jbeamAdvanced ?? false);
  const t = triggersOf(doc).find((x) => x.id === selected);
  const actions = useMemo(() => triggerActions(doc), [doc]);
  const [nameProblem, setNameProblem] = useState<string | null>(null);

  if (!doc || !t)
    return <EmptyState icon={MousePointerClick} message="Pick a trigger in the list (or add one) to place it and choose what it does." />;

  const groups = [...new Set(actions.map((a) => a.group))];
  const known = actions.some((a) => a.value === t.action);
  const set = (patch: Parameters<typeof updateTrigger>[1], label?: string) => updateTrigger(t.id, patch, label);

  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.body} data-testid="trigger-editor">
        <div className={own.titleRow}>
          <MousePointerClick className={own.icon} aria-hidden />
          <span className={styles.modeTitle}>{t.id}</span>
        </div>
        <Button variant={placing ? 'primary' : 'default'} icon={Crosshair} onClick={() => useTriggerUi.getState().setPlacing(!placing)} data-testid="trigger-place">
          {placing ? 'Click on the car where it goes…' : 'Place it on the car'}
        </Button>

        <Field label="What it does" hint="Clicking it in the game runs this, the same as its key.">
          <Select
            value={known ? t.action : '__other__'}
            onChange={(v) => v !== '__other__' && set({ action: v }, 'Change trigger action')}
            options={[...groups.flatMap((g) => actions.filter((a) => a.group === g).map((a) => ({ value: a.value, label: `${g}: ${a.label}` }))), ...(known ? [] : [{ value: '__other__', label: t.action }])]}
            aria-label="What it does"
            data-testid="trigger-action"
          />
        </Field>
        {advanced && (
          <Field label="Input action (by name)" hint="Any of the game’s input actions, for ones not in the list.">
            <Input key={t.action} defaultValue={t.action} onBlur={(e) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(e.target.value) && e.target.value !== t.action && set({ action: e.target.value }, 'Change trigger action')} mono aria-label="Input action" />
          </Field>
        )}

        <Field label="Name" hint={nameProblem ?? 'Its id in the jbeam.'}>
          <Input
            key={t.id}
            defaultValue={t.id}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== t.id) setNameProblem(updateTrigger(t.id, { id: v }, 'Rename trigger'));
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            mono
            aria-label="Trigger name"
          />
        </Field>

        <Field label="Moves with" hint="The part whose nodes carry it: a handle on a door moves with the door.">
          <Select value={t.partId} onChange={(partId) => set({ partId }, 'Move trigger to another part')} options={doc.parts.filter((p) => doc.nodes.some((n) => n.partId === p.id)).map((p) => ({ value: p.id, label: p.displayName }))} aria-label="Moves with" />
        </Field>

        <div className={own.group}>Position</div>
        <div className={styles.row3}>
          {AXES.map((label, i) => (
            <Field key={label} label={label}>
              <NumberInput
                value={t.pos[i]!}
                onChange={(v) => {
                  const pos: [number, number, number] = [...t.pos];
                  pos[i] = v;
                  set({ pos }, 'Move trigger');
                }}
                step={0.005}
                precision={3}
                unit="m"
                aria-label={`Position ${label}`}
              />
            </Field>
          ))}
        </div>
        <div className={own.group}>Size</div>
        <div className={styles.row3}>
          {(['Width', 'Depth', 'Height'] as const).map((label, i) => (
            <Field key={label} label={label}>
              <NumberInput
                value={t.size[i]! * 1000}
                onChange={(v) => {
                  const size: [number, number, number] = [...t.size];
                  size[i] = Math.max(0.005, v / 1000);
                  set({ size }, 'Resize trigger');
                }}
                min={5}
                max={2000}
                step={5}
                precision={0}
                unit="mm"
                aria-label={`Size ${label}`}
              />
            </Field>
          ))}
        </div>
        <div className={styles.buttons}>
          {TRIGGER_PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant="ghost" onClick={() => set({ size: [...p.size] }, 'Resize trigger')}>
              {p.label}
            </Button>
          ))}
        </div>
        <div className={own.group}>Turn</div>
        <div className={styles.row3}>
          {(['X', 'Y', 'Z'] as const).map((label, i) => (
            <Field key={label} label={`About ${label}`}>
              <NumberInput
                value={t.rotation[i]!}
                onChange={(v) => {
                  const rotation: [number, number, number] = [...t.rotation];
                  rotation[i] = v;
                  set({ rotation }, 'Turn trigger');
                }}
                min={-180}
                max={180}
                step={5}
                precision={0}
                unit="°"
                aria-label={`Turn about ${label}`}
              />
            </Field>
          ))}
        </div>

        <div className={styles.buttons}>
          <IconButton icon={Copy} label="Duplicate" onClick={() => duplicateTrigger(t.id, false)} />
          <Button size="sm" icon={FlipHorizontal2} onClick={() => duplicateTrigger(t.id, true)} data-testid="trigger-mirror">
            Copy to the other side
          </Button>
          <span className={styles.spacer} />
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => removeTrigger(t.id)}>
            Delete
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
