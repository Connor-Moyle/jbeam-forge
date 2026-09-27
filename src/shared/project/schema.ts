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
export const CURRENT_PROJECT_VERSION = 5;

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

// ---------------------------------------------------------------- v3 (Phase 3)
// v2 (3a) added sources/splits/parts/assignments; v3 (3b) adds Source.textureDirs.

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
    /** Loader-space axis that becomes BeamNG +Z (up). See src/shared/coords.ts. */
    upAxis: z.enum(AXES),
    /** Loader-space axis the vehicle's front faces; becomes BeamNG −Y. */
    forwardAxis: z.enum(AXES),
  }),
  /** Extra folders searched for this source's textures ("Locate folder…"). */
  textureDirs: z.array(z.string().min(1)),
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
  /** In-game price ($); null = automatic (kind × construction material). */
  price: z.number().nonnegative().nullable(),
  description: z.string(),
  constructionMaterial: z.enum(CONSTRUCTION_MATERIALS),
});

// ---------------------------------------------------------------- structure (Phase 4)
// Tightened from always-empty placeholders (no migration needed, see VERSIONING RULE).

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const NODE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
export const BEAM_KINDS = ['edge', 'brace', 'attach'] as const;
export const PROXY_MODE_VALUES = ['surface', 'decimate', 'hull', 'box', 'cylinder'] as const;
export const BRACING_VALUES = ['none', 'light', 'standard', 'heavy'] as const;
export const ATTACHMENT_STYLE_VALUES = ['bolted', 'clipped', 'rivets', 'welded'] as const;

/** A jbeam node, BeamNG space. */
export const StructNodeSchema = z.object({
  id: z.string().regex(NODE_ID),
  partId: z.string().min(1),
  pos: Vec3,
  /** kg */
  weight: z.number().positive(),
  /** Moved/edited by hand: regeneration keeps it (Phase 7). */
  manual: z.boolean().optional(),
});

/** A beam between two node ids. Values come from the part's preset (edge/brace) or attachment style (attach) at export. */
export const StructBeamSchema = z.object({
  id1: z.string().min(1),
  id2: z.string().min(1),
  partId: z.string().min(1),
  kind: z.enum(BEAM_KINDS),
});

/** A collision triangle (outward winding). */
export const StructTriSchema = z.object({
  ids: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  partId: z.string().min(1),
});

export const PartProxySchema = z.object({
  mode: z.enum(PROXY_MODE_VALUES),
  /** 0..1 within the kind's vertex budget. */
  detail: z.number().min(0).max(1),
  symmetry: z.boolean(),
  maxEdge: z.number().nonnegative(),
  minEdge: z.number().nonnegative(),
  inset: z.number().nonnegative(),
  bracing: z.enum(BRACING_VALUES),
  attachment: z.enum(ATTACHMENT_STYLE_VALUES),
  /** Target mass override (kg); null = taxonomy default × construction material. */
  massKg: z.number().positive().nullable(),
  /** Override of the kind's structure role (own proxy / ride on parent / suspension-built). */
  role: z.enum(['own', 'rides', 'suspension']).optional(),
});

export const RefNodesSchema = z.object({
  ref: z.string(),
  back: z.string(),
  left: z.string(),
  up: z.string(),
  leftCorner: z.string(),
  rightCorner: z.string(),
});

export const ProxySectionSchema = z.object({
  /** partId → generation settings (present once a part has been generated or tuned). */
  parts: z.record(z.string(), PartProxySchema).default({}),
  refNodes: RefNodesSchema.nullable().default(null),
});

/** Project-local taxonomy entries (from "Add Custom Part"). Shape is validated by the taxonomy module. */
const CustomTaxonomyEntry = z.record(z.string(), z.unknown());

export const ProjectV5Schema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(5),
  appVersion: z.string(),
  meta: ProjectMetaSchema,
  sources: z.array(SourceSchema),
  splits: z.array(SplitSchema),
  parts: z.array(PartSchema),
  /** meshKey → partId */
  assignments: z.record(z.string(), z.string()),
  /** meshKeys the user chose to ignore (not exported). */
  ignoredMeshes: z.array(z.string()),
  /** meshKey → friendly name shown and exported instead of the original; `manual` = typed by hand (never auto-renamed). */
  meshNames: z.record(z.string(), z.object({ name: z.string().min(1), manual: z.boolean() })),
  customTaxonomy: z.array(CustomTaxonomyEntry),
  proxy: ProxySectionSchema,
  nodes: z.array(StructNodeSchema),
  beams: z.array(StructBeamSchema),
  tris: z.array(StructTriSchema),
  materials: placeholderList, // Phase 8
  hinges: placeholderList, // Phase 9
  suspension: placeholderMap, // Phase 10
  powertrain: placeholderMap, // Phase 11
  configs: placeholderList, // Phase 13
  variables: placeholderList, // Phase 12
});

export const ProjectSchema = ProjectV5Schema;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Split = z.infer<typeof SplitSchema>;
export type Part = z.infer<typeof PartSchema>;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export type Axis = (typeof AXES)[number];
export type ConstructionMaterial = (typeof CONSTRUCTION_MATERIALS)[number];
export type StructNode = z.infer<typeof StructNodeSchema>;
export type StructBeam = z.infer<typeof StructBeamSchema>;
export type StructTri = z.infer<typeof StructTriSchema>;
export type PartProxy = z.infer<typeof PartProxySchema>;
export type RefNodes = z.infer<typeof RefNodesSchema>;
