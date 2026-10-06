import { z } from 'zod';
import { VehicleScriptSchema } from '../lua/types';
import { PropSchema } from '../props/props';
import { CameraSchema } from '../cameras/cameras';
import { MaterialDefSchema } from '../materials/schema';
import { HingeSchema } from '../hinges/schema';
import { TriggerSchema } from '../triggers/schema';
import { RimSpecSchema, TyreSpecSchema } from '../wheels/schema';
import { PortedFromSchema } from '../export/ported';
import { SkinLayoutSchema } from '../uv/skinUnwrap';
import { EngineDesignSchema } from '../powertrain/design';

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
export const CURRENT_PROJECT_VERSION = 24;

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
  /** Vehicle selector details (fork): Sedan, Coupe…; country of origin; model years. */
  bodyStyle: z.string().optional(),
  country: z.string().optional(),
  years: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
  /** Reload the model when its file changes on disk (fork); unset = Settings → Files. */
  autoReimport: z.boolean().optional(),
  /** Export textures as DDS (fork); unset = Settings → Export. */
  ddsConvert: z.boolean().optional(),
  /** What the mod is (fork): a whole vehicle (unset), an engine for game cars, universal tyres or wheels. */
  modKind: z.enum(['vehicle', 'engine', 'tyres', 'wheels', 'panel']).optional(),
  /** Ported from another game (fork): which, and the modder's declaration (owns it, mod is free). */
  portedFrom: PortedFromSchema.optional(),
  /**
   * The BeamNG.drive version the mod was last exported for (v24): game updates are what break mods
   * quietly, so opening it with another version says so.
   */
  gameVersion: z.string().max(64).optional(),
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
/**
 * Hand-set jbeam properties of one node, beam or triangle (fork, JBeam
 * workspace): written into that row's options on export, over the values
 * the part's preset gives it. Keys are jbeam property names.
 */
export const JBEAM_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const RowOptionsSchema = z.record(z.string().regex(JBEAM_KEY), z.union([z.number(), z.string().max(200), z.boolean()]));

export const StructNodeSchema = z.object({
  id: z.string().regex(NODE_ID),
  partId: z.string().min(1),
  pos: Vec3,
  /** kg */
  weight: z.number().positive(),
  /** Moved/edited by hand: regeneration keeps it (Phase 7). */
  manual: z.boolean().optional(),
  options: RowOptionsSchema.optional(),
});

/** A beam between two node ids. Values come from the part's preset (edge/brace) or attachment style (attach) at export. */
export const StructBeamSchema = z.object({
  id1: z.string().min(1),
  id2: z.string().min(1),
  partId: z.string().min(1),
  kind: z.enum(BEAM_KINDS),
  options: RowOptionsSchema.optional(),
});

/** A collision triangle (outward winding). */
export const StructTriSchema = z.object({
  ids: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  partId: z.string().min(1),
  options: RowOptionsSchema.optional(),
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
 * A car brought over from another game (Assetto Corsa, or any game an importer extension reads): where it came
 * from and the text of its data files (car.ini, engine.ini, power.lut,
 * ui_car.json, ext_config.ini…), kept so later tools can build from them.
 */
export const ReferenceCarSchema = z.object({
  /** Assetto Corsa (the built-in importer), or another game an extension brought the car from. */
  kind: z.enum(['assettocorsa', 'game']),
  /** The game's name, for kind "game". */
  game: z.string().max(120).optional(),
  /** Spec sheet an importer read (label → value), for kind "game". */
  specs: z.record(z.string().max(80), z.string().max(400)).optional(),
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

/** A body panel mod's stock part (fork): which car, which part, and the stock model imported as a guide. */
export const PanelModSchema = z.object({
  /** The set's id in the library ("<vehicle>/<part>"). */
  setId: z.string().min(1),
  vehicle: z.string().regex(/^[a-z0-9_]+$/i),
  vehicleName: z.string(),
  part: z.string().min(1),
  slotType: z.string(),
  name: z.string(),
  category: z.string(),
  /** The stock panel's model, imported to line the new one up against; never exported. */
  guideSourceId: z.string().nullable().optional(),
});

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
  uv: z.object({
    scale: V2,
    offset: V2,
    rotation: z.number(),
    /**
     * Fresh texture coordinates projected from the shape (fork): 'box' picks
     * each triangle's facing side, 'x'/'y'/'z' project along one axis. `size`
     * is metres per texture repeat. 'skin' lays the whole car out as a skin
     * template (src/shared/uv/skinUnwrap.ts), every included mesh sharing
     * `layout`. Absent = the model's own UVs.
     */
    project: z.object({ kind: z.enum(['box', 'x', 'y', 'z', 'skin']), size: z.number().positive(), layout: SkinLayoutSchema.optional() }).optional(),
  }),
});

/**
 * Modelling (fork): a mesh reshaped in the app, Blender-style. Points are the
 * mesh's corners welded by position, numbered in the order they first appear
 * (src/shared/mesh/meshModel.ts); triangles keep their numbers, so painted
 * faces and materials stay put. Positions are in the mesh's own space, before
 * its move/turn/resize (MeshEdit).
 */
export const MeshModelSchema = z.object({
  /** The mesh as the file gave it: a different count means the file changed under the edits. */
  base: z.object({ tris: z.number().int().min(0), points: z.number().int().min(0) }),
  /** Point number → where it was moved to. */
  moved: z.record(z.string(), V3),
  /** New points (extrude, add), numbered after the file's own. */
  points: z.array(V3),
  /** Corner number (triangle × 3 + 0…2) → the point it uses now (extruded faces move onto new points). */
  rewire: z.record(z.string(), z.number().int().min(0)),
  /** Triangles deleted (they stay in the list, empty, so numbers never shift). */
  removed: z.array(z.number().int().min(0)),
  /** Triangles turned to face the other way. */
  flipped: z.array(z.number().int().min(0)),
  /** New triangles (fill, extrude sides), as three point numbers each, and the triangle whose material they take. */
  added: z.array(z.object({ p: z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(0)]), like: z.number().int().min(0) })),
});

/** A copy of a mesh (v10), e.g. a caliper mirrored to the other side. Its key is `copy:<id>`. */
export const MeshCopySchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  /** Mirror across the car's centre line (left ↔ right). */
  mirror: z.boolean(),
});

/**
 * Edits to a fitted engine or gearbox's jbeam (v16), applied on export after
 * the transplant. `fields` keys are "<part>/<section>/<key>" in the game's
 * names, e.g. "etk_engine_i6_3.0/mainEngine/maxRPM"; only numbers the game
 * already has are offered, so nothing unknown to it is written.
 */
/**
 * The modder's own version of one of a fitted set's game parts (v23): a copy offered in the same
 * slot (so the player picks it in the parts menu, and configurations can), with its own values. A
 * race radiator is the stock one with a bigger core and more coolant.
 */
export const PartVersionSchema = z.object({
  /** Added to the part's name: <part>_<id>. */
  id: z.string().regex(/^[a-z0-9]{1,16}$/),
  /** The game part it's a copy of. */
  base: z.string().min(1),
  /** Its name in the parts menu. */
  label: z.string().min(1).max(80),
  /** In-game price ($); null = the base part's. */
  price: z.number().nonnegative().nullable(),
  /** "<section>/<key>" → value, over the base part's (after the set's own edits). */
  fields: z.record(z.string(), z.number()),
  /** Its own settings adjustable in game: "<section>/<key>" → range. */
  tunable: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).optional(),
});

export const PowertrainEditsSchema = z.object({
  fields: z.record(z.string(), z.number()),
  /** The engine's torque curve, [rpm, Nm] rising in rpm; null keeps the game's. */
  torque: z.array(z.tuple([z.number().min(0), z.number()])).nullable(),
  /** Gear ratios as the jbeam has them (reverse, neutral 0, forward…); null keeps the game's. */
  gearRatios: z.array(z.number()).nullable(),
  /** Word settings (fork), e.g. a differential's type: same keys as `fields`. */
  texts: z.record(z.string(), z.string()).optional(),
  /** The engine designer's choices (v21): the curve, revs and weight above were made from them. */
  design: EngineDesignSchema.optional(),
  /** Settings the player can adjust in the game's tuning menu (v23): field key → range; it starts at the value set here. */
  tunable: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).optional(),
  /** The modder's own versions of the set's parts (v23). */
  versions: z.array(PartVersionSchema).optional(),
});

export const emptyEdits = (): z.infer<typeof PowertrainEditsSchema> => ({ fields: {}, torque: null, gearRatios: null });

/** Per slot of a fitted set: the default part and the game's other parts offered in the parts menu. */
export const SetChoicesSchema = z.record(z.string(), z.object({ default: z.string(), offer: z.array(z.string()) }));

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
  /** The driveline builder's changes to the set's differentials (fork): same form as the engine's edits. */
  edits: PowertrainEditsSchema.optional(),
  fitted: z
    .object({
      /** Catalogue id (vehicle/part). */
      setId: z.string(),
      name: z.string(),
      vehicle: z.string(),
      type: z.string(),
      sourceId: z.string(),
      /** The game's other parts for its slots (fork): default per slot and which ship as choices. */
      choices: SetChoicesSchema.optional(),
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
  /** Changes to the game's own numbers (v16): the engine builder and gearbox builder. */
  edits: PowertrainEditsSchema,
  /** The game's other parts for its slots (fork): default per slot and which ship as choices. */
  choices: SetChoicesSchema.optional(),
  /** An engine's tag in exported part names (fork): E, E2, E3…, kept when engines are reordered so configurations stay valid. */
  tag: z.string().regex(/^E\d*$/).optional(),
  /**
   * An engine's own model (v22): the meshes the engine designer built for it. They ride on the game
   * engine's nodes in place of its meshes, which are set aside.
   */
  ownMeshes: z.array(z.string()).optional(),
});

export const PowertrainSchema = z.object({
  engine: FittedSetSchema.nullable(),
  gearbox: FittedSetSchema.nullable(),
  /** More engines (fork): offered in the engine's slot, one chosen per configuration; `engine` is the default. */
  alternates: z.array(FittedSetSchema).optional(),
  /** How the gearbox reaches the axles (fork): which are driven, and the centre differential for all-wheel drive. Absent = as the axles were. */
  drivetrain: z
    .object({
      layout: z.enum(['auto', 'rwd', 'fwd', 'awd']),
      frontShare: z.number().min(0).max(1),
      centre: z.enum(['viscous', 'lsd', 'open', 'locked']),
    })
    .optional(),
});

/**
 * A part setting the player can adjust in the game's tuning menu (v13,
 * Phase 12): a scale on the part's mass, stiffness or strength, between min
 * and max, starting at `default`.
 */
export const TuningVarSchema = z.object({
  id: z.string().min(1),
  partId: z.string().min(1),
  setting: z.enum(['mass', 'stiffness', 'strength', 'downforce']),
  min: z.number().positive(),
  max: z.number().positive(),
  default: z.number().positive(),
});

/**
 * A vehicle configuration (v14, Phase 13), like the game's .pc files: which
 * part each slot takes where it differs from the default (an empty string
 * leaves the slot empty), and values for the settings adjustable in game.
 */
export const VehicleConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  /** Factory, Custom, Police… (the game's "Config Type"). */
  type: z.string(),
  /** slot type → part name ('' = empty). */
  parts: z.record(z.string(), z.string()),
  /** jbeam variable ($hood_mass…) → value. */
  vars: z.record(z.string(), z.number()),
  /** Paint id for each of the game's three paint slots (v16); null = the factory default. */
  paints: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
  /**
   * Vehicle selector details (fork), written to its info_<config>.json: years
   * sold, drivetrain/transmission/fuel/induction labels (worked out from the
   * parts when unset), how common it is, and its value when not the parts' sum.
   */
  info: z
    .object({
      years: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
      drivetrain: z.string().optional(),
      transmission: z.string().optional(),
      fuelType: z.string().optional(),
      induction: z.string().optional(),
      population: z.number().int().min(0).optional(),
      value: z.number().min(0).optional(),
    })
    .optional(),
});

/**
 * A factory paint (v16), as the game's info.json `paints` and .pc `paints`
 * hold them. A car has three paint slots; a paint material's colour palette
 * mask decides where each slot shows (red = 1, green = 2, blue = 3).
 */
export const PaintSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** sRGB 0–1. */
  color: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  metallic: z.number().min(0).max(1),
  roughness: z.number().min(0).max(1),
  clearcoat: z.number().min(0).max(1),
  clearcoatRoughness: z.number().min(0).max(1),
});

export const PaintsSchema = z.object({
  list: z.array(PaintSchema),
  /** The default configuration's paint for slots 1–3 (info.json defaultPaintName1–3). */
  defaults: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
});

const Rgb01 = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);
const SlotIndex = z.number().int().min(0).max(2);

/**
 * A vinyl layer (v17): a shape, text or image placed on the car, the way a
 * livery editor's layers are. It's projected onto the car from one side, at
 * (x, y) in that side's view (metres from the middle of the car, x to the
 * viewer's right, y up), w × h metres, turned and skewed. On a livery it has
 * colours; on the paint-slot mask, paint slots.
 */
export const VinylLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(['shape', 'text', 'image']),
  /** Shape library id (src/shared/paints/shapes.ts). */
  shape: z.string(),
  text: z.string(),
  font: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  /** Image file, for image layers. */
  image: z.string().nullable(),
  side: z.enum(['left', 'right', 'top', 'front', 'back']),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  /** Degrees, anticlockwise as seen. */
  rotation: z.number(),
  /** Degrees of horizontal slant. */
  skew: z.number(),
  flipX: z.boolean(),
  flipY: z.boolean(),
  fill: z.enum(['solid', 'linear', 'radial']),
  color: Rgb01,
  color2: Rgb01,
  /** Paint slots on the mask. */
  slot: SlotIndex,
  slot2: SlotIndex,
  /** Linear fills: degrees; 0 runs left to right. */
  gradientAngle: z.number(),
  opacity: z.number().min(0).max(1),
  /** normal; erase: cuts through the layers below; clip: shows only where the layer below is. */
  mode: z.enum(['normal', 'erase', 'clip']),
  /** Also on the other side of the car, mirrored across its centre line. */
  mirror: z.boolean(),
  /** The mirrored copy of text and images isn't reversed. */
  readable: z.boolean(),
  visible: z.boolean(),
  locked: z.boolean(),
  groupId: z.string().nullable(),
});

/** One material's vinyls, on its livery or its paint-slot mask (bottom layer first). */
export const VinylSetSchema = z.object({
  materialId: z.string().min(1),
  target: z.enum(['livery', 'mask']),
  layers: z.array(VinylLayerSchema),
  groups: z.array(z.object({ id: z.string().min(1), name: z.string() })),
});

const Mount = z.object({ partId: z.string().min(1), pos: Vec3 });
const unit = z.number().min(0).max(1);

/** A paint design: some materials recoloured or given another texture (the game's `<material>.skin.<name>`). */
export const SkinSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** material id → its look in this skin (null keeps the material's own). */
  overrides: z.record(z.string(), z.object({ baseColor: z.tuple([unit, unit, unit, unit]).nullable(), baseColorMap: z.string().min(1).nullable() })),
});

/**
 * The game's extras (v15, Phase 12d): licence plates (the game's own plate
 * mesh, placed on a part), a tow hitch, nitrous, and paint designs.
 */
export const FeaturesSchema = z.object({
  plates: z.object({
    /** tilt: degrees about the car's left–right axis. */
    front: Mount.extend({ tilt: z.number() }).nullable(),
    rear: Mount.extend({ tilt: z.number() }).nullable(),
  }),
  hitch: Mount.nullable(),
  nitrous: Mount.extend({ bottle: z.enum(['10lb', '20lb']), shotKw: z.number().positive() }).nullable(),
  skins: z.array(SkinSchema),
});

export const ProjectV18Schema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(19),
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
  /** Animated parts (fork): meshes the game turns or slides by an electrics value (steering wheel, needles, pedals). */
  props: z.array(PropSchema).optional(),
  /** Interior cameras (fork): the driver's view and others, as camerasInternal. */
  cameras: z.array(CameraSchema).optional(),
  /** Vehicle scripts (fork): Lua controllers that ship with the car. */
  scripts: z.array(VehicleScriptSchema).optional(),
  /** Tyre mod (fork): sizes, tread and grip. */
  tyre: TyreSpecSchema.optional(),
  /** Body panel mod (fork): the game car's panel it replaces; its physics are the stock part's. */
  panel: PanelModSchema.optional(),
  /** Wheel (rim) mod (fork): size, lugs and hub. */
  rim: RimSpecSchema.optional(),
  /** Clickable triggers (fork): handles, switches and buttons that run input actions. */
  triggers: z.array(TriggerSchema).optional(),
  /** Engine and gearbox (v12, Phase 11). */
  powertrain: PowertrainSchema,
  /** Vehicle configurations beyond the default (v14, Phase 13). */
  configs: z.array(VehicleConfigSchema),
  /** The configuration the game spawns by default (fork); absent or null = the base one. */
  defaultConfigId: z.string().nullable().optional(),
  /** Settings adjustable in the game's tuning menu (v13, Phase 12). */
  variables: z.array(TuningVarSchema),
  /** Plates, tow hitch, nitrous, paint designs (v15). */
  features: FeaturesSchema,
  /** Factory paints and the default car's paint slots (v16). */
  paints: PaintsSchema,
  /** Vinyl layers per material (v17). */
  vinyls: z.array(VinylSetSchema),
  /**
   * Material painting (v18): mesh key → triangles given another material,
   * as runs of triangle numbers ([start, count, …]) per material.
   */
  faceMaterials: z.record(z.string(), z.array(z.object({ materialId: z.string().min(1), runs: z.array(z.number().int().min(0)) }))),
});

/** v20: meshes reshaped in the Modelling workspace, a section of their own. */
export const ProjectV20Schema = ProjectV18Schema.extend({
  formatVersion: z.literal(20),
  /** meshKey → the mesh reshaped in the Modelling workspace. */
  meshModels: z.record(z.string(), MeshModelSchema),
});

/** v21: an engine designed in the Engine workspace keeps its design (powertrain edits' `design`). */
export const ProjectV21Schema = ProjectV20Schema.extend({
  formatVersion: z.literal(21),
});

/** v22: an engine can carry its own model from the engine designer (fitted set's `ownMeshes`). */
export const ProjectV22Schema = ProjectV21Schema.extend({
  formatVersion: z.literal(22),
});

/** v23: settings of the engine, gearbox and suspension parts adjustable in game, and the modder's own versions of those parts. */
export const ProjectV23Schema = ProjectV22Schema.extend({
  formatVersion: z.literal(23),
});

/** v24: the BeamNG.drive version the mod was exported for (meta.gameVersion). */
export const ProjectV24Schema = ProjectV23Schema.extend({
  formatVersion: z.literal(24),
});

export const ProjectSchema = ProjectV24Schema;
export type Project = z.infer<typeof ProjectSchema>;
export type PartVersion = z.infer<typeof PartVersionSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Split = z.infer<typeof SplitSchema>;
export type Part = z.infer<typeof PartSchema>;
export type ReferenceCar = z.infer<typeof ReferenceCarSchema>;
export type MeshEdit = z.infer<typeof MeshEditSchema>;
export type MeshModel = z.infer<typeof MeshModelSchema>;
export type MeshCopy = z.infer<typeof MeshCopySchema>;
export type Axle = z.infer<typeof AxleSchema>;
export type FittedSet = z.infer<typeof FittedSetSchema>;
export type TuningVar = z.infer<typeof TuningVarSchema>;
export type VehicleConfig = z.infer<typeof VehicleConfigSchema>;
export type Features = z.infer<typeof FeaturesSchema>;
export type Skin = z.infer<typeof SkinSchema>;
export type Paint = z.infer<typeof PaintSchema>;
export type VinylLayer = z.infer<typeof VinylLayerSchema>;
export type VinylSet = z.infer<typeof VinylSetSchema>;
export type PowertrainEdits = z.infer<typeof PowertrainEditsSchema>;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export type Axis = (typeof AXES)[number];
export type ConstructionMaterial = (typeof CONSTRUCTION_MATERIALS)[number];
export type StructNode = z.infer<typeof StructNodeSchema>;
export type StructBeam = z.infer<typeof StructBeamSchema>;
export type StructTri = z.infer<typeof StructTriSchema>;
export type RowOptions = z.infer<typeof RowOptionsSchema>;
export type PartProxy = z.infer<typeof PartProxySchema>;
export type RefNodes = z.infer<typeof RefNodesSchema>;
