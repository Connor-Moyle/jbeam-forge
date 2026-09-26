import { useId, useState } from 'react';
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

/** info.json "Type" values seen in official vehicles (docs/beamng-vehicle-layout.md). */
const VEHICLE_TYPES = [
  { value: 'Car', label: 'Car' },
  { value: 'Truck', label: 'Truck' },
  { value: 'Trailer', label: 'Trailer' },
  { value: 'Prop', label: 'Prop' },
] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number]['value'];

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
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  // Like the slug: follow the saved author (which may load after mount) until the user types.
  const [authorDraft, setAuthorDraft] = useState<string | null>(null);
  const author = authorDraft ?? savedAuthor;
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [type, setType] = useState<VehicleType>('Car');
  const [showErrors, setShowErrors] = useState(false);
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
    void newProject({ name: name.trim(), slug: effectiveSlug, author: trimmedAuthor, description: description.trim(), brand: brand.trim(), type }).then((ok) => {
      setBusy(false);
      if (ok) onClose();
    });
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="New mod"
      description="Describe the vehicle. Everything here can be changed later; the slug becomes the in-game folder name."
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
        <FieldGroup title="Vehicle">
          <Field label="Display name" htmlFor={ids.name} hint={showErrors && nameProblem ? nameProblem : 'Shown in the vehicle selector.'}>
            <Input id={ids.name} autoFocus value={name} onChange={(e) => setName(e.target.value)} invalid={showErrors && !!nameProblem} placeholder="e.g. Hirochi Sunburst Test" data-testid="newmod-name" />
          </Field>
          <Field label="Slug" htmlFor={ids.slug} hint={(showErrors || slugTouched) && slugError ? slugError : `vehicles/${effectiveSlug || '…'}/ inside the mod.`}>
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
          <Field label="Type">
            <Select aria-label="Vehicle type" value={type} onChange={setType} options={VEHICLE_TYPES} />
          </Field>
          <Field label="Description" htmlFor={ids.desc}>
            <Textarea id={ids.desc} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </FieldGroup>
        <FieldGroup title="You">
          <Field label="Author" htmlFor={ids.author} hint="Remembered for every new mod.">
            <Input id={ids.author} value={author} onChange={(e) => setAuthorDraft(e.target.value)} placeholder="e.g. Fatkiwi" data-testid="newmod-author" />
          </Field>
        </FieldGroup>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
