import { useState } from 'react';
import { RotateCcw, Plus } from 'lucide-react';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { coerceProperty, PROPERTIES, RESERVED, type JbeamProperty, type PropertyTarget } from '@shared/jbeam/properties';
import { JBEAM_KEY, type RowOptions } from '@shared/project/schema';
import { Button } from '@renderer/ui/components/Button';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { Select } from '@renderer/ui/components/Select';
import { cx } from '@renderer/ui/cx';
import { clearOptions, setOption } from './commands';
import styles from './Jbeam.module.css';

/**
 * Every jbeam property of the picked nodes, beams or triangles: the value
 * set by hand, or the part preset's shown faintly. Several picked with
 * different values read "mixed"; typing sets them all. Reset puts one back
 * to the preset.
 */

export interface PropertyEditorProps {
  target: PropertyTarget;
  keys: readonly string[];
  /** The picked rows' own options. */
  rows: readonly { options?: RowOptions }[];
  /** The preset's value for a property (from the first picked row). */
  preset: (key: string) => number | string | boolean | undefined;
}

const PRESET = '__preset__';

export function PropertyEditor({ target, keys, rows, preset }: PropertyEditorProps) {
  const advanced = useSettingsStore((s) => s.settings?.jbeamAdvanced ?? false);
  const props = PROPERTIES[target].filter((p) => advanced || !p.advanced);
  const known = new Set(PROPERTIES[target].map((p) => p.key));
  // Properties set by hand that aren't in the list (typed in Advanced mode).
  const custom = [...new Set(rows.flatMap((r) => Object.keys(r.options ?? {})))].filter((k) => !known.has(k));
  const setCount = rows.filter((r) => r.options && Object.keys(r.options).length).length;

  return (
    <div className={styles.props} data-testid={`jbeam-props-${target}`}>
      {props.map((p) => (
        <PropertyRow key={p.key} prop={p} target={target} keys={keys} rows={rows} preset={preset(p.key)} />
      ))}
      {custom.map((k) => (
        <PropertyRow key={k} prop={{ key: k, label: k, type: 'string', doc: 'A property typed by hand.' }} target={target} keys={keys} rows={rows} preset={undefined} />
      ))}
      {advanced && <AddCustom target={target} keys={keys} />}
      {setCount > 0 && (
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => clearOptions(target, keys)} data-testid="jbeam-reset-all">
          Reset everything to the part’s preset
        </Button>
      )}
    </div>
  );
}

function PropertyRow({ prop, target, keys, rows, preset }: { prop: JbeamProperty; target: PropertyTarget; keys: readonly string[]; rows: readonly { options?: RowOptions }[]; preset: number | string | boolean | undefined }) {
  const values = rows.map((r) => r.options?.[prop.key]);
  const set = values.filter((v) => v !== undefined);
  const same = set.length === rows.length && set.every((v) => v === set[0]);
  const value = same ? set[0] : undefined;
  const mixed = set.length > 0 && !same;
  const hint = mixed ? 'mixed' : preset !== undefined ? `${String(preset)} (preset)` : prop.fallback !== undefined ? `${String(prop.fallback)} (game default)` : 'not set';
  const put = (raw: string | number | boolean | null) => {
    if (raw === null || raw === '' || raw === PRESET) {
      setOption(target, keys, prop.key, null);
      return;
    }
    const v = coerceProperty(prop, raw);
    if (v !== null) setOption(target, keys, prop.key, v);
  };

  let control;
  if (prop.type === 'boolean') {
    control = (
      <Select
        value={value === undefined ? PRESET : String(value)}
        onChange={(v) => put(v === PRESET ? null : v === 'true')}
        options={[
          { value: PRESET, label: mixed ? 'Mixed' : `Preset${preset !== undefined ? ` (${preset ? 'yes' : 'no'})` : ''}` },
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]}
        aria-label={prop.label}
      />
    );
  } else if (prop.type === 'enum') {
    const presetLabel = prop.options?.find((o) => o.value === preset)?.label;
    control = <Select value={value === undefined ? PRESET : String(value)} onChange={(v) => put(v)} options={[{ value: PRESET, label: mixed ? 'Mixed' : `Preset${presetLabel ? ` (${presetLabel})` : ''}` }, ...(prop.options ?? [])]} aria-label={prop.label} />;
  } else {
    control = <TextValue key={`${String(value)}|${keys.join(',').slice(0, 200)}`} value={value === undefined ? '' : String(value)} placeholder={hint} numeric={prop.type === 'number'} unit={prop.unit} label={prop.label} onCommit={put} />;
  }

  return (
    <div className={cx(styles.propRow, value !== undefined && styles.propSet)} title={prop.doc}>
      <span className={styles.propLabel}>
        {prop.label}
        <code className={styles.propKey}>{prop.key}</code>
      </span>
      <span className={styles.propControl}>{control}</span>
      <IconButton icon={RotateCcw} label={`Reset ${prop.label} to the preset`} size="sm" disabled={!set.length} onClick={() => put(null)} />
    </div>
  );
}

/** A number or text typed and committed on Enter or leaving the field (empty = back to the preset). */
function TextValue({ value, placeholder, numeric, unit, label, onCommit }: { value: string; placeholder: string; numeric: boolean; unit?: string; label: string; onCommit: (v: string | number | null) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const t = draft.trim();
    if (t === value) return;
    if (!t) onCommit(null);
    else if (numeric) {
      const n = Number(t.replace(/[, _]/g, ''));
      if (Number.isFinite(n)) onCommit(n);
      else setDraft(value);
    } else onCommit(t);
  };
  return (
    <span className={styles.valueWrap}>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(value);
        }}
        placeholder={placeholder}
        mono={numeric}
        inputMode={numeric ? 'decimal' : undefined}
        aria-label={label}
      />
      {unit && <span className={styles.unit}>{unit}</span>}
    </span>
  );
}

/** Advanced: any other jbeam property by name. */
function AddCustom({ target, keys }: { target: PropertyTarget; keys: readonly string[] }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const bad = !!key && (!JBEAM_KEY.test(key) || RESERVED[target].includes(key));
  const add = () => {
    if (!key || bad || !value.trim()) return;
    const v = coerceProperty(undefined, value);
    if (v === null) return;
    setOption(target, keys, key, v);
    setKey('');
    setValue('');
  };
  return (
    <div className={styles.custom}>
      <Input value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="Other property" invalid={bad} mono aria-label="Property name" data-testid="jbeam-custom-key" />
      <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Value" mono aria-label="Property value" data-testid="jbeam-custom-value" />
      <IconButton icon={Plus} label="Set it" size="sm" disabled={!key || bad || !value.trim()} onClick={add} />
    </div>
  );
}
