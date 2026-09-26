import { useState } from 'react';
import { AXES, type Axis, type SourceFormat } from '@shared/project/schema';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Modal } from '@renderer/ui/components/Modal';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { defaultSettings, type StagedImport } from './pipeline';
import type { ImportSettings } from './normalize';
import { dimensionsFor, SCALE_PRESETS, sizeAdvice } from './sizeCheck';
import styles from './ImportDialog.module.css';

const FORMAT_NOTES: Record<SourceFormat, string> = {
  dae: 'COLLADA is BeamNG’s own mesh format: node names become mesh names, and the file is exported as-is later.',
  fbx: 'FBX units vary between tools — check the size readout below before importing.',
  obj: 'OBJ materials come from its .mtl file next to it.',
  gltf: 'glTF gives the cleanest material mapping of all formats.',
  glb: 'glTF gives the cleanest material mapping of all formats.',
  stl: 'STL has no UVs or materials: everything imports untextured. UV tools arrive with materials (Phase 8).',
};

const AXIS_OPTIONS = AXES.map((a) => ({ value: a, label: a.replace('-', '−').toUpperCase() }));
const CUSTOM = 'custom';
const SCALE_OPTIONS = [...SCALE_PRESETS.map((p) => ({ value: String(p.value), label: p.label })), { value: CUSTOM, label: 'Custom…' }];

function presetFor(scale: number): string {
  return SCALE_PRESETS.some((p) => p.value === scale) ? String(scale) : CUSTOM;
}

export interface ImportDialogProps {
  staged: StagedImport;
  onCancel: () => void;
  onConfirm: (settings: ImportSettings) => void;
}

/** Import settings with a live size readout (SPEC §4.2: FBX import-scale dialog, for every format). */
export function ImportDialog({ staged, onCancel, onConfirm }: ImportDialogProps) {
  const defaults = defaultSettings(staged.format);
  const [scale, setScale] = useState(defaults.scale);
  const [scaleChoice, setScaleChoice] = useState(presetFor(defaults.scale));
  const [up, setUp] = useState<Axis>(defaults.upAxis);
  const [forward, setForward] = useState<Axis>(defaults.forwardAxis);

  const dims = dimensionsFor(staged.box, up, forward, scale);
  const advice = sizeAdvice(dims, scale);
  const axesOk = up[1] !== forward[1];

  const chooseScale = (v: string) => {
    setScaleChoice(v);
    if (v !== CUSTOM) setScale(Number(v));
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={`Import ${staged.fileName}`}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!axesOk} onClick={() => onConfirm({ scale, upAxis: up, forwardAxis: forward })} data-testid="import-confirm">
            Import
          </Button>
        </>
      }
    >
      <div data-testid="import-dialog">
        <div className={styles.stats}>
          <Badge tone="accent">{staged.format.toUpperCase()}</Badge>
          <span className={styles.stat}>{(staged.bytes / 1e6).toFixed(1)} MB</span>
          <span className={styles.stat}>{staged.baked.length.toLocaleString()} meshes</span>
          <span className={styles.stat}>{staged.triangles.toLocaleString()} triangles</span>
          <span className={styles.stat}>read in {(staged.parseMs / 1000).toFixed(1)} s</span>
        </div>
        <Callout className={styles.note}>{FORMAT_NOTES[staged.format]}</Callout>

        <FieldGroup title="Units & orientation">
          <Field label="Units">
            <Select aria-label="Units" value={scaleChoice} onChange={chooseScale} options={SCALE_OPTIONS} />
            {scaleChoice === CUSTOM && <NumberInput aria-label="Metres per unit" value={scale} onChange={setScale} min={0.000001} max={1000} precision={6} step={0.001} unit="m" />}
          </Field>
          <div className={styles.axes}>
            <Field label="Up axis">
              <Select<Axis> aria-label="Up axis" value={up} onChange={setUp} options={AXIS_OPTIONS} />
            </Field>
            <Field label="Front faces">
              <Select<Axis> aria-label="Forward axis" value={forward} onChange={setForward} options={AXIS_OPTIONS} />
            </Field>
          </div>
        </FieldGroup>

        <FieldGroup title="Resulting size">
          <div className={styles.dims} data-testid="import-dims">
            <span>
              <span className={styles.dimLabel}>Length</span> {dims ? dims.length.toFixed(2) : '—'} m
            </span>
            <span>
              <span className={styles.dimLabel}>Width</span> {dims ? dims.width.toFixed(2) : '—'} m
            </span>
            <span>
              <span className={styles.dimLabel}>Height</span> {dims ? dims.height.toFixed(2) : '—'} m
            </span>
          </div>
          <Callout tone={advice.level === 'ok' ? 'success' : 'warning'}>
            <span data-testid="import-advice">{advice.message}</span>
            {advice.suggestScale !== null && (
              <Button size="sm" className={styles.suggest} onClick={() => chooseScale(String(advice.suggestScale))}>
                Use {SCALE_PRESETS.find((p) => p.value === advice.suggestScale)!.label.toLowerCase()}
              </Button>
            )}
          </Callout>
        </FieldGroup>
      </div>
    </Modal>
  );
}
