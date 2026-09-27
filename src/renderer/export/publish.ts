import type { ExportBundle, PublishListing } from '@shared/ipc-contract';
import type { ValidationReport } from '@shared/export/validate';
import type { Project } from '@shared/project/schema';
import { configFileName } from '@shared/export/configs';

/**
 * Getting a mod ready for the BeamNG repository: the listing text and a
 * checklist of what reviewers look for, run against the prepared export.
 */

export interface PublishCheck {
  ok: boolean;
  label: string;
}

export function publishChecklist(doc: Pick<Project, 'meta' | 'configs'>, report: Pick<ValidationReport, 'errors' | 'warnings'>, bundle: Pick<ExportBundle, 'slug' | 'files'>, listing: Pick<PublishListing, 'title' | 'description' | 'version'>): PublishCheck[] {
  const has = (path: string) => bundle.files.some((f) => f.path === path);
  const root = `vehicles/${bundle.slug}`;
  const configs = [null, ...doc.configs].map((c) => configFileName(c));
  const missingPreviews = configs.filter((c) => !has(`${root}/${c}.jpg`));
  return [
    { ok: report.errors.length === 0, label: report.errors.length ? `${report.errors.length} validation errors` : 'Validation passed' },
    { ok: report.warnings.length === 0, label: report.warnings.length ? `${report.warnings.length} warnings to look over` : 'No warnings' },
    { ok: missingPreviews.length === 0, label: missingPreviews.length ? `No preview picture for ${missingPreviews.join(', ')}` : `A preview picture for every configuration (${configs.length})` },
    { ok: doc.meta.author.trim().length > 0, label: doc.meta.author.trim() ? `Author: ${doc.meta.author.trim()}` : 'No author set' },
    { ok: listing.title.trim().length > 0, label: listing.title.trim() ? 'Title set' : 'No title' },
    { ok: listing.description.trim().length >= 40, label: listing.description.trim().length >= 40 ? 'Description written' : 'Description is short (under 40 characters)' },
    { ok: /^\d+(\.\d+)*$/.test(listing.version.trim()), label: /^\d+(\.\d+)*$/.test(listing.version.trim()) ? `Version ${listing.version.trim()}` : 'Version should be numbers like 1.0' },
  ];
}

/** Tags from a comma-separated field: trimmed, lower-case, no repeats. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}

export const checkLine = (c: PublishCheck) => `${c.ok ? '✓' : '✗'} ${c.label}`;
