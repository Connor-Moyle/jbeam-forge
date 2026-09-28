import { useState, type DragEvent } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Copy,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Group,
  ImagePlus,
  Link2,
  Lock,
  LockOpen,
  Save,
  Shapes,
  SquareDashed,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react';
import type { VinylLayer } from '@shared/project/schema';
import { shapeById, VINYL_SHAPES } from '@shared/paints/shapes';
import { VINYL_GROUPS } from '@shared/paints/vinylLibrary';
import { SIDES, type Side } from '@shared/paints/vinyl';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import { cx } from '@renderer/ui/cx';
import { usePainter } from './painter';
import { fromHex, hex, Swatch } from './PaintsPanel';
import {
  addImage,
  addLibraryGroup,
  addShape,
  addText,
  alignLayers,
  deleteLayers,
  duplicateLayers,
  groupLayers,
  loadGroupFile,
  mirrorCopy,
  moveLayerTo,
  openVinylEditor,
  renameGroup,
  reorder,
  saveGroupFile,
  textAspect,
  ungroupLayers,
  updateLayers,
  useVinylUi,
  viewSide,
} from './vinyls';
import styles from './PaintsPanel.module.css';

/**
 * The vinyl editor, the way a racing game's livery editor works: layers of
 * shapes, text and images stacked on the car, each one moved, sized, turned,
 * slanted, coloured (solid or gradient), faded, masked, mirrored, grouped and
 * reordered at any time. Layers can be saved as vinyl groups for other cars.
 */

const SIDE_LABELS: Record<Side, string> = { left: 'Left', right: 'Right', top: 'Top', front: 'Front', back: 'Back' };
const SLOT_NAMES = ['Paint 1', 'Paint 2', 'Paint 3'] as const;
const CATEGORIES = ['Basic', 'Stripes', 'Graphics'] as const;

function ShapeIcon({ id, className }: { id: string; className?: string }) {
  const s = shapeById(id);
  return (
    <svg viewBox="0 0 100 100" className={cx(styles.shapeIcon, className)} aria-hidden>
      <path d={s.path} fillRule={s.evenOdd ? 'evenodd' : 'nonzero'} />
    </svg>
  );
}

function LayerIcon({ layer }: { layer: VinylLayer }) {
  if (layer.kind === 'shape') return <ShapeIcon id={layer.shape} />;
  if (layer.kind === 'text') return <Type aria-hidden className={styles.shapeIcon} />;
  return <ImagePlus aria-hidden className={styles.shapeIcon} />;
}

function ColorInput({ value, onChange, label }: { value: readonly number[]; onChange: (c: [number, number, number]) => void; label: string }) {
  return <input type="color" className={styles.color} value={hex(value)} onChange={(e) => onChange(fromHex(e.target.value))} aria-label={label} title={label} />;
}

export function VinylEditor() {
  const painter = usePainter();
  const ui = useVinylUi();
  const set = useProjectStore((s) => s.doc?.vinyls.find((v) => v.materialId === painter.materialId && v.target === painter.target));
  const materials = useProjectStore((s) => s.doc?.materials ?? EMPTY_ARR);
  const paints = useProjectStore((s) => s.doc?.paints);
  const [shapeTab, setShapeTab] = useState<(typeof CATEGORIES)[number]>('Basic');
  const [showShapes, setShowShapes] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // Remounts the ready-made picker after each pick, so it's ready for the next.
  const [libraryPick, setLibraryPick] = useState(0);
  const material = materials.find((m) => m.id === painter.materialId);
  const layers = set?.layers ?? EMPTY_ARR;
  const selected = layers.filter((l) => ui.selected.includes(l.id));
  const active = painter.on && painter.tool === 'vinyl';
  const mask = painter.target === 'mask';
  const slotPaint = (i: number) => paints?.list.find((x) => x.id === paints.defaults[i]);

  const click = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e.ctrlKey || e.metaKey) ui.select(ui.selected.includes(id) ? ui.selected.filter((x) => x !== id) : [...ui.selected, id]);
    else if (e.shiftKey && ui.selected.length) {
      const idx = layers.map((l) => l.id);
      const a = idx.indexOf(ui.selected[ui.selected.length - 1]!);
      const b = idx.indexOf(id);
      ui.select(idx.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else ui.select([id]);
    if (!active) openVinylEditor();
  };

  // Top layer first, like any layers panel; groups get a header row above their layers.
  const shown = [...layers].reverse();
  const rows: ({ kind: 'layer'; layer: VinylLayer } | { kind: 'group'; id: string; name: string })[] = [];
  let lastGroup: string | null = null;
  for (const l of shown) {
    if (l.groupId && l.groupId !== lastGroup) {
      const g = set?.groups.find((x) => x.id === l.groupId);
      rows.push({ kind: 'group', id: l.groupId, name: g?.name ?? 'Group' });
    }
    lastGroup = l.groupId;
    rows.push({ kind: 'layer', layer: l });
  }

  const onDrop = (e: DragEvent, target: VinylLayer) => {
    e.preventDefault();
    if (dragId && dragId !== target.id) moveLayerTo(dragId, layers.findIndex((l) => l.id === target.id));
    setDragId(null);
  };

  return (
    <FieldGroup title="Vinyl layers">
      {!material ? (
        <p className={styles.note}>Choose the paint material in the studio above (or click it on the car with the brush). Vinyls go on its {mask ? 'paint slots' : 'livery'}.</p>
      ) : (
        <p className={styles.note}>
          On <strong>{material.name}</strong>&rsquo;s {mask ? 'paint slots (players recolour them in game)' : 'livery'}. {active ? 'Click a layer on the car to pick it; drag to move, Shift-drag to resize, Alt-drag to turn, Ctrl-click to put it there.' : ''}
        </p>
      )}
      <div className={styles.row}>
        <Button size="sm" variant={active ? 'primary' : 'default'} icon={SquareDashed} onClick={openVinylEditor} disabled={!material} data-testid="vinyl-edit">
          {active ? 'Editing vinyls on the car' : 'Edit vinyls on the car'}
        </Button>
      </div>
      <div className={styles.segment} role="group" aria-label="Look from">
        {SIDES.map((s) => (
          <button key={s} type="button" className={cx(styles.segButton, ui.side === s && styles.segOn)} onClick={() => viewSide(s)} data-testid={`vinyl-view-${s}`}>
            {SIDE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className={styles.row}>
        <Button size="sm" icon={Shapes} onClick={() => setShowShapes(!showShapes)} disabled={!material} data-testid="vinyl-add-shape">
          Shape
        </Button>
        <Button size="sm" icon={Type} onClick={() => addText()} disabled={!material} data-testid="vinyl-add-text">
          Text
        </Button>
        <Button size="sm" icon={ImagePlus} onClick={() => void addImage()} disabled={!material}>
          Image…
        </Button>
        <Select key={libraryPick} value={undefined} onChange={(name) => (addLibraryGroup(name), setLibraryPick((n) => n + 1))} options={VINYL_GROUPS.map((g) => ({ value: g.name, label: g.name }))} placeholder="Ready-made…" aria-label="Add a ready-made vinyl group" disabled={!material} />
        <IconButton icon={FolderOpen} size="sm" label="Bring in a vinyl group file (.jbvinyl)" onClick={() => void loadGroupFile()} disabled={!material} />
      </div>
      {showShapes && (
        <div className={styles.shapePicker} data-testid="vinyl-shapes">
          <div className={styles.segment} role="tablist">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={shapeTab === c} className={cx(styles.segButton, shapeTab === c && styles.segOn)} onClick={() => setShapeTab(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className={styles.shapeGrid}>
            {VINYL_SHAPES.filter((s) => s.category === shapeTab).map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.shapeButton}
                title={selected.length === 1 && selected[0]!.kind === 'shape' ? `${s.name} (Alt-click: change the selected layer to this)` : s.name}
                onClick={(e) => (e.altKey && selected.length ? updateLayers(ui.selected, { kind: 'shape', shape: s.id }) : addShape(s.id))}
                data-testid={`vinyl-shape-${s.id}`}
              >
                <ShapeIcon id={s.id} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.layerList} role="listbox" aria-label="Vinyl layers" aria-multiselectable data-testid="vinyl-layers">
        {!rows.length && <span className={styles.previewEmpty}>No layers yet</span>}
        {rows.map((r) =>
          r.kind === 'group' ? (
            <div key={`g:${r.id}`} className={styles.groupRow} onClick={() => ui.select(layers.filter((l) => l.groupId === r.id).map((l) => l.id))}>
              <Group aria-hidden className={styles.icon} />
              <span className={styles.grow}>{r.name}</span>
            </div>
          ) : (
            <div
              key={r.layer.id}
              role="option"
              aria-selected={ui.selected.includes(r.layer.id)}
              className={cx(styles.layerRow, ui.selected.includes(r.layer.id) && styles.active, r.layer.groupId && styles.inGroup, !r.layer.visible && styles.hiddenLayer)}
              onClick={(e) => click(r.layer.id, e)}
              draggable
              onDragStart={() => setDragId(r.layer.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, r.layer)}
              data-testid="vinyl-layer"
            >
              <span className={styles.layerThumb} style={{ color: hex(mask ? (slotPaint(r.layer.slot)?.color ?? [1, 1, 1]) : r.layer.color) }}>
                <LayerIcon layer={r.layer} />
              </span>
              <span className={styles.grow}>{r.layer.name}</span>
              {r.layer.mode !== 'normal' && <span className={styles.badge}>{r.layer.mode === 'erase' ? 'cut' : 'clip'}</span>}
              {r.layer.mirror && <span className={styles.badge}>⇆</span>}
              <IconButton icon={r.layer.visible ? Eye : EyeOff} size="sm" label={r.layer.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), updateLayers([r.layer.id], { visible: !r.layer.visible }))} />
              <IconButton icon={r.layer.locked ? Lock : LockOpen} size="sm" label={r.layer.locked ? 'Unlock' : 'Lock'} active={r.layer.locked} onClick={(e) => (e.stopPropagation(), updateLayers([r.layer.id], { locked: !r.layer.locked }))} />
            </div>
          ),
        )}
      </div>
      <div className={styles.toolbar} role="toolbar" aria-label="Layer actions">
        <IconButton icon={ArrowUpToLine} size="sm" label="To the top" disabled={!selected.length} onClick={() => reorder(ui.selected, 'top')} />
        <IconButton icon={ArrowUp} size="sm" label="Up one" disabled={!selected.length} onClick={() => reorder(ui.selected, 'up')} />
        <IconButton icon={ArrowDown} size="sm" label="Down one" disabled={!selected.length} onClick={() => reorder(ui.selected, 'down')} />
        <IconButton icon={ArrowDownToLine} size="sm" label="To the bottom" disabled={!selected.length} onClick={() => reorder(ui.selected, 'bottom')} />
        <span className={styles.grow} />
        <IconButton icon={Copy} size="sm" label="Duplicate (Ctrl+D)" disabled={!selected.length} onClick={() => duplicateLayers(ui.selected)} data-testid="vinyl-duplicate" />
        <IconButton icon={FlipHorizontal2} size="sm" label="Mirrored copy on the other side" disabled={!selected.length} onClick={() => mirrorCopy(ui.selected)} />
        <IconButton icon={Group} size="sm" label="Group (Ctrl+G)" disabled={selected.length < 2} onClick={() => groupLayers(ui.selected)} data-testid="vinyl-group" />
        <IconButton icon={Ungroup} size="sm" label="Ungroup (Ctrl+Shift+G)" disabled={!selected.some((l) => l.groupId)} onClick={() => ungroupLayers(ui.selected)} />
        <IconButton icon={Save} size="sm" label="Save as a vinyl group file" disabled={!selected.length} onClick={() => void saveGroupFile(ui.selected)} />
        <IconButton icon={Trash2} size="sm" label="Delete (Del)" disabled={!selected.length} onClick={() => deleteLayers(ui.selected)} data-testid="vinyl-delete" />
      </div>

      {selected.length === 1 && <LayerProperties layer={selected[0]!} mask={mask} groups={set?.groups ?? []} />}
      {selected.length > 1 && <MultiProperties layers={selected} mask={mask} />}
      <p className={styles.note}>
        Keys with a layer picked: arrows move (Shift ×10, Alt fine), Q/E turn, + / − resize, H hide, Del delete, Ctrl+D duplicate, Ctrl+G group. Layers wrap round the car from the side they&rsquo;re on and fade where it turns away.
      </p>
    </FieldGroup>
  );
}

function NumberRow({ label, value, onChange, unit, step = 0.01, digits = 3, min, max }: { label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; digits?: number; min?: number; max?: number }) {
  return (
    <Field label={label}>
      <NumberInput value={value} onChange={onChange} step={step} precision={digits} unit={unit} min={min} max={max} aria-label={label} />
    </Field>
  );
}

function ColourRow({ layer, mask, which }: { layer: VinylLayer; mask: boolean; which: 1 | 2 }) {
  const paints = useProjectStore((s) => s.doc?.paints);
  const key = which === 1 ? 'slot' : 'slot2';
  const ckey = which === 1 ? 'color' : 'color2';
  if (mask) {
    return (
      <Select
        value={String(layer[key])}
        onChange={(v) => updateLayers([layer.id], { [key]: Number(v) as 0 | 1 | 2 })}
        options={SLOT_NAMES.map((n, i) => ({ value: String(i), label: `${n}${paints?.list.find((p) => p.id === paints.defaults[i]) ? ` (${paints.list.find((p) => p.id === paints.defaults[i])!.name})` : ''}` }))}
        aria-label={which === 1 ? 'Paint slot' : 'Second paint slot'}
      />
    );
  }
  return <ColorInput value={layer[ckey]} onChange={(c) => updateLayers([layer.id], { [ckey]: c })} label={which === 1 ? 'Colour' : 'Second colour'} />;
}

function LayerProperties({ layer, mask, groups }: { layer: VinylLayer; mask: boolean; groups: readonly { id: string; name: string }[] }) {
  const lockAspect = useVinylUi((s) => s.lockAspect);
  const set = (patch: Partial<VinylLayer>, key = Object.keys(patch).join(',')) => updateLayers([layer.id], patch, `vprop:${layer.id}:${key}`);
  const group = groups.find((g) => g.id === layer.groupId);
  const setSize = (w: number | null, h: number | null) => {
    if (lockAspect && w !== null) set({ w, h: (layer.h * w) / layer.w }, 'size');
    else if (lockAspect && h !== null) set({ h, w: (layer.w * h) / layer.h }, 'size');
    else set({ ...(w !== null ? { w } : {}), ...(h !== null ? { h } : {}) }, 'size');
  };
  return (
    <div className={styles.toolOptions} data-testid="vinyl-properties">
      <div className={styles.row}>
        <span className={styles.layerThumb}>
          <LayerIcon layer={layer} />
        </span>
        <Input value={layer.name} onChange={(e) => set({ name: e.target.value })} aria-label="Layer name" className={styles.grow} />
      </div>
      {group && (
        <Field label="Group">
          <Input value={group.name} onChange={(e) => renameGroup(group.id, e.target.value)} aria-label="Group name" />
        </Field>
      )}
      {layer.kind === 'text' && (
        <>
          <Input
            value={layer.text}
            onChange={(e) => {
              const text = e.target.value;
              set({ text, name: `Text "${text}"`, w: layer.h * textAspect({ ...layer, text }) }, 'text');
            }}
            aria-label="Vinyl text"
          />
          <div className={styles.row}>
            <Select value={layer.font} onChange={(font) => set({ font, w: layer.h * textAspect({ ...layer, font }) })} options={['Impact', 'Arial Black', 'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Trebuchet MS', 'Segoe UI', 'Consolas'].map((f) => ({ value: f, label: f }))} aria-label="Vinyl font" className={styles.grow} />
            <Toggle checked={layer.bold} onChange={(bold) => set({ bold, w: layer.h * textAspect({ ...layer, bold }) })} label="Bold" />
            <Toggle checked={layer.italic} onChange={(italic) => set({ italic, w: layer.h * textAspect({ ...layer, italic }) })} label="Italic" />
          </div>
        </>
      )}
      {layer.kind === 'shape' && (
        <Field label="Shape">
          <Select value={layer.shape} onChange={(shape) => set({ shape, name: shapeById(shape).name })} options={VINYL_SHAPES.map((s) => ({ value: s.id, label: `${s.category} · ${s.name}` }))} aria-label="Vinyl shape" />
        </Field>
      )}
      <div className={styles.grid2}>
        <Field label="Side">
          <Select value={layer.side} onChange={(side) => set({ side })} options={SIDES.map((s) => ({ value: s, label: SIDE_LABELS[s] }))} aria-label="Layer side" />
        </Field>
        <Field label="Mode">
          <Select value={layer.mode} onChange={(mode) => set({ mode })} options={[{ value: 'normal', label: 'Normal' }, { value: 'erase', label: 'Cut out (erase below)' }, { value: 'clip', label: 'Clip to layer below' }]} aria-label="Layer mode" />
        </Field>
        <NumberRow label="Across (m)" value={layer.x} onChange={(x) => set({ x })} />
        <NumberRow label="Up (m)" value={layer.y} onChange={(y) => set({ y })} />
        <NumberRow label="Width (m)" value={layer.w} min={0.005} onChange={(w) => setSize(w, null)} />
        <NumberRow label="Height (m)" value={layer.h} min={0.005} onChange={(h) => setSize(null, h)} />
      </div>
      <div className={styles.row}>
        <Toggle checked={lockAspect} onChange={(v) => useVinylUi.getState().set({ lockAspect: v })} label="Keep proportions" />
        <IconButton icon={Link2} size="sm" label="Make it square" onClick={() => set({ h: layer.w }, 'size')} />
        <IconButton icon={FlipHorizontal2} size="sm" label="Flip left-right" active={layer.flipX} onClick={() => set({ flipX: !layer.flipX })} />
        <IconButton icon={FlipVertical2} size="sm" label="Flip upside down" active={layer.flipY} onClick={() => set({ flipY: !layer.flipY })} />
      </div>
      <Field label="Rotation">
        <Slider value={layer.rotation} onChange={(rotation) => set({ rotation })} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} aria-label="Layer rotation" />
      </Field>
      <Field label="Slant">
        <Slider value={layer.skew} onChange={(skew) => set({ skew })} min={-70} max={70} step={1} format={(v) => `${Math.round(v)}°`} aria-label="Layer slant" />
      </Field>
      <Field label="Fill">
        <div className={styles.row}>
          <Select value={layer.fill} onChange={(fill) => set({ fill })} options={[{ value: 'solid', label: 'Solid' }, { value: 'linear', label: 'Gradient' }, { value: 'radial', label: 'Radial gradient' }]} aria-label="Layer fill" />
          {layer.kind !== 'image' || mask ? <ColourRow layer={layer} mask={mask} which={1} /> : <span className={styles.muted}>Image colours</span>}
          {layer.fill !== 'solid' && (layer.kind !== 'image' || mask) && <ColourRow layer={layer} mask={mask} which={2} />}
        </div>
      </Field>
      {layer.fill === 'linear' && (
        <Field label="Gradient direction">
          <Slider value={layer.gradientAngle} onChange={(gradientAngle) => set({ gradientAngle })} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} aria-label="Gradient direction" />
        </Field>
      )}
      <Field label="Opacity">
        <Slider value={layer.opacity} onChange={(opacity) => set({ opacity })} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} aria-label="Layer opacity" />
      </Field>
      <div className={styles.row}>
        <Toggle checked={layer.mirror} onChange={(mirror) => set({ mirror })} label="Mirror on the other side" />
        {layer.mirror && (layer.kind === 'text' || layer.kind === 'image') && <Toggle checked={layer.readable} onChange={(readable) => set({ readable })} label="Keep it readable" />}
      </div>
      {mask && <SlotHint />}
    </div>
  );
}

function SlotHint() {
  return <p className={styles.note}>On the paint slots a layer&rsquo;s colour is one of the car&rsquo;s three paints, so players can recolour the design in game.</p>;
}

function MultiProperties({ layers, mask }: { layers: VinylLayer[]; mask: boolean }) {
  const ids = layers.map((l) => l.id);
  const first = layers[0]!;
  const paints = useProjectStore((s) => s.doc?.paints);
  const slotPaint = (i: number) => paints?.list.find((x) => x.id === paints.defaults[i]);
  return (
    <div className={styles.toolOptions} data-testid="vinyl-multi">
      <span className={styles.muted}>{layers.length} layers: they move, turn and resize together.</span>
      <div className={styles.row}>
        <IconButton icon={AlignStartVertical} size="sm" label="Line up left edges" onClick={() => alignLayers(ids, 'left')} />
        <IconButton icon={AlignCenterVertical} size="sm" label="Line up centres (across)" onClick={() => alignLayers(ids, 'centre')} />
        <IconButton icon={AlignEndVertical} size="sm" label="Line up right edges" onClick={() => alignLayers(ids, 'right')} />
        <IconButton icon={AlignStartHorizontal} size="sm" label="Line up tops" onClick={() => alignLayers(ids, 'top')} />
        <IconButton icon={AlignCenterHorizontal} size="sm" label="Line up middles (up)" onClick={() => alignLayers(ids, 'middle')} />
        <IconButton icon={AlignEndHorizontal} size="sm" label="Line up bottoms" onClick={() => alignLayers(ids, 'bottom')} />
      </div>
      <Field label="Colour for all">
        {mask ? (
          <div className={styles.row}>
            {[0, 1, 2].map((i) => (
              <Button key={i} size="sm" variant="ghost" onClick={() => updateLayers(ids, { slot: i })}>
                <Swatch paint={slotPaint(i)} /> {i + 1}
              </Button>
            ))}
          </div>
        ) : (
          <ColorInput value={first.color} onChange={(color) => updateLayers(ids, { color })} label="Colour for all" />
        )}
      </Field>
      <Field label="Opacity for all">
        <Slider value={first.opacity} onChange={(opacity) => updateLayers(ids, { opacity }, `vmulti:${ids.join(',')}:opacity`)} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} aria-label="Opacity for all" />
      </Field>
      <div className={styles.row}>
        <Toggle checked={layers.every((l) => l.mirror)} onChange={(mirror) => updateLayers(ids, { mirror })} label="Mirror on the other side" />
        <Button size="sm" variant="ghost" onClick={() => updateLayers(ids, { visible: !first.visible })}>
          {first.visible ? 'Hide all' : 'Show all'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => updateLayers(ids, { locked: !first.locked })}>
          {first.locked ? 'Unlock all' : 'Lock all'}
        </Button>
      </div>
    </div>
  );
}
