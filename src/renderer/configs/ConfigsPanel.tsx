import { confirmDelete } from '@renderer/app/confirm';
import { useEffect, useMemo } from 'react';
import { Copy, Eye, EyeOff, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { configFileName, includedParts, resolveConfig, slotChoices } from '@shared/export/configs';
import { variableName } from '@shared/export/jbeam';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { useTaxonomy } from '@renderer/parts/taxonomy';
import { useSetData } from '@renderer/suspension/commands';
import { Swatch } from '@renderer/paint/PaintsPanel';
import { Button } from '@renderer/ui/components/Button';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Textarea } from '@renderer/ui/components/Textarea';
import { addConfig, applyConfigPreview, deleteConfig, setConfigPaint, setConfigPart, setConfigVar, updateConfig, useConfigUi } from './commands';
import styles from './ConfigsPanel.module.css';

const DEFAULT = '__default__';
const EMPTY = '__empty__';
const FACTORY = '__factory__';
const TYPES = ['Factory', 'Custom', 'Race', 'Police', 'Service', 'Prototype'];

/**
 * Configurations: named versions of the car (Base, Sport, Race…), each
 * choosing a part for every slot, laid out like the game's parts menu, with
 * values for the settings adjustable in game. Exported as .pc files.
 */
export function ConfigsPanel() {
  const tax = useTaxonomy();
  const doc = useProjectStore((s) => s.doc);
  const configs = useProjectStore((s) => s.doc?.configs ?? EMPTY_ARR);
  const selected = useConfigUi((s) => s.selected);
  const preview = useConfigUi((s) => s.preview);
  const config = configs.find((c) => c.id === selected) ?? null;
  const sets = useSetData((s) => s.data);
  const slots = useMemo(() => (doc ? slotChoices(doc, tax, sets) : []), [doc, tax, sets]);
  const pc = useMemo(() => (doc ? resolveConfig(doc, tax, config, sets) : null), [doc, tax, config, sets]);

  // Preview: only the parts this configuration puts on the car.
  useEffect(() => {
    applyConfigPreview(preview && doc && pc ? includedParts(doc, tax, pc, sets) : null);
  }, [preview, doc, tax, pc, sets]);
  useEffect(() => () => applyConfigPreview(null), []);

  if (!doc || !pc) return null;
  if (!slots.length) return <EmptyState icon={Plus} message="Assign meshes to parts first: configurations choose which part goes in each slot." />;
  const parts = new Map(doc.parts.map((p) => [p.id, p]));
  return (
    <div className={styles.panel} data-testid="configs-panel">
      <div className={styles.head}>
        <Select
          value={config?.id ?? DEFAULT}
          onChange={(v) => useConfigUi.getState().select(v === DEFAULT ? null : v)}
          options={[{ value: DEFAULT, label: 'Default' }, ...configs.map((c) => ({ value: c.id, label: c.name }))]}
          aria-label="Configuration"
          className={styles.select}
        />
        <Button icon={Plus} size="sm" onClick={() => addConfig(null)} data-testid="config-add">
          New
        </Button>
        <Button icon={Copy} size="sm" variant="ghost" onClick={() => addConfig(config)} aria-label="Duplicate configuration" />
        {config && <Button icon={Trash2} size="sm" variant="ghost" onClick={() => void confirmDelete(`the ${config.name} configuration`).then((yes) => yes && deleteConfig(config.id))} aria-label="Delete configuration" />}
        <Button icon={preview ? EyeOff : Eye} size="sm" variant={preview ? 'primary' : 'ghost'} onClick={() => useConfigUi.getState().setPreview(!preview)} data-testid="config-preview">
          {preview ? 'Previewing' : 'Preview'}
        </Button>
        <Button icon={LayoutGrid} size="sm" variant="ghost" onClick={() => useDialogStore.getState().setConfigsOpen(true)} data-testid="open-configs-manager">
          Manage…
        </Button>
      </div>
      <ScrollArea className={styles.scroll}>
        {config ? (
          <FieldGroup title="Configuration">
            <Field label="Name" hint={`Exported as ${configFileName(config)}.pc`}>
              <Input value={config.name} onChange={(e) => updateConfig(config.id, { name: e.target.value || 'Configuration' })} data-testid="config-name" />
            </Field>
            <Field label="Type">
              <Select value={config.type} onChange={(type) => updateConfig(config.id, { type })} options={[...new Set([config.type, ...TYPES])].map((t) => ({ value: t, label: t }))} aria-label="Configuration type" />
            </Field>
            <Field label="Description">
              <Textarea value={config.description} onChange={(e) => updateConfig(config.id, { description: e.target.value })} rows={2} />
            </Field>
          </FieldGroup>
        ) : (
          <p className={styles.note}>The default: every slot takes its base part. Make a New configuration to change parts for a Sport or Race version.</p>
        )}

        {config && doc.paints.list.length > 0 && (
          <FieldGroup title="Paint">
            {config.paints.map((id, i) => {
              const fallback = doc.paints.list.find((p) => p.id === doc.paints.defaults[i]);
              return (
                <Field key={i} label={`Paint ${i + 1}`}>
                  <div className={styles.paintRow}>
                    <Swatch paint={doc.paints.list.find((p) => p.id === id) ?? fallback} />
                    <Select
                      value={id ?? FACTORY}
                      onChange={(v) => setConfigPaint(config.id, i as 0 | 1 | 2, v === FACTORY ? null : v)}
                      options={[{ value: FACTORY, label: `Factory default${fallback ? ` (${fallback.name})` : ''}` }, ...doc.paints.list.map((p) => ({ value: p.id, label: p.name }))]}
                      aria-label={`Paint ${i + 1}`}
                      className={styles.slotSelect}
                    />
                  </div>
                </Field>
              );
            })}
          </FieldGroup>
        )}

        <FieldGroup title="Parts">
          <ul className={styles.tree} data-testid="config-slots">
            {slots.map((slot) => {
              const current = pc.parts[slot.slotType] ?? slot.defaultPart;
              const options = [...slot.options.map((o) => ({ value: o.name, label: o.label })), ...(slot.core ? [] : [{ value: EMPTY, label: '(empty)' }])];
              return (
                <li key={slot.slotType} className={styles.slot} style={{ paddingInlineStart: `calc(var(--space-3) * ${slot.depth})` }}>
                  <span className={styles.slotName}>{slot.label}</span>
                  <Select
                    value={current === '' ? EMPTY : current}
                    onChange={(v) => config && setConfigPart(config.id, slot.slotType, v === EMPTY ? '' : v === slot.defaultPart ? null : v)}
                    options={options}
                    disabled={!config || (options.length < 2 && current === slot.defaultPart)}
                    aria-label={`${slot.label} part`}
                    className={styles.slotSelect}
                  />
                </li>
              );
            })}
          </ul>
        </FieldGroup>

        {doc.variables.length > 0 && (
          <FieldGroup title="Tuning">
            {doc.variables.map((v) => {
              const part = parts.get(v.partId);
              if (!part) return null;
              const name = variableName(part, v.setting);
              const value = pc.vars[name] ?? v.default;
              return (
                <Field key={v.id} label={`${part.displayName}: ${v.setting}`}>
                  <Slider value={value} onChange={(x) => config && setConfigVar(config.id, name, x)} min={v.min} max={v.max} step={0.01} format={(x) => `×${x.toFixed(2)}`} aria-label={`${part.displayName} ${v.setting}`} />
                </Field>
              );
            })}
            {!config && <p className={styles.note}>The default uses each setting&rsquo;s default. Make a configuration to set different values.</p>}
          </FieldGroup>
        )}
      </ScrollArea>
    </div>
  );
}
