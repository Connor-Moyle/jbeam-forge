import { useMemo, useState } from 'react';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { Field } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { buildCustomEntry } from '@shared/parts/custom';
import { BEAM_PRESETS, type PositionAxis } from '@shared/taxonomy/schema';
import { addCustomKind } from './commands';
import { useAssignUi } from './assignUi';
import { checkCustomEntry, useTaxonomy } from './taxonomy';
import styles from './CustomPartDialog.module.css';

const AXIS_OPTIONS: { value: PositionAxis; label: string }[] = [
  { value: 'none', label: 'One per vehicle' },
  { value: 'fr', label: 'Front / Rear' },
  { value: 'lr', label: 'Left / Right' },
  { value: 'corner', label: 'Four corners (FL, FR, RL, RR)' },
];

const PRESET_LABELS: Record<(typeof BEAM_PRESETS)[number], string> = {
  structure_stiff: 'Stiff structure',
  panel_metal: 'Metal panel',
  panel_plastic: 'Plastic panel',
  trim_light: 'Light trim',
  glass_brittle: 'Glass',
  mechanical: 'Mechanical',
  tyre_rubber: 'Tyre rubber',
};

/** "Add Custom Part": a new part type for this project or for every project. */
export function CustomPartDialog() {
  const custom = useAssignUi((s) => s.custom);
  const closeCustom = useAssignUi((s) => s.closeCustom);
  if (!custom) return null;
  return <CustomPartForm onDone={closeCustom} />;
}

function CustomPartForm({ onDone }: { onDone: (createdKind?: string) => void }) {
  const tax = useTaxonomy();
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('Exterior Trim');
  const [parent, setParent] = useState('body');
  const [axis, setAxis] = useState<PositionAxis>('none');
  const [openable, setOpenable] = useState(false);
  const [mass, setMass] = useState(1);
  const [preset, setPreset] = useState<(typeof BEAM_PRESETS)[number]>('panel_metal');
  const [scope, setScope] = useState<'project' | 'user'>('project');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => [...new Set(tax.entries.map((e) => e.category))].sort().map((c) => ({ value: c, label: c })), [tax]);
  const parents = useMemo(() => [...tax.entries].sort((a, b) => a.label.localeCompare(b.label)).map((e) => ({ value: e.id, label: `${e.label} (${e.category})` })), [tax]);

  const create = async () => {
    if (!label.trim()) {
      setError('Give the part a name.');
      return;
    }
    const entry = buildCustomEntry({ label, category, parent, positionAxis: axis, openable, defaultMass: mass, beamPreset: preset }, tax.entries);
    const problems = checkCustomEntry(entry);
    if (problems.length) {
      setError(problems.join('\n'));
      return;
    }
    setBusy(true);
    try {
      await addCustomKind(entry, scope);
      onDone(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onDone();
      }}
      title="Add custom part"
      description="A new part type for anything the built-in list doesn't cover."
      footer={
        <>
          <Button onClick={() => onDone()}>Cancel</Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy} data-testid="custom-create">
            Add part type
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Name" htmlFor="custom-label">
          <Input id="custom-label" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ducktail spoiler" data-testid="custom-label" />
        </Field>
        <div className={styles.row}>
          <Field label="Category">
            <Select value={category} onChange={setCategory} options={categories} />
          </Field>
          <Field label="Attaches to">
            <Select value={parent} onChange={setParent} options={parents} />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Positions">
            <Select value={axis} onChange={setAxis} options={AXIS_OPTIONS} />
          </Field>
          <Field label="Beam preset">
            <Select value={preset} onChange={setPreset} options={BEAM_PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))} />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Default mass">
            <NumberInput value={mass} onChange={setMass} min={0.01} max={5000} step={0.5} precision={2} unit="kg" />
          </Field>
          <Field label="Save for">
            <Select
              value={scope}
              onChange={setScope}
              options={[
                { value: 'project', label: 'This project' },
                { value: 'user', label: 'All my projects' },
              ]}
            />
          </Field>
        </div>
        <Checkbox checked={openable} onChange={setOpenable} label="Opens (door, hatch, lid): gets a hinge and latch later" />
        {error && (
          <Callout tone="danger" className={styles.error}>
            {error}
          </Callout>
        )}
      </div>
    </Modal>
  );
}
