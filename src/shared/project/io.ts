import type { z } from 'zod';
import {
  CURRENT_PROJECT_VERSION,
  PROJECT_FORMAT,
  ProjectSchema,
  type Project,
  type ProjectMeta,
} from './schema';
import { MIGRATIONS, MigrationError, runMigrations, type Migration, type RawDoc } from './migrations';

export type ProjectLoadErrorCode =
  | 'INVALID_JSON'
  | 'NOT_A_PROJECT'
  | 'FUTURE_VERSION'
  | 'MIGRATION_MISSING'
  | 'MIGRATION_FAILED'
  | 'INVALID_SCHEMA';

export class ProjectLoadError extends Error {
  constructor(
    message: string,
    readonly code: ProjectLoadErrorCode,
  ) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

export interface ParseOptions<T> {
  /** Overridable for tests; defaults to the real registry/version/schema. */
  migrations?: readonly Migration[];
  currentVersion?: number;
  schema?: z.ZodType<T>;
}

export interface ParsedProject<T = Project> {
  project: T;
  /** Version found on disk, or null if it was already current. */
  migratedFrom: number | null;
  applied: string[];
}

export function parseProject<T = Project>(text: string, opts: ParseOptions<T> = {}): ParsedProject<T> {
  const currentVersion = opts.currentVersion ?? CURRENT_PROJECT_VERSION;
  const schema = (opts.schema ?? ProjectSchema) as z.ZodType<T>;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ProjectLoadError(`Project file is not valid JSON: ${(err as Error).message}`, 'INVALID_JSON');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProjectLoadError('Project file does not contain a JSON object', 'NOT_A_PROJECT');
  }
  const doc = raw as RawDoc;
  if (doc.format !== PROJECT_FORMAT) {
    throw new ProjectLoadError(`Not a .jbforge project (format = ${JSON.stringify(doc.format)})`, 'NOT_A_PROJECT');
  }
  const version = doc.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new ProjectLoadError(`Invalid formatVersion ${JSON.stringify(version)}`, 'NOT_A_PROJECT');
  }
  if (version > currentVersion) {
    throw new ProjectLoadError(
      `This project was saved by a newer JBeam Forge (format v${version}; this app reads up to v${currentVersion}). Update the app to open it.`,
      'FUTURE_VERSION',
    );
  }

  let migrated = doc;
  let applied: string[] = [];
  if (version < currentVersion) {
    try {
      ({ doc: migrated, applied } = runMigrations(doc, version, currentVersion, opts.migrations ?? MIGRATIONS));
    } catch (err) {
      if (err instanceof MigrationError) throw new ProjectLoadError(err.message, err.code);
      throw err;
    }
  }

  const result = schema.safeParse(migrated);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? issue.path.join('.') : '(root)';
    throw new ProjectLoadError(`Project failed validation at ${where}: ${issue?.message ?? 'unknown'}`, 'INVALID_SCHEMA');
  }

  return { project: result.data, migratedFrom: version < currentVersion ? version : null, applied };
}

/**
 * Deterministic serialization: validated through the schema (so key order
 * follows the schema definition), 2-space indent, trailing newline.
 */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(ProjectSchema.parse(project), null, 2)}\n`;
}

export interface NewProjectMeta {
  name: string;
  slug: string;
  author?: string;
  description?: string;
  brand?: string;
  type?: string;
}

export function createEmptyProject(meta: NewProjectMeta, appVersion: string, now: Date = new Date()): Project {
  const stamp = now.toISOString();
  const fullMeta: ProjectMeta = {
    name: meta.name,
    slug: meta.slug,
    author: meta.author ?? '',
    description: meta.description ?? '',
    brand: meta.brand ?? '',
    type: meta.type ?? 'Car',
    createdAt: stamp,
    modifiedAt: stamp,
  };
  return ProjectSchema.parse({
    format: PROJECT_FORMAT,
    formatVersion: CURRENT_PROJECT_VERSION,
    appVersion,
    meta: fullMeta,
    sources: [],
    splits: [],
    parts: [],
    assignments: {},
    ignoredMeshes: [],
    customTaxonomy: [],
    proxy: { parts: {}, refNodes: null },
    nodes: [],
    beams: [],
    tris: [],
    materials: [],
    hinges: [],
    suspension: {},
    powertrain: {},
    configs: [],
    variables: [],
  });
}
