import { z } from 'zod';

/**
 * The two optional content repositories the app downloads from: textures
 * (the materials pack) and meshes (the objects pack). Each is a GitHub
 * repository holding
 *   manifest.json            what's in it (this schema)
 *   items/<id>.zip           one material or object folder each
 * and tagged per release, so any earlier version can be downloaded again.
 * An item unpacks to <content folder>/<kind>/<dir>/, the same layout the
 * packs always had, so ids (and projects using them) stay the same.
 */

export const CONTENT_KINDS = ['textures', 'meshes', 'scripts'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_FORMAT = 1;

const SHA256 = /^[0-9a-f]{64}$/;
/** Characters Windows (and so every OS) refuses in a file name, and control characters. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what's refused
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** A relative folder that can't escape its root or trip Windows: no "..", no hidden or reserved names. */
export function isSafeDir(dir: string): boolean {
  const parts = dir.split('/');
  return (
    parts.length >= 1 &&
    parts.length <= 6 &&
    parts.every((p) => p.length > 0 && p.length <= 100 && !BAD_CHARS.test(p) && !RESERVED.test(p) && !p.startsWith('.') && !p.endsWith('.') && p.trim() === p)
  );
}

export const ContentItemSchema = z.object({
  /** Stable id: lower-case, digits, dot, dash, underscore. */
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  name: z.string().min(1).max(120),
  category: z.string().max(80),
  /** Sub-group (objects: the kind of part). */
  group: z.string().max(80).optional(),
  /** Where it unpacks, relative to the kind's folder ("Paint/Candy Red"). */
  dir: z.string().refine(isSafeDir, 'unsafe folder name'),
  /** The zip, relative to the repository root. */
  path: z.string().regex(/^items\/[a-z0-9][a-z0-9._-]{0,127}\.zip$/),
  /** Zip size in bytes, and its SHA-256: a download must match both. */
  size: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  sha256: z.string().regex(SHA256),
  /** Files and total unpacked bytes inside (for the size shown and a sanity limit when unpacking). */
  files: z.number().int().positive().max(10_000),
  unpacked: z.number().int().positive(),
});

export type ContentItem = z.infer<typeof ContentItemSchema>;

export const ContentManifestSchema = z.object({
  format: z.literal(CONTENT_FORMAT),
  kind: z.enum(CONTENT_KINDS),
  /** The content's own version ("2026.09.29"); tags are v<version>. */
  version: z.string().min(1).max(40),
  generated: z.string(),
  items: z.array(ContentItemSchema).max(50_000),
});

export type ContentManifest = z.infer<typeof ContentManifestSchema>;

/** What's installed of one kind: the version it came from and each item's zip hash. */
export const InstalledContentSchema = z.object({
  format: z.literal(CONTENT_FORMAT),
  kind: z.enum(CONTENT_KINDS),
  /** Repository, ref (branch or tag) and version of the last successful download. */
  repo: z.string(),
  ref: z.string(),
  version: z.string(),
  /** Each item's zip hash and where it came from (an item can be from another version than the rest). */
  items: z.record(z.string(), z.object({ sha256: z.string(), dir: z.string(), size: z.number(), installedAt: z.string(), ref: z.string().optional(), version: z.string().optional() })),
});

export type InstalledContent = z.infer<typeof InstalledContentSchema>;

export function emptyInstalled(kind: ContentKind): InstalledContent {
  return { format: CONTENT_FORMAT, kind, repo: '', ref: '', version: '', items: {} };
}

/** A manifest's problems beyond its shape: duplicate ids, zip paths or folders. */
export function manifestProblems(m: ContentManifest): string[] {
  const out: string[] = [];
  const seen = (key: (i: ContentItem) => string, what: string) => {
    const s = new Set<string>();
    for (const i of m.items) {
      const k = key(i).toLowerCase();
      if (s.has(k)) out.push(`duplicate ${what}: ${key(i)}`);
      s.add(k);
    }
  };
  seen((i) => i.id, 'id');
  seen((i) => i.path, 'zip');
  seen((i) => i.dir, 'folder');
  // One item's folder inside another's would unpack over it.
  const dirs = m.items.map((i) => `${i.dir.toLowerCase()}/`).sort();
  for (let k = 1; k < dirs.length; k++) if (dirs[k]!.startsWith(dirs[k - 1]!)) out.push(`folder inside another: ${dirs[k]}`);
  return out;
}

export interface DownloadPlan {
  /** Items to download: missing, or changed since they were installed. */
  fetch: ContentItem[];
  /** Already up to date. */
  current: ContentItem[];
  bytes: number;
}

/** Which of `ids` (or every item) need downloading. */
export function planDownload(m: ContentManifest, installed: InstalledContent, ids: readonly string[] | 'all'): DownloadPlan {
  const pick = ids === 'all' ? null : new Set(ids);
  const want = pick ? m.items.filter((i) => pick.has(i.id)) : m.items;
  const fetch: ContentItem[] = [];
  const current: ContentItem[] = [];
  for (const i of want) (installed.items[i.id]?.sha256 === i.sha256 ? current : fetch).push(i);
  return { fetch, current, bytes: fetch.reduce((n, i) => n + i.size, 0) };
}

/** Installed items the manifest no longer has, or has changed ("update available"). */
export function contentChanges(m: ContentManifest, installed: InstalledContent): { updated: string[]; removed: string[] } {
  const byId = new Map(m.items.map((i) => [i.id, i]));
  const updated: string[] = [];
  const removed: string[] = [];
  for (const [id, it] of Object.entries(installed.items)) {
    const now = byId.get(id);
    if (!now) removed.push(id);
    else if (now.sha256 !== it.sha256) updated.push(id);
  }
  return { updated, removed };
}

/**
 * "owner/name" of a GitHub repository, optionally followed by a folder inside it
 * ("Connor-Moyle/jbeam-forge-content/textures"): one repository can hold every kind.
 */
export const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){0,3}$/;

/** A repository setting split into the repository and the folder inside it ('' for its root). */
export function splitRepo(spec: string): { repo: string; folder: string } {
  const [owner = '', name = '', ...rest] = spec.split('/');
  return { repo: `${owner}/${name}`, folder: rest.join('/') };
}

/** Branch or tag names we accept in a URL. */
export const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export function isSafeRef(ref: string): boolean {
  return REF_PATTERN.test(ref) && !ref.includes('..') && !ref.endsWith('/');
}
