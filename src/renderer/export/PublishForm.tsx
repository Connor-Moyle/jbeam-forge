import { useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { PublishListing } from '@shared/ipc-contract';
import { useProjectStore } from '@renderer/app/stores/project';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Textarea } from '@renderer/ui/components/Textarea';
import type { PreparedExport } from './exportFlow';
import { checkLine, parseTags, publishChecklist } from './publish';
import styles from './ExportDialog.module.css';

/** The listing for the BeamNG repository, with the checks reviewers look for. Reports the listing up as it's edited. */
export function PublishForm({ prepared, onChange }: { prepared: PreparedExport; onChange: (listing: PublishListing) => void }) {
  const doc = useProjectStore((s) => s.doc);
  const [title, setTitle] = useState(doc?.meta.name ?? '');
  const [tagline, setTagline] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState(doc?.meta.description ?? '');
  const [tags, setTags] = useState(['vehicle', doc?.meta.type ?? ''].filter(Boolean).join(', ').toLowerCase());

  const checks = useMemo(() => (doc ? publishChecklist(doc, prepared.report, prepared.bundle, { title, description, version }) : []), [doc, prepared, title, description, version]);
  const listing = useMemo<PublishListing>(() => ({ title: title.trim() || 'Untitled', tagline: tagline.trim(), version: version.trim() || '1.0', description: description.trim(), tags: parseTags(tags), checklist: checks.map(checkLine) }), [title, tagline, version, description, tags, checks]);
  useEffect(() => onChange(listing), [listing, onChange]);

  return (
    <div className={styles.body} data-testid="publish-form">
      <FieldGroup title="Listing">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="publish-title" />
        </Field>
        <Field label="Tagline" hint="One line under the title on the repository page">
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} data-testid="publish-tagline" />
        </Field>
        <Field label="Version">
          <Input value={version} onChange={(e) => setVersion(e.target.value)} data-testid="publish-version" />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} data-testid="publish-description" />
        </Field>
        <Field label="Tags" hint="Comma separated">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} data-testid="publish-tags" />
        </Field>
      </FieldGroup>
      <FieldGroup title="Checklist">
        <ul className={styles.checks} data-testid="publish-checks">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? styles.ok : styles.bad}>
              {c.ok ? <Check size={14} /> : <X size={14} />} {c.label}
            </li>
          ))}
        </ul>
      </FieldGroup>
      <p className={styles.note}>Writes a folder with the mod zip, a pictures folder (the configuration previews) and the listing text as README.md and description.txt, ready to upload.</p>
    </div>
  );
}
