import { z } from 'zod';

/**
 * `.jbforge` project document (SPEC §2).
 *
 * VERSIONING RULE: any change to the persisted shape bumps
 * CURRENT_PROJECT_VERSION, adds a migration in `migrations.ts`, and adds a
 * fixture under `tests/fixtures/jbforge/` that must keep loading forever.
 *
 * Sections owned by later phases are placeholders (`unknown` entries). A phase
 * that gives a section real structure while it is still always empty on disk
 * may tighten the type without a migration; anything else needs one.
 */
export const PROJECT_FORMAT = 'jbforge';
export const CURRENT_PROJECT_VERSION = 1;

export const SLUG_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const ProjectMetaSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(SLUG_PATTERN, 'slug must be lowercase letters, digits and single underscores'),
  author: z.string(),
  description: z.string(),
  brand: z.string(),
  type: z.string(),
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
});

const placeholderList = z.array(z.unknown());
const placeholderMap = z.record(z.string(), z.unknown());

export const ProjectV1Schema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(1),
  appVersion: z.string(),
  meta: ProjectMetaSchema,
  sources: placeholderList, // Phase 3: source mesh paths
  splits: placeholderList, // Phase 3: non-destructive face-index groups
  assignments: placeholderMap, // Phase 3: mesh → taxonomy part
  proxy: placeholderMap, // Phase 4: settings + cached proxy geometry
  nodes: placeholderList, // Phase 4
  beams: placeholderList, // Phase 4
  tris: placeholderList, // Phase 4
  materials: placeholderList, // Phase 8
  hinges: placeholderList, // Phase 9
  suspension: placeholderMap, // Phase 10
  powertrain: placeholderMap, // Phase 11
  configs: placeholderList, // Phase 13
  variables: placeholderList, // Phase 12
});

export const ProjectSchema = ProjectV1Schema;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
