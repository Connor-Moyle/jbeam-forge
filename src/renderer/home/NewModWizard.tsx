import { useEffect, useId, useRef, useState } from 'react';
import { SLUG_PATTERN } from '@shared/project/schema';
import { slugify } from '@shared/text';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { Select } from '@renderer/ui/components/Select';
import { Textarea } from '@renderer/ui/components/Textarea';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { call } from '@renderer/diagnostics/ipc';
import { newProject } from '@renderer/project/actions';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { startImport } from '@renderer/import/importFlow';
import { CarFront, CircleDot, Disc3, Gauge, PanelTop, type LucideIcon } from 'lucide-react';
import styles from './NewModWizard.module.css';

/** info.json "Type" values seen in official vehicles (docs/beamng-vehicle-layout.md). */
const VEHICLE_TYPES = [
  { value: 'Car', label: 'Car' },
  { value: 'Truck', label: 'Truck' },
  { value: 'Trailer', label: 'Trailer' },
  { value: 'Prop', label: 'Prop' },
] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number]['value'];

type ModKind = 'vehicle' | 'engine' | 'tyres' | 'wheels' | 'panel';

/** What a mod can be (fork): each opens on its own workspace. */
const KINDS: { value: ModKind; label: string; icon: LucideIcon; text: string; name: string }[] = [
  { value: 'vehicle', label: 'Vehicle', icon: CarFront, text: 'A whole car, truck or trailer from a 3D model: parts, structure, engine, everything.', name: 'e.g. Hirochi Sunburst Test' },
  { value: 'engine', label: 'Engine', icon: Gauge, text: 'A new engine for cars already in the game: start from one of theirs and change power, revs, sound, turbo…', name: 'e.g. Big Turbo V8' },
  { value: 'tyres', label: 'Tyres', icon: CircleDot, text: 'Universal tyres in any sizes, with your own grip and pressure: every car with rims that fit can use them.', name: 'e.g. Forge Sport 2' },
  { value: 'wheels', label: 'Wheels', icon: Disc3, text: 'Universal rims: pick diameter, width and lugs; they fit every car with the right hubs and take the matching tyres.', name: 'e.g. Forge 5-spoke' },
  { value: 'panel', label: 'Body panel', icon: PanelTop, text: 'A new hood, bumper, door, spoiler… for a car in the game: your model on the stock part’s physics.', name: 'e.g. Vented Hood' },
];

/** Where the slug shows up in the mod, for each kind. */
function slugHint(kind: ModKind, slug: string): string {
  switch (kind) {
    case 'vehicle':
      return `vehicles/${slug}/ inside the mod.`;
    case 'engine':
      return `The new engine part is ${slug}_…, beside each car it fits.`;
    case 'panel':
      return `The new panel is ${slug}_…, beside its car; its model goes in vehicles/common/${slug}/.`;
    default:
      return `vehicles/common/${slug}/ inside the mod, for every car.`;
  }
}

export function slugProblem(slug: string): string | null {
  if (!slug) return 'Required.';
  if (!SLUG_PATTERN.test(slug)) return 'Lowercase letters, digits and single underscores only (e.g. my_car).';
  if (slug.length > 64) return 'Keep it under 64 characters.';
  return null;
}

/** New Mod wizard (SPEC §4.1). The author is remembered after the first time. */
export function NewModWizard({ onClose }: { onClose: () => void }) {
  const ids = { name: useId(), slug: useId(), author: useId(), desc: useId(), brand: useId() };
  const savedAuthor = useSettingsStore((s) => s.settings?.author ?? '');
  const [name, setName] = useState('');
  // Focus the name without scrolling, so the kinds of mod above it stay in view.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, []);
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  // Like the slug: follow the saved author (which may load after mount) until the user types.
  const [authorDraft, setAuthorDraft] = useState<string | null>(null);
  const author = authorDraft ?? savedAuthor;
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [type, setType] = useState<VehicleType>('Car');
  const [kind, setKind] = useState<ModKind>('vehicle');
  const k = KINDS.find((x) => x.value === kind)!;
  const [showErrors, setShowErrors] = useState(false);
  const [importNow, setImportNow] = useState(true);
  const [autoReimport, setAutoReimport] = useState<boolean | null>(null);
  const [ddsConvert, setDdsConvert] = useState<boolean | null>(null);
  const defaults = useSettingsStore((s) => s.settings);
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const nameProblem = name.trim() ? null : 'Required.';
  const slugError = slugProblem(effectiveSlug);
  const valid = !nameProblem && !slugError;

  const create = () => {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    const trimmedAuthor = author.trim();
    if (authorDraft !== null && trimmedAuthor !== savedAuthor) call('settings:update', { author: trimmedAuthor || null }).catch(() => undefined);
    void newProject({ name: name.trim(), slug: effectiveSlug, author: trimmedAuthor, description: description.trim(), brand: brand.trim(), type, modKind: kind, autoReimport: autoReimport ?? defaults?.autoReimport ?? true, ddsConvert: ddsConvert ?? defaults?.ddsConvert ?? false }).then((ok) => {
      setBusy(false);
      if (!ok) return;
      onClose();
      if (importNow && kind !== 'engine' && kind !== 'panel') void startImport();
    });
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="New mod"
      size="lg"
      description="What are you making? Everything here can be changed later; the slug becomes the in-game folder name."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={busy} data-testid="newmod-create">
            Create
          </Button>
        </>
      }
    >
      <form
        data-testid="newmod-wizard"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className={styles.kinds} role="radiogroup" aria-label="What are you making?">
          {KINDS.map((x) => (
            <button key={x.value} type="button" role="radio" aria-checked={kind === x.value} className={kind === x.value ? styles.kindOn : styles.kind} onClick={() => setKind(x.value)} data-testid={`newmod-kind-${x.value}`}>
              <x.icon aria-hidden />
              <span className={styles.kindLabel}>{x.label}</span>
              <span className={styles.kindText}>{x.text}</span>
            </button>
          ))}
        </div>
        <FieldGroup title={k.label}>
          <Field label="Display name" htmlFor={ids.name} hint={showErrors && nameProblem ? nameProblem : kind === 'vehicle' ? 'Shown in the vehicle selector.' : 'Shown in the parts menu of the cars it fits.'}>
            <Input id={ids.name} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} invalid={showErrors && !!nameProblem} placeholder={k.name} data-testid="newmod-name" />
          </Field>
          <Field label="Slug" htmlFor={ids.slug} hint={(showErrors || slugTouched) && slugError ? slugError : slugHint(kind, effectiveSlug || '…')}>
            <Input
              id={ids.slug}
              mono
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              invalid={(showErrors || slugTouched) && !!slugError}
              data-testid="newmod-slug"
            />
          </Field>
          <Field label="Brand" htmlFor={ids.brand}>
            <Input id={ids.brand} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Hirochi" />
          </Field>
          {kind === 'vehicle' && (
            <Field label="Type">
              <Select aria-label="Vehicle type" value={type} onChange={setType} options={VEHICLE_TYPES} />
            </Field>
          )}
          <Field label="Description" htmlFor={ids.desc}>
            <Textarea id={ids.desc} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </FieldGroup>
        <FieldGroup title="You">
          <Field label="Author" htmlFor={ids.author} hint="Remembered for every new mod.">
            <Input id={ids.author} value={author} onChange={(e) => setAuthorDraft(e.target.value)} placeholder="e.g. Fatkiwi" data-testid="newmod-author" />
          </Field>
        </FieldGroup>
        {kind !== 'engine' && kind !== 'panel' && <Checkbox checked={importNow} onChange={setImportNow} label={kind === 'vehicle' ? 'Import a 3D model right after creating' : `Import the ${kind === 'tyres' ? 'tyre' : 'wheel'}'s 3D model right after creating`} />}
        <Checkbox checked={autoReimport ?? defaults?.autoReimport ?? true} onChange={setAutoReimport} label="Reload the model when its file changes (fix it in Blender, save, and it updates here with your work kept)" data-testid="newmod-autoreimport" />
        <Checkbox checked={ddsConvert ?? defaults?.ddsConvert ?? false} onChange={setDdsConvert} label="Convert textures to DDS when exporting (the game’s own format: smaller and faster to load)" data-testid="newmod-dds" />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
