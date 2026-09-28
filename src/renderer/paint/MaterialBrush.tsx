import { Eraser, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MATERIAL_PRESETS } from '@shared/materials/presets';
import { WEAVES } from '@shared/paints/weave';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { cx } from '@renderer/ui/cx';
import { addPresetMaterial, addWeaveMaterial, clearMaterialFaces, paintedCounts, QUICK_PRESETS, setWeaveSize } from './facePaint';
import { usePainter, type FaceMode } from './painter';
import { hex } from './PaintsPanel';
import styles from './PaintsPanel.module.css';

/**
 * The material brush: pick a material (or add carbon fibre, Kevlar, chrome…)
 * and drag over the car to lay it on. The area is the triangles you paint,
 * a smooth area up to its folds, a whole piece or a whole mesh.
 */

const MODES: { value: FaceMode; label: string; hint: string }[] = [
  { value: 'brush', label: 'Brush', hint: 'Drag over the car: everything within the brush' },
  { value: 'smooth', label: 'Smooth area', hint: 'Click: the surface out to where it folds' },
  { value: 'piece', label: 'Whole piece', hint: 'Click: every triangle joined to the one clicked' },
  { value: 'mesh', label: 'Whole mesh', hint: 'Click: the whole mesh' },
  { value: 'erase', label: 'Erase', hint: 'Drag: back to the mesh’s own material' },
];

export function MaterialBrush() {
  const p = usePainter();
  const materials = useProjectStore((s) => s.doc?.materials ?? EMPTY_ARR);
  const faceMaterials = useProjectStore((s) => s.doc?.faceMaterials);
  const counts = useMemo(() => (faceMaterials ? paintedCounts({ faceMaterials }) : new Map<string, number>()), [faceMaterials]);
  const [weaveCm, setWeaveCm] = useState(3);
  const chosen = materials.find((m) => m.id === p.faceMaterialId);
  const woven = chosen?.layers[0]?.maps.detailNormalMap;
  const mode = MODES.find((m) => m.value === p.faceMode)!;
  return (
    <div className={styles.toolOptions} data-testid="material-brush">
      <Field label="Paint with">
        <Select
          value={p.faceMaterialId ?? undefined}
          onChange={(faceMaterialId) => p.set({ faceMaterialId })}
          options={materials.map((m) => ({ value: m.id, label: `${m.name}${counts.get(m.id) ? ` · on ${counts.get(m.id)} triangles` : ''}` }))}
          placeholder={materials.length ? 'Choose a material' : 'Add one below'}
          aria-label="Material to paint with"
        />
      </Field>
      <div className={styles.chips}>
        {WEAVES.map((w) => (
          <button key={w.id} type="button" className={styles.chip} onClick={() => void addWeaveMaterial(w.id)} data-testid={`material-weave-${w.id}`}>
            <span className={styles.swatch} style={{ background: hex(w.tint) }} aria-hidden />
            {w.name}
          </button>
        ))}
        {QUICK_PRESETS.map((id) => {
          const preset = MATERIAL_PRESETS.find((x) => x.id === id)!;
          return (
            <button key={id} type="button" className={styles.chip} onClick={() => addPresetMaterial(id)} data-testid={`material-preset-${id}`}>
              <span className={styles.swatch} style={{ background: hex(preset.def.layers?.[0]?.baseColor ?? [0.5, 0.5, 0.5]) }} aria-hidden />
              {preset.name.replace(/ \(.*\)$/, '')}
            </button>
          );
        })}
      </div>
      <div className={styles.segment} role="radiogroup" aria-label="Area to paint">
        {MODES.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={p.faceMode === m.value} className={cx(styles.segButton, p.faceMode === m.value && styles.segOn)} onClick={() => p.set({ faceMode: m.value })} title={m.hint} data-testid={`material-mode-${m.value}`}>
            {m.value === 'erase' ? <Eraser aria-hidden className={styles.icon} /> : null}
            {m.label}
          </button>
        ))}
      </div>
      <p className={styles.note}>{mode.hint}.</p>
      {(p.faceMode === 'brush' || p.faceMode === 'erase') && (
        <Field label="Brush size">
          <Slider value={p.size} onChange={(size) => p.set({ size })} min={0.5} max={100} step={0.5} format={(v) => `${v.toFixed(1)} cm`} aria-label="Material brush size" />
        </Field>
      )}
      {p.faceMode === 'smooth' && (
        <Field label="Stop at folds sharper than" hint="Lower keeps to flatter areas; higher runs round curves">
          <Slider value={p.faceAngle} onChange={(faceAngle) => p.set({ faceAngle })} min={2} max={80} step={1} format={(v) => `${Math.round(v)}°`} aria-label="Fold angle" />
        </Field>
      )}
      {chosen && woven && (
        <Field label="Weave size" hint="Width of four tows on the car">
          <Slider
            value={weaveCm}
            onChange={(v) => {
              setWeaveCm(v);
              setWeaveSize(chosen, v);
            }}
            min={0.8}
            max={12}
            step={0.1}
            format={(v) => `${v.toFixed(1)} cm`}
            aria-label="Weave size"
          />
        </Field>
      )}
      {chosen && !!counts.get(chosen.id) && (
        <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => clearMaterialFaces(chosen.id)}>
          Take {chosen.name} off the car
        </Button>
      )}
      <p className={styles.note}>The game gives each triangle one material, so the painted area follows the mesh&rsquo;s triangles (denser meshes give finer edges). It&rsquo;s exported as the real material, with its own textures, shine and clear coat. Mirror paints both sides.</p>
    </div>
  );
}
