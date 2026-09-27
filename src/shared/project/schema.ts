import { z } from 'zod';
import { MaterialDefSchema } from '../materials/schema';
import { HingeSchema } from '../hinges/schema';

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
export const CURRENT_PROJECT_VERSION = 12;

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

export const SOURCE_FORMATS = ['dae', 'fbx', 'obj', 'gltf', 'glb', 'stl', 'kn5'] as const;
export const AXES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
export const CONSTRUCTION_MATERIALS = ['steel', 'aluminium', 'carbon', 'fibreglass', 'plastic'] as const;

/** A mesh file the project was built from. Geometry is re-read on open, never stored. */
/** A model's placement in BeamNG space: metres, degrees about X/Y/Z (applied X, then Y, then Z), uniform scale. */
export const PlacementSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  rotation: z.tuple([z.number(), z.number(), z.number()]),
  scale: z.number().positive(),
});
export type Placement = z.infer<typeof PlacementSchema>;
export const IDENTITY_PLACEMENT: Placement = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

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
  /** Where the model sits on the car, after its import conversion (moving a library caliper onto a hub). */
  placement: PlacementSchema,
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
/** edge/brace: the part's own skin and bracing; attach: to its parent; hinge…popopen: a hinged part's hinge, limiter, seals and mounts (Phase 9). */
export const BEAM_KINDS = ['edge', 'brace', 'attach', 'hinge', 'mount', 'limit', 'support', 'popopen'] as const;
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

/**
 * A car brought over from another game (Assetto Corsa for now): where it came
 * from and the text of its data files (car.ini, engine.ini, power.lut,
 * ui_car.json, ext_config.ini…), kept so later tools can build from them.
 */
export const ReferenceCarSchema = z.object({
  kind: z.literal('assettocorsa'),
  /** Folder name, e.g. "ks_mazda_mx5_cup". */
  carId: z.string(),
  folder: z.string(),
  skin: z.string().nullable(),
  /** Relative path ("data/car.ini", "ui/ui_car.json", "extension/ext_config.ini") → file text. */
  files: z.record(z.string(), z.string()),
  importedAt: z.iso.datetime(),
});

const V3 = z.tuple([z.number(), z.number(), z.number()]);
const V2 = z.tuple([z.number(), z.number()]);

/**
 * Changes to one mesh (v10): moved, turned and resized about its own centre,
 * and its texture mapping scaled/offset/turned. Baked into the geometry the
 * viewport draws and the export writes.
 */
export const MeshEditSchema = z.object({
  /** Metres, BeamNG space. */
  position: V3,
  /** Degrees about X, Y, Z (applied X, then Y, then Z) around the mesh's centre. */
  rotation: V3,
  scale: V3,
  uv: z.object({ scale: V2, offset: V2, rotation: z.number() }),
});

/** A copy of a mesh (v10), e.g. a caliper mirrored to the other side. Its key is `copy:<id>`. */
export const MeshCopySchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  /** Mirror across the car's centre line (left ↔ right). */
  mirror: z.boolean(),
});

/**
 * An axle (v11, Phase 10): where it is, how wide, whether it steers, and the
 * suspension fitted to it (a complete set from the game, as its own model).
 */
export const AxleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Wheel centre line along the car, metres (BeamNG Y: −front, +rear). */
  y: z.number(),
  /** Wheel centre to wheel centre, metres. */
  track: z.number().positive(),
  steered: z.boolean(),
  /** Tuning values for the fitted suspension's variables ($springheight_F…); unset = the game's default. */
  tuning: z.record(z.string(), z.number()),
  /** The user's own meshes shown for this suspension instead of the game's (the game's jbeam still does the physics). */
  ownMeshes: z.array(z.string()),
  fitted: z
    .object({
      /** Catalogue id (vehicle/part). */
      setId: z.string(),
      name: z.string(),
      vehicle: z.string(),
      type: z.string(),
      sourceId: z.string(),
    })
    .nullable(),
});

/** An engine or gearbox fitted from the game (v12, Phase 11): its own model, its jbeam brought over on export. */
export const FittedSetSchema = z.object({
  setId: z.string(),
  name: z.string(),
  vehicle: z.string(),
  type: z.string(),
  sourceId: z.string(),
  /** Tuning values for its variables; unset = the game's default. */
  tuning: z.record(z.string(), z.number()),
});

export const PowertrainSchema = z.object({
  engine: FittedSetSchema.nullable(),
  gearbox: FittedSetSchema.nullable(),
});

export const ProjectV12Schema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(12),
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
  /** Vehicle materials (Phase 8). Always empty before format v6, so tightening needs no data migration. */
  materials: z.array(MaterialDefSchema),
  /** meshKey → material id per material slot of the mesh (split pieces fall back to their base mesh). */
  materialSlots: z.record(z.string(), z.array(z.string())),
  /** Hinged parts (Phase 9). Always empty before v7. */
  hinges: z.array(HingeSchema),
  /** The car this project was brought over from, if any (v9). */
  reference: ReferenceCarSchema.nullable(),
  /** meshKey → how that mesh was moved/turned/resized and its textures mapped (v10). */
  meshEdits: z.record(z.string(), MeshEditSchema),
  /** Copies of meshes (v10). */
  meshCopies: z.array(MeshCopySchema),
  /** Axles and their suspension (v11, Phase 10). */
  axles: z.array(AxleSchema),
  suspension: placeholderMap, // Phase 10
  /** Engine and gearbox (v12, Phase 11). */
  powertrain: PowertrainSchema,
  configs: placeholderList, // Phase 13
  variables: placeholderList, // Phase 12
});

export const ProjectSchema = ProjectV12Schema;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Split = z.infer<typeof SplitSchema>;
export type Part = z.infer<typeof PartSchema>;
export type ReferenceCar = z.infer<typeof ReferenceCarSchema>;
export type MeshEdit = z.infer<typeof MeshEditSchema>;
export type MeshCopy = z.infer<typeof MeshCopySchema>;
export type Axle = z.infer<typeof AxleSchema>;
export type FittedSet = z.infer<typeof FittedSetSchema>;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export type Axis = (typeof AXES)[number];
export type ConstructionMaterial = (typeof CONSTRUCTION_MATERIALS)[number];
export type StructNode = z.infer<typeof StructNodeSchema>;
export type StructBeam = z.infer<typeof StructBeamSchema>;
export type StructTri = z.infer<typeof StructTriSchema>;
export type PartProxy = z.infer<typeof PartProxySchema>;
export type RefNodes = z.infer<typeof RefNodesSchema>;
