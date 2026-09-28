import { useState } from 'react';
import { Copy, Plus, Sparkles, Trash2 } from 'lucide-react';
import { PAINT_PRESETS, PAINT_SCHEMES } from '@shared/paints/paints';
import type { Paint } from '@shared/project/schema';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { cx } from '@renderer/ui/cx';
import { addPaint, applyScheme, deletePaint, setDefaultPaint, updatePaint } from './commands';
import { PaintStudio } from './PaintStudio';
import { VinylEditor } from './VinylEditor';
import styles from './PaintsPanel.module.css';

/**
 * Factory paints, the three paint slots, and painting on the car: which
 * slot goes where (two-tone, stripes, three colours at once) and liveries.
 */

export const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
export const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

/** A paint's look as a CSS background: its colour, with a highlight for metallic and clear coat. */
export function swatchStyle(p: Pick<Paint, 'color' | 'metallic' | 'roughness'>): { background: string } {
  const c = hex(p.color);
  const shine = Math.round((1 - p.roughness) * (0.35 + p.metallic * 0.4) * 100);
  return { background: `radial-gradient(circle at 30% 25%, color-mix(in srgb, ${c}, white ${shine}%) 0%, ${c} 55%, color-mix(in srgb, ${c}, black 35%) 100%)` };
}

export function Swatch({ paint, className }: { paint: Pick<Paint, 'color' | 'metallic' | 'roughness'> | undefined; className?: string }) {
  return <span className={cx(styles.swatch, className)} style={paint ? swatchStyle(paint) : undefined} aria-hidden />;
}

const SLOT_NAMES = ['Paint 1', 'Paint 2', 'Paint 3'] as const;

export function PaintsPanel() {
  const paints = useProjectStore((s) => s.doc?.paints.list ?? EMPTY_ARR);
  const defaults = useProjectStore((s) => s.doc?.paints.defaults);
  const [selected, setSelected] = useState<string | null>(null);
  const current = paints.find((p) => p.id === selected) ?? paints[0];
  if (!defaults) return null;
  const options = paints.map((p) => ({ value: p.id, label: p.name }));
  return (
    <div className={styles.panel} data-testid="paints-panel">
      <ScrollArea className={styles.scroll}>
        <FieldGroup title="The car's three paint slots">
          <p className={styles.note}>Paint materials show paint 1 everywhere unless their mask says otherwise: paint slots 2 and 3 on the car below to go two-tone or three-tone. Players can change all three in the game.</p>
          <div className={styles.slots}>
            {defaults.map((id, i) => {
              const p = paints.find((x) => x.id === id);
              return (
                <div key={i} className={styles.slot} data-testid={`paint-slot-${i + 1}`}>
                  <Swatch paint={p} className={styles.bigSwatch} />
                  <span className={styles.slotName}>{SLOT_NAMES[i]}</span>
                  <Select value={id ?? undefined} onChange={(v) => setDefaultPaint(i as 0 | 1 | 2, v)} options={options} placeholder="No paints yet" aria-label={`${SLOT_NAMES[i]} default`} disabled={!paints.length} />
                </div>
              );
            })}
          </div>
          <div className={styles.chips}>
            {PAINT_SCHEMES.map((s) => (
              <button key={s.name} type="button" className={styles.chip} onClick={() => applyScheme(s.name)} title={s.slots.join(' · ')} data-testid="paint-scheme">
                <Sparkles aria-hidden className={styles.icon} />
                {s.name}
              </button>
            ))}
          </div>
        </FieldGroup>

        <PaintStudio />

        <VinylEditor />

        <FieldGroup title={`Factory paints (${paints.length})`}>
          <div className={styles.list} role="listbox" aria-label="Paints">
            {paints.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={p.id === current?.id} className={cx(styles.paintRow, p.id === current?.id && styles.active)} onClick={() => setSelected(p.id)} data-testid="paint-row">
                <Swatch paint={p} />
                <span className={styles.grow}>{p.name}</span>
                <span className={styles.muted}>{defaults.flatMap((d, i) => (d === p.id ? [i + 1] : [])).join(' · ')}</span>
              </button>
            ))}
          </div>
          {current && <PaintEditor key={current.id} paint={current} />}
        </FieldGroup>

        <FieldGroup title="Add a paint">
          {PAINT_PRESETS.map((g) => (
            <div key={g.group} className={styles.presetGroup}>
              <span className={styles.muted}>{g.group}</span>
              <div className={styles.chips}>
                {g.paints.map((p) => (
                  <button key={p.name} type="button" className={styles.chip} onClick={() => setSelected(addPaint(p))} data-testid="paint-preset">
                    <Swatch paint={p} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Button size="sm" icon={Plus} onClick={() => setSelected(addPaint({ name: 'Custom paint', color: [0.5, 0.5, 0.5], metallic: 0.3, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.04 }))}>
            Blank paint
          </Button>
        </FieldGroup>
      </ScrollArea>
    </div>
  );
}

function PaintEditor({ paint }: { paint: Paint }) {
  const [name, setName] = useState(paint.name);
  const set = (patch: Partial<Omit<Paint, 'id'>>) => updatePaint(paint.id, patch);
  const slider = (label: string, key: 'metallic' | 'roughness' | 'clearcoat' | 'clearcoatRoughness', hint?: string) => (
    <Field label={label} hint={hint}>
      <Slider value={paint[key]} onChange={(v) => set({ [key]: v })} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} aria-label={label} />
    </Field>
  );
  return (
    <div className={styles.editor} data-testid="paint-editor">
      <div className={styles.editorHead}>
        <input type="color" className={styles.color} value={hex(paint.color)} onChange={(e) => set({ color: fromHex(e.target.value) })} aria-label="Paint colour" />
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== paint.name && set({ name: name.trim() })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Paint name" className={styles.grow} />
        <IconButton icon={Copy} size="sm" label="Duplicate" onClick={() => addPaint({ ...paint, name: `${paint.name} copy` })} />
        <IconButton icon={Trash2} size="sm" label="Delete paint" onClick={() => deletePaint(paint.id)} />
      </div>
      {slider('Metallic', 'metallic', 'Flake: 0 is solid paint, 1 is chrome-like')}
      {slider('Roughness', 'roughness', 'Low is glossy, high is matte')}
      {slider('Clear coat', 'clearcoat')}
      {slider('Clear coat roughness', 'clearcoatRoughness')}
    </div>
  );
}
