import type { ContentKind, InstalledContent } from './manifest';

/** What the Downloads window shows and the main process reports. */

export interface ContentProgress {
  kind: ContentKind;
  /** Items finished (installed or failed) of the total. */
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  current: string | null;
  failed: { id: string; name: string; error: string }[];
  state: 'running' | 'finished' | 'cancelled';
}

export interface ContentStatus {
  kind: ContentKind;
  dir: string;
  installed: InstalledContent;
  busy: boolean;
}

export interface ContentRef {
  name: string;
  /** "branch" is the latest content; tags are versions. */
  type: 'branch' | 'tag';
}

export interface DownloadResult {
  installed: string[];
  skipped: string[];
  failed: { id: string; name: string; error: string }[];
  cancelled: boolean;
}

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  /** SHA-256 GitHub lists for it (newer releases), checked after download. */
  sha256: string | null;
  /** What it is, for the buttons. */
  role: 'installer' | 'portable' | 'textures' | 'meshes' | 'other';
}

export interface AppRelease {
  tag: string;
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

export interface ContentInfo {
  /** The folder downloads go to, the folder that was wanted, and whether it had to fall back. */
  root: string;
  preferred: string;
  fallback: boolean;
  textures: ContentStatus;
  meshes: ContentStatus;
  scripts: ContentStatus;
}

/** The copy of the content repository that new content is published from. */
export interface PublishStatus {
  dir: string | null;
  ok: boolean;
  /** Why it can't be used yet. */
  problem: string | null;
  /** Files changed since the last publish. */
  changed?: number;
  branch?: string;
  remote?: string;
}

export interface UpdatesInfo {
  current: string;
  /** Running as the portable exe (updates are a new exe, not an installer). */
  portable: boolean;
  platform: string;
  releases: AppRelease[];
  downloaded: { name: string; size: number }[];
}
