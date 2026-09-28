import { useMemo } from 'react';
import { Brush, Download, SquareDashed, Eraser, FlipHorizontal2, FlipVertical2, Grid3x3, ImagePlus, PaintBucket, Pipette, Redo2, RotateCcw, Shuffle, Stamp, Undo2, Upload, Wand2 } from 'lucide-react';
import type { Axis, PatternKind, PatternSpec } from '@shared/paints/patterns';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import { cx } from '@renderer/ui/cx';
import { setMaterialSlot } from './commands';
import { clearSurface, exportImage, exportUvTemplate, FONTS, importImage, patternWholeMaterial, pickStampImage, redoStroke, setPainterOn, surfacePreview, undoStroke, usePainter, type BrushTool, type Rgb, type Slot } from './painter';
import { fromHex, hex, Swatch } from './PaintsPanel';
import styles from './PaintsPanel.module.css';

/**
 * The paint studio: tools for painting on the car in the viewport, their
 * settings, and getting paintings in and out of an image editor.
 */

const SLOT_NAMES = ['Paint 1', 'Paint 2', 'Paint 3'] as const;

const TOOLS: { tool: BrushTool; label: string; icon: typeof Brush }[] = [
  { tool: 'brush', label: 'Brush (B)', icon: Brush },
  { tool: 'erase', label: 'Erase (E)', icon: Eraser },
  { tool: 'fill', label: 'Fill a whole panel (F)', icon: PaintBucket },
  { tool: 'pattern', label: 'Pattern: stripes, fades, checks, camo (P)', icon: Grid3x3 },
  { tool: 'stamp', label: 'Stamp text or an image (T)', icon: Stamp },
  { tool: 'picker', label: 'Eyedropper (I)', icon: Pipette },
  { tool: 'vinyl', label: 'Vinyl layers: pick, move, resize, turn (V)', icon: SquareDashed },
];

const PATTERNS: { value: PatternKind; label: string }[] = [
  { value: 'stripes', label: 'Stripes' },
  { value: 'gradient', label: 'Fade' },
  { value: 'checker', label: 'Checks' },
  { value: 'camo', label: 'Camo' },
  { value: 'digital-camo', label: 'Digital camo' },
  { value: 'speckle', label: 'Speckle / flake' },
];

const AXES: { value: Axis; label: string }[] = [
  { value: 'width', label: 'Across the car (racing stripes)' },
  { value: 'height', label: 'Up the car (side stripes)' },
  { value: 'length', label: 'Along the car (bands)' },
];
const FADE_AXES: { value: Axis; label: string }[] = [
  { value: 'length', label: 'Front to back' },
  { value: 'height', label: 'Bottom to top' },
  { value: 'width', label: 'Side to side' },
];

/** Ready-made patterns: a click sets everything up. */
const PATTERN_PRESETS: { name: string; spec: Partial<PatternSpec> }[] = [
  { name: 'Twin racing stripes', spec: { kind: 'stripes', axis: 'width', size: 0.22, gap: 0.08, offset: 0, colors: 2 } },
  { name: 'Single wide stripe', spec: { kind: 'stripes', axis: 'width', size: 0.5, gap: 0, offset: 0, colors: 2 } },
  { name: 'Pinstriped band', spec: { kind: 'stripes', axis: 'width', size: 0.3, gap: 0, offset: 0, colors: 3 } },
  { name: 'Side stripe', spec: { kind: 'stripes', axis: 'height', size: 0.08, gap: 0, offset: 0.05, colors: 2 } },
  { name: 'Front-to-back fade', spec: { kind: 'gradient', axis: 'length', from: 0.2, to: 0.8, colors: 2 } },
  { name: 'Sunset fade (3)', spec: { kind: 'gradient', axis: 'height', from: 0.1, to: 0.9, colors: 3 } },
  { name: 'Chequered flag', spec: { kind: 'checker', size: 0.12, colors: 2 } },
  { name: 'Woodland camo', spec: { kind: 'camo', size: 0.45, amount: 0.6, colors: 3 } },
  { name: 'Digital camo', spec: { kind: 'digital-camo', size: 0.35, amount: 0.55, colors: 3 } },
  { name: 'Metal flake', spec: { kind: 'speckle', size: 0.006, amount: 0.25, colors: 2 } },
];

function NumberSlider({ label, value, min, max, step, unit = '', digits = 2, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; unit?: string; digits?: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Slider value={value} onChange={onChange} min={min} max={max} step={step} format={(v) => `${v.toFixed(digits)}${unit}`} aria-label={label} />
    </Field>
  );
}

function ColorInput({ value, onChange, label }: { value: Rgb; onChange: (c: Rgb) => void; label: string }) {
  return <input type="color" className={styles.color} value={hex(value)} onChange={(e) => onChange(fromHex(e.target.value))} aria-label={label} title={label} />;
}

export function PaintStudio() {
  const p = usePainter();
  const paints = useProjectStore((s) => s.doc?.paints);
  const materials = useProjectStore((s) => s.doc?.materials ?? EMPTY_ARR);
  const paintMats = materials.filter((m) => m.paint && !m.gameMaterial);
  const painting = paintMats.find((m) => m.id === p.materialId);
  const slotPaint = (i: number) => paints?.list.find((x) => x.id === paints.defaults[i]);
  const setPattern = (patch: Partial<PatternSpec>) => p.set({ pattern: { ...p.pattern, ...patch } });
  const setStamp = (patch: Partial<typeof p.stamp>) => p.set({ stamp: { ...p.stamp, ...patch } });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- p.rev bumps after every change to the picture
  const preview = useMemo(() => (painting ? surfacePreview(painting.id, p.target) : null), [painting, p.target, p.rev]);
  const pat = p.pattern;

  return (
    <FieldGroup title="Paint studio">
      <div className={styles.row}>
        <Toggle checked={p.on} onChange={setPainterOn} label="Paint on the car" />
        <Toggle checked={p.mirror} onChange={(mirror) => p.set({ mirror })} label="Mirror both sides" />
      </div>
      <p className={styles.note}>Left-drag paints, right-drag orbits. [ ] brush size, Ctrl+Z / Ctrl+Y undo and redo a stroke, Esc stops.</p>
      <Field label="Material">
        <Select value={p.materialId ?? undefined} onChange={(materialId) => p.set({ materialId })} options={paintMats.map((m) => ({ value: m.id, label: m.name }))} placeholder={paintMats.length ? 'Click a painted panel, or choose' : 'No paint materials yet'} disabled={!paintMats.length} aria-label="Material to paint" />
      </Field>
      <div className={styles.segment} role="radiogroup" aria-label="What to paint">
        <button type="button" role="radio" aria-checked={p.target === 'mask'} className={cx(styles.segButton, p.target === 'mask' && styles.segOn)} onClick={() => p.set({ target: 'mask' })}>
          Paint slots (recolourable in game)
        </button>
        <button type="button" role="radio" aria-checked={p.target === 'livery'} className={cx(styles.segButton, p.target === 'livery' && styles.segOn)} onClick={() => p.set({ target: 'livery' })}>
          Livery (any colours)
        </button>
      </div>

      <div className={styles.toolbar} role="toolbar" aria-label="Paint tools">
        {TOOLS.map((t) => (
          <IconButton key={t.tool} icon={t.icon} size="sm" label={t.label} active={p.tool === t.tool} onClick={() => p.set({ tool: t.tool })} data-testid={`paint-tool-${t.tool}`} />
        ))}
        <span className={styles.grow} />
        <IconButton icon={Undo2} size="sm" label="Undo (Ctrl+Z)" onClick={undoStroke} />
        <IconButton icon={Redo2} size="sm" label="Redo (Ctrl+Y)" onClick={redoStroke} />
        <IconButton icon={RotateCcw} size="sm" label={p.target === 'mask' ? 'Start again: all paint 1' : 'Clear the livery'} disabled={!painting} onClick={() => void clearSurface()} />
      </div>

      {p.tool !== 'pattern' && p.tool !== 'picker' && p.tool !== 'vinyl' && (
        <>
          {p.target === 'mask' ? (
            <div className={styles.row}>
              {[0, 1, 2].map((i) => (
                <button key={i} type="button" className={cx(styles.slotPick, p.slot === i && styles.segOn)} onClick={() => p.set({ slot: i as Slot })} aria-pressed={p.slot === i} data-testid={`brush-slot-${i + 1}`}>
                  <Swatch paint={slotPaint(i)} />
                  {SLOT_NAMES[i]}
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.row}>
              <ColorInput value={p.color} onChange={(color) => p.set({ color })} label="Livery colour" />
              {p.recent.map((c, i) => (
                <button key={i} type="button" className={styles.recent} style={{ background: hex(c) }} onClick={() => p.set({ color: c })} aria-label={`Recent colour ${hex(c)}`} />
              ))}
              {p.tool === 'brush' && <Toggle checked={p.rainbow} onChange={(rainbow) => p.set({ rainbow })} label="Rainbow" />}
            </div>
          )}
        </>
      )}

      {(p.tool === 'brush' || p.tool === 'erase') && (
        <>
          <NumberSlider label="Size" value={p.size} min={0.5} max={100} step={0.5} digits={1} unit=" cm" onChange={(size) => p.set({ size })} />
          <NumberSlider label="Hardness" value={p.hardness} min={0} max={1} step={0.01} onChange={(hardness) => p.set({ hardness })} />
        </>
      )}

      {p.tool === 'pattern' && (
        <div className={styles.toolOptions} data-testid="pattern-options">
          <div className={styles.chips}>
            {PATTERN_PRESETS.map((pr) => (
              <button key={pr.name} type="button" className={styles.chip} onClick={() => setPattern(pr.spec)} data-testid="pattern-preset">
                <Wand2 aria-hidden className={styles.icon} />
                {pr.name}
              </button>
            ))}
          </div>
          <div className={styles.row}>
            <Select value={pat.kind} onChange={(kind) => setPattern({ kind })} options={PATTERNS} aria-label="Pattern" className={styles.grow} />
            <Select value={String(pat.colors)} onChange={(v) => setPattern({ colors: Number(v) as 2 | 3 })} options={[{ value: '2', label: '2 colours' }, { value: '3', label: '3 colours' }]} aria-label="Pattern colours" />
          </div>
          <div className={styles.row}>
            {Array.from({ length: pat.colors }, (_, k) =>
              p.target === 'mask' ? (
                <Select
                  key={k}
                  value={String(p.patternSlots[k])}
                  onChange={(v) => {
                    const next = [...p.patternSlots] as typeof p.patternSlots;
                    next[k] = Number(v) as Slot;
                    p.set({ patternSlots: next });
                  }}
                  options={SLOT_NAMES.map((n, i) => ({ value: String(i), label: n }))}
                  aria-label={`Pattern colour ${k + 1}`}
                />
              ) : (
                <ColorInput
                  key={k}
                  value={p.patternColors[k]!}
                  onChange={(c) => {
                    const next = [...p.patternColors] as typeof p.patternColors;
                    next[k] = c;
                    p.set({ patternColors: next });
                  }}
                  label={`Pattern colour ${k + 1}`}
                />
              ),
            )}
          </div>
          {(pat.kind === 'stripes' || pat.kind === 'gradient') && (
            <Field label={pat.kind === 'gradient' ? 'Direction' : 'Stripes run'}>
              <Select value={pat.axis} onChange={(axis) => setPattern({ axis })} options={pat.kind === 'gradient' ? FADE_AXES : AXES} aria-label="Pattern direction" />
            </Field>
          )}
          {pat.kind === 'stripes' && (
            <>
              <NumberSlider label="Stripe width" value={pat.size} min={0.01} max={1.5} step={0.005} digits={3} unit=" m" onChange={(size) => setPattern({ size })} />
              <NumberSlider label="Gap between twin stripes" value={pat.gap} min={0} max={1} step={0.005} digits={3} unit=" m" hint="0 for one stripe" onChange={(gap) => setPattern({ gap })} />
              <NumberSlider label="Offset from the centre" value={pat.offset} min={-1.5} max={1.5} step={0.005} digits={3} unit=" m" onChange={(offset) => setPattern({ offset })} />
            </>
          )}
          {pat.kind === 'gradient' && (
            <>
              <NumberSlider label="Fade starts" value={pat.from} min={0} max={1} step={0.01} onChange={(from) => setPattern({ from })} />
              <NumberSlider label="Fade ends" value={pat.to} min={0} max={1} step={0.01} onChange={(to) => setPattern({ to })} />
            </>
          )}
          {(pat.kind === 'checker' || pat.kind === 'camo' || pat.kind === 'digital-camo' || pat.kind === 'speckle') && (
            <NumberSlider label={pat.kind === 'checker' ? 'Square size' : pat.kind === 'speckle' ? 'Fleck size' : 'Blob size'} value={pat.size} min={pat.kind === 'speckle' ? 0.002 : 0.02} max={pat.kind === 'speckle' ? 0.05 : 1.5} step={pat.kind === 'speckle' ? 0.001 : 0.01} digits={3} unit=" m" onChange={(size) => setPattern({ size })} />
          )}
          {(pat.kind === 'camo' || pat.kind === 'digital-camo' || pat.kind === 'speckle') && (
            <div className={styles.row}>
              <span className={styles.grow}>
                <NumberSlider label={pat.kind === 'speckle' ? 'How many flecks' : 'How much of colours 2 and 3'} value={pat.amount} min={0.02} max={0.98} step={0.01} onChange={(amount) => setPattern({ amount })} />
              </span>
              <IconButton icon={Shuffle} size="sm" label="New shapes" onClick={() => setPattern({ seed: Math.floor(Math.random() * 100000) })} />
            </div>
          )}
          <p className={styles.note}>Worked out on the car itself, so it carries on across panels and seams. Click a panel to lay it there, or lay it over everything wearing this material.</p>
          <Button size="sm" variant="primary" icon={Wand2} disabled={!painting} onClick={() => void patternWholeMaterial()} data-testid="pattern-apply-all">
            Lay it over the whole material
          </Button>
        </div>
      )}

      {p.tool === 'stamp' && (
        <div className={styles.toolOptions} data-testid="stamp-options">
          <div className={styles.segment} role="radiogroup" aria-label="Stamp">
            <button type="button" role="radio" aria-checked={p.stamp.kind === 'text'} className={cx(styles.segButton, p.stamp.kind === 'text' && styles.segOn)} onClick={() => setStamp({ kind: 'text' })}>
              Text or number
            </button>
            <button type="button" role="radio" aria-checked={p.stamp.kind === 'image'} className={cx(styles.segButton, p.stamp.kind === 'image' && styles.segOn)} onClick={() => setStamp({ kind: 'image' })}>
              Image (logo, decal)
            </button>
          </div>
          {p.stamp.kind === 'text' ? (
            <>
              <Input value={p.stamp.text} onChange={(e) => setStamp({ text: e.target.value })} aria-label="Stamp text" placeholder="23" />
              <div className={styles.row}>
                <Select value={p.stamp.font} onChange={(font) => setStamp({ font })} options={FONTS.map((f) => ({ value: f, label: f }))} aria-label="Font" className={styles.grow} />
                <Toggle checked={p.stamp.bold} onChange={(bold) => setStamp({ bold })} label="Bold" />
                <Toggle checked={p.stamp.italic} onChange={(italic) => setStamp({ italic })} label="Italic" />
              </div>
              <div className={styles.row}>
                <span className={styles.grow}>
                  <NumberSlider label="Outline" value={p.stamp.outline} min={0} max={10} step={0.1} digits={1} unit=" cm" onChange={(outline) => setStamp({ outline })} />
                </span>
                {p.target === 'livery' && <ColorInput value={p.stamp.outlineColor} onChange={(outlineColor) => setStamp({ outlineColor })} label="Outline colour" />}
              </div>
              {p.target === 'mask' && <p className={styles.note}>On the paint slots the text is the chosen paint, outlined in the next one.</p>}
            </>
          ) : (
            <div className={styles.row}>
              <Button size="sm" icon={ImagePlus} onClick={() => void pickStampImage()}>
                Choose image…
              </Button>
              <span className={cx(styles.grow, styles.muted)} title={p.stamp.image ?? undefined}>
                {p.stamp.image ? p.stamp.image.slice(Math.max(p.stamp.image.lastIndexOf('/'), p.stamp.image.lastIndexOf('\\')) + 1) : 'PNG with transparency works best'}
              </span>
            </div>
          )}
          <NumberSlider label={p.stamp.kind === 'text' ? 'Height' : 'Width'} value={p.stamp.size} min={2} max={200} step={1} digits={0} unit=" cm" onChange={(size) => setStamp({ size })} />
          <div className={styles.row}>
            <span className={styles.grow}>
              <NumberSlider label="Rotation" value={p.stamp.rotation} min={-180} max={180} step={1} digits={0} unit="°" onChange={(rotation) => setStamp({ rotation })} />
            </span>
            <IconButton icon={FlipHorizontal2} size="sm" label="Mirror it" active={p.stamp.flipX} onClick={() => setStamp({ flipX: !p.stamp.flipX })} />
            <IconButton icon={FlipVertical2} size="sm" label="Flip upside down" active={p.stamp.flipY} onClick={() => setStamp({ flipY: !p.stamp.flipY })} />
          </div>
          <p className={styles.note}>Click the car to stamp. It&rsquo;s laid along the panel: upright and reading the right way from outside, on either side, whatever the texture layout.</p>
        </div>
      )}

      {p.tool === 'vinyl' && <p className={styles.note}>Vinyl layers are edited below: click one on the car to pick it, drag to move it.</p>}
      {p.tool === 'picker' && <p className={styles.note}>Click the car to take the {p.target === 'mask' ? 'paint slot' : 'livery colour'} there; the brush comes back with it.</p>}

      {p.tool !== 'picker' && p.tool !== 'vinyl' && <NumberSlider label="Strength" value={p.strength} min={0.05} max={1} step={0.01} onChange={(strength) => p.set({ strength })} />}

      <div className={styles.studioFoot}>
        {preview ? <img src={preview} alt={`${p.target === 'mask' ? 'Paint slots' : 'Livery'} texture`} className={cx(styles.preview, p.target === 'livery' && styles.checker)} /> : <span className={styles.previewEmpty}>Nothing painted yet</span>}
        <div className={styles.footButtons}>
          <Button size="sm" variant="ghost" icon={Download} disabled={!painting} onClick={() => void exportUvTemplate()} title="The panels' UV outlines over the painting, to paint over in an image editor">
            UV template…
          </Button>
          <Button size="sm" variant="ghost" icon={Download} disabled={!painting} onClick={() => void exportImage()}>
            Save image…
          </Button>
          <Button size="sm" variant="ghost" icon={Upload} disabled={!painting} onClick={() => void importImage()}>
            Bring in image…
          </Button>
        </div>
      </div>
      <Field label="New texture size" hint="Painted masks and liveries are saved as PNGs and exported with the mod.">
        <Select value={String(p.resolution)} onChange={(v) => p.set({ resolution: Number(v) as 1024 | 2048 | 4096 })} options={[1024, 2048, 4096].map((r) => ({ value: String(r), label: `${r} × ${r}` }))} aria-label="Texture size" />
      </Field>

      {!!paintMats.length && (
        <div className={styles.matList}>
          <span className={styles.muted}>Whole paint materials on one slot</span>
          {paintMats.map((m) => (
            <div key={m.id} className={styles.matRow}>
              <span className={styles.grow}>{m.name}</span>
              {[0, 1, 2].map((i) => (
                <Button key={i} size="sm" variant="ghost" title={`All of ${m.name} in ${SLOT_NAMES[i]}`} onClick={() => void setMaterialSlot(m.id, i as Slot)}>
                  <Swatch paint={slotPaint(i)} /> {i + 1}
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}
    </FieldGroup>
  );
}
