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
export const CURRENT_PROJECT_VERSION = 2;

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

// ---------------------------------------------------------------- v2 (Phase 3)

export const SOURCE_FORMATS = ['dae', 'fbx', 'obj', 'gltf', 'glb', 'stl'] as const;
export const AXES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
export const CONSTRUCTION_MATERIALS = ['steel', 'aluminium', 'carbon', 'fibreglass', 'plastic'] as const;

/** A mesh file the project was built from. Geometry is re-read on open, never stored. */
export const SourceSchema = z.object({
  id: z.string().min(1),
  /** Relative to the project file's folder (forward slashes) when possible. */
  path: z.string().min(1),
  /** Absolute path at the time it was added; fallback if the project moved. */
  absolutePath: z.string().min(1),
  format: z.enum(SOURCE_FORMATS),
  import: z.object({
    /** Metres per source unit (1 = metres, 0.01 = centimetres, 0.0254 = inches). */
    scale: z.number().positive(),
    /** Source axis that becomes BeamNG +Z (up). */
    upAxis: z.enum(AXES),
    /** Source axis the vehicle's front faces; becomes BeamNG −Y. */
    forwardAxis: z.enum(AXES),
  }),
  addedAt: z.iso.datetime(),
});

/**
 * A non-destructive split: triangles of one source mesh carved into a new
 * mesh. Triangles are stored as [start, count] runs of triangle indices.
 */
export const SplitSchema = z.object({
  id: z.string().min(1),
  /** Mesh key of the mesh being split (may itself be a split's key). */
  meshKey: z.string().min(1),
  name: z.string().min(1),
  triangleRuns: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().positive()])),
});

export const PartSchema = z.object({
  id: z.string().min(1),
  /** Taxonomy entry this part instantiates (built-in, user or project custom). */
  taxonomyId: z.string().min(1),
  /** jbeam part name / slot identity; unique in the project. */
  name: z.string().min(1),
  displayName: z.string(),
  position: z.string().nullable(),
  parentPartId: z.string().nullable(),
  /** Set when this part is a variant of another (shares its slotType). */
  variantOf: z.string().nullable(),
  price: z.number().nonnegative(),
  description: z.string(),
  constructionMaterial: z.enum(CONSTRUCTION_MATERIALS),
});

/** Project-local taxonomy entries (from "Add Custom Part"). Shape is validated by the taxonomy module. */
const CustomTaxonomyEntry = z.record(z.string(), z.unknown());

export const ProjectV2Schema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(2),
  appVersion: z.string(),
  meta: ProjectMetaSchema,
  sources: z.array(SourceSchema),
  splits: z.array(SplitSchema),
  parts: z.array(PartSchema),
  /** meshKey → partId */
  assignments: z.record(z.string(), z.string()),
  /** meshKeys the user chose to ignore (not exported). */
  ignoredMeshes: z.array(z.string()),
  customTaxonomy: z.array(CustomTaxonomyEntry),
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

export const ProjectSchema = ProjectV2Schema;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Split = z.infer<typeof SplitSchema>;
export type Part = z.infer<typeof PartSchema>;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export type Axis = (typeof AXES)[number];
export type ConstructionMaterial = (typeof CONSTRUCTION_MATERIALS)[number];
