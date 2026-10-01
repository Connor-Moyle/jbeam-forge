import { z } from 'zod';
import { REPO_PATTERN } from './content/manifest';

/** Window sizes offered in Settings ("remember" = the size it had when last closed). */
/** Picture sizes for the vehicle selector (16:9). */
export const PREVIEW_SIZES = ['500x281', '1280x720', '1920x1080', '2560x1440'] as const;

export const WINDOW_SIZES = ['remember', '1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440', '3840x2160', 'custom'] as const;
export type WindowSize = (typeof WINDOW_SIZES)[number];

/**
 * User-global settings persisted to `userData/settings.json`.
 * Layering (SPEC §2): shipped defaults < user-global file. Per-project
 * overrides arrive with the project system in Phase 3.
 */
export const SETTINGS_VERSION = 1;

export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  debugLogging: z.boolean(),
  /** BeamNG.drive install folder (contains BeamNG.drive.exe and content/vehicles). */
  beamngInstallDir: z.string().min(1).nullable(),
  /** BeamNG user folder (…/BeamNG.drive/current); mods are installed under it. */
  beamngUserDir: z.string().min(1).nullable(),
  /** Mod author, entered once in the New Mod wizard and reused (SPEC §4.1). */
  author: z.string().max(100).nullable(),
  /** Focus mode: how visible the rest of the car stays (0 = hidden, 1 = solid). */
  focusGhostOpacity: z.number().min(0).max(1),
  /** Engine workspace: the rest of the car turns see-through around the engine. */
  engineViewXray: z.boolean(),
  /** Generate (toolbar): how every part's structure is built ('auto' = each part's own choice). */
  generateMode: z.enum(['auto', 'hull', 'surface', 'decimate', 'box']),
  /** Generate (toolbar): how many nodes, 0 (fewest) to 1 (most) within each kind of part's range. */
  generateDetail: z.number().min(0).max(1),
  /** Engine workspace: the camera turns slowly round the engine until you move it. */
  engineViewOrbit: z.boolean(),
  /** Name meshes after the part they're assigned to (typed names are never touched). */
  autoRenameMeshes: z.boolean(),
  /** Drop numbered leftovers from part display names ("Hood (2)" → "Hood"). */
  autoRenameDisplayNames: z.boolean(),
  /** Your own material folders, scanned into the library at startup. */
  materialFolders: z.array(z.string().min(1)).max(20),
  /** Your own object folders (meshes: calipers, gauges…), scanned at startup. */
  objectFolders: z.array(z.string().min(1)).max(20),

  // General
  /** Open the most recent project when the app starts. */
  openLastProject: z.boolean(),
  /** Save the open project every so many minutes (0 = off; only projects saved once). */
  autosaveMinutes: z.number().int().min(0).max(60),
  /** How many recent projects the home screen lists. */
  recentLimit: z.number().int().min(3).max(30),
  /** Undo steps kept in memory. */
  undoLimit: z.number().int().min(1).max(10000),
  /** Paint strokes Ctrl+Z can take back per painted texture (each keeps a full copy of the picture). */
  paintUndoLimit: z.number().int().min(1).max(100),

  // Interface (Blender-style preferences)
  theme: z.enum(['dark', 'midnight', 'blender', 'light', 'contrast']),
  accent: z.enum(['blue', 'orange', 'green', 'purple', 'red', 'teal', 'pink', 'yellow']),
  density: z.enum(['compact', 'normal', 'spacious']),
  fontSize: z.enum(['small', 'normal', 'large']),
  squareCorners: z.boolean(),
  animations: z.boolean(),
  showTooltips: z.boolean(),
  /** Hover time before a tooltip shows (ms). */
  tooltipDelay: z.number().int().min(0).max(2000),
  showStatusBar: z.boolean(),
  /** Ask before deleting parts, scripts and other things that take work to make again. */
  confirmDeletes: z.boolean(),
  /** Textures go into exported mods as DDS (new mods start with this; each mod can change it). */
  ddsConvert: z.boolean(),
  ddsMipmaps: z.boolean(),
  /** Normal maps as BC3 (DXT5, like most of the game's) or BC5 (two channels, sharper). */
  ddsNormalFormat: z.enum(['BC3', 'BC5']),
  /** Largest texture side in the mod (px); 0 = as they are. */
  ddsMaxSize: z.union([z.literal(0), z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)]),
  /** Reload a model when its file changes (new mods start with this; each mod can change it). */
  autoReimport: z.boolean(),
  /** Ask before reloading a changed model. */
  autoReimportAsk: z.boolean(),
  /** Changed textures next to the model reload it too. */
  autoReimportTextures: z.boolean(),
  /** Assetto Corsa (kn5) imports: effect meshes (blurred rims, damage glass…) come in ignored. */
  acIgnoreHelpers: z.boolean(),
  /** …objects the car file marks hidden are left out. */
  acSkipHidden: z.boolean(),
  /** …paint detail and per-pixel gloss are baked into the textures. */
  acBakePaint: z.boolean(),
  /** …the meshes are sorted into parts straight away. */
  acClassify: z.boolean(),
  /** …the car's name, brand and description become the mod's. */
  acUseDetails: z.boolean(),
  /** JBeam workspace (fork): every property and tool, not just the common ones. */
  jbeamAdvanced: z.boolean(),
  /** Structure checks: beams shorter than this (mm) are flagged. */
  jbeamShortBeamMm: z.number().min(0.1).max(500),
  /** …and longer than this (m). */
  jbeamLongBeamM: z.number().min(0.1).max(20),
  /** A node needs at least this many beams. */
  jbeamMinBeams: z.number().int().min(1).max(12),
  /** Nodes closer than this (mm) are flagged as on top of each other. */
  jbeamOverlapMm: z.number().min(0.01).max(100),
  /** A node heavier than this many times its part's average is flagged. */
  jbeamHeavyFactor: z.number().min(1.5).max(100),
  /** Logical naming: numbers grow front to back or bottom to top. */
  jbeamNamingOrder: z.enum(['front-back', 'bottom-top']),
  /** Logical naming: l/r endings for mirrored pairs. */
  jbeamNamingSides: z.boolean(),
  jbeamNamingStart: z.number().int().min(0).max(1000),
  /** Rows the JBeam tables show before "Show more". */
  jbeamPageSize: z.number().int().min(50).max(5000),
  /** Picking a row in a JBeam table frames it in the 3D view. */
  jbeamFrameOnPick: z.boolean(),
  /** The first-run tour was taken or skipped (Help → Start the Tutorial runs it again). */
  tutorialSeen: z.boolean(),
  /** Guided lessons already watched or skipped (script templates, triggers…): offered once each. */
  lessonsSeen: z.array(z.string().max(80)).max(500),
  /** Offer a guided lesson (Watch or Skip) the first time something new is used. */
  offerLessons: z.boolean(),

  // Navigation
  /** Zoom toward the mouse pointer instead of the view's centre. */
  zoomToCursor: z.boolean(),
  panSpeed: z.number().min(0.1).max(5),
  /** Smooth (damped) camera movement. */
  smoothCamera: z.boolean(),
  /** Orbit the other way when dragging. */
  invertOrbit: z.boolean(),

  // Editing
  /** Arrow-key nudge in edit mode, millimetres (Shift × 5, Alt ÷ 5). */
  nudgeMm: z.number().min(0.1).max(100),
  /** Node size in the viewport, millimetres (0 = automatic from the car's size). */
  nodeSizeMm: z.number().min(0).max(100),

  // Keys
  /** Keys the user changed (action id → key; "" = none). */
  keymap: z.record(z.string(), z.string().max(40)),

  // Files
  /** Where Save As and Open start (null = the last folder used). */
  projectFolder: z.string().min(1).nullable(),
  /** Earlier versions kept beside a project when it's saved (name.jbforge.1.bak…). */
  backupCount: z.number().int().min(0).max(20),

  // Window & display
  /** Window size at startup: the last size, a resolution, or custom. */
  windowSize: z.enum(WINDOW_SIZES),
  windowWidth: z.number().int().min(960).max(7680),
  windowHeight: z.number().int().min(600).max(4320),
  startMode: z.enum(['normal', 'maximized', 'fullscreen']),
  /** Interface zoom (text, panels, toolbar). */
  uiScale: z.number().min(0.75).max(1.5),

  // Viewport & graphics
  /** 3D render resolution as a share of the screen's (lower is faster, higher is sharper). */
  renderScale: z.number().min(0.5).max(2),
  antialias: z.boolean(),
  /** Frame-rate cap (0 = the display's rate). */
  maxFps: z.number().int().min(0).max(240),
  showGrid: z.boolean(),
  /** Studio reflections on shiny materials. */
  reflections: z.boolean(),
  viewportBackground: z.enum(['theme', 'black', 'grey', 'light']),
  /** Vertical field of view of the orbit camera, degrees. */
  cameraFov: z.number().min(25).max(90),
  orbitSpeed: z.number().min(0.2).max(3),
  zoomSpeed: z.number().min(0.2).max(3),
  invertZoom: z.boolean(),
  showFps: z.boolean(),

  // Units
  speedUnit: z.enum(['kmh', 'mph']),
  powerUnit: z.enum(['kw', 'hp', 'ps']),
  torqueUnit: z.enum(['nm', 'lbft']),

  // Export
  openFolderAfterExport: z.boolean(),
  /** Compress exported zips (smaller; storing is faster). */
  compressZip: z.boolean(),
  /** Vehicle-selector pictures (default.jpg and one per configuration): size, angle and backdrop. */
  previewSize: z.enum(PREVIEW_SIZES),
  previewAngle: z.enum(['front-left', 'front-right', 'front', 'side', 'rear-left']),
  previewBackdrop: z.enum(['studio', 'light', 'dark', 'sunset']),

  // Downloads
  /** Where downloaded textures and meshes go (null = beside the program). */
  contentDir: z.string().min(1).nullable(),
  checkUpdatesOnStartup: z.boolean(),
  includePrereleases: z.boolean(),
  /** Files downloaded at once. */
  downloadConcurrency: z.number().int().min(1).max(8),
  /** GitHub repositories (owner/name): the app's releases, and the two content repositories. */
  appRepo: z.string().regex(REPO_PATTERN),
  texturesRepo: z.string().regex(REPO_PATTERN),
  meshesRepo: z.string().regex(REPO_PATTERN),
  /** Vehicle scripts (Lua templates and functions) to download. */
  scriptsRepo: z.string().regex(REPO_PATTERN),

  // Scripts
  /** Lua editor text size (px). */
  scriptFontSize: z.number().int().min(10).max(22),
  /** Spaces per indent in the Lua editor. */
  scriptTabSize: z.union([z.literal(2), z.literal(4)]),
  /** Warnings in a script stop the export too (not only errors). */
  scriptStrictExport: z.boolean(),
  /** Frames per second the script test runs updateGFX at (the game: about 60). */
  scriptTestFps: z.union([z.literal(30), z.literal(60), z.literal(120)]),
  /** A picture for every configuration on export (off: only the model's default.jpg). */
  previewEveryConfig: z.boolean(),

  // Extensions
  /** Run extensions from the extensions folder. */
  extensionsEnabled: z.boolean(),
  /** Extensions (by id) switched off. */
  disabledExtensions: z.array(z.string().max(40)).max(200),
  /** Branch the content repositories' latest version lives on. */
  contentBranch: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  debugLogging: false,
  beamngInstallDir: null,
  beamngUserDir: null,
  author: null,
  focusGhostOpacity: 0.12,
  engineViewXray: true,
  generateMode: 'auto',
  generateDetail: 0.5,
  engineViewOrbit: true,
  autoRenameMeshes: true,
  autoRenameDisplayNames: true,
  materialFolders: [],
  objectFolders: [],
  openLastProject: false,
  autosaveMinutes: 0,
  recentLimit: 12,
  undoLimit: 1000,
  paintUndoLimit: 12,
  windowSize: 'remember',
  windowWidth: 1440,
  windowHeight: 900,
  startMode: 'normal',
  uiScale: 1,
  theme: 'dark',
  accent: 'blue',
  density: 'normal',
  fontSize: 'normal',
  squareCorners: false,
  animations: true,
  showTooltips: true,
  tooltipDelay: 300,
  showStatusBar: true,
  confirmDeletes: true,
  ddsConvert: false,
  ddsMipmaps: true,
  ddsNormalFormat: 'BC3',
  ddsMaxSize: 0,
  autoReimport: true,
  autoReimportAsk: false,
  autoReimportTextures: true,
  acIgnoreHelpers: true,
  acSkipHidden: false,
  acBakePaint: true,
  acClassify: true,
  acUseDetails: true,
  jbeamAdvanced: false,
  jbeamShortBeamMm: 10,
  jbeamLongBeamM: 2.5,
  jbeamMinBeams: 3,
  jbeamOverlapMm: 2,
  jbeamHeavyFactor: 10,
  jbeamNamingOrder: 'front-back',
  jbeamNamingSides: true,
  jbeamNamingStart: 1,
  jbeamPageSize: 300,
  jbeamFrameOnPick: false,
  tutorialSeen: false,
  lessonsSeen: [],
  offerLessons: true,
  zoomToCursor: true,
  panSpeed: 1,
  smoothCamera: false,
  invertOrbit: false,
  nudgeMm: 5,
  nodeSizeMm: 0,
  keymap: {},
  projectFolder: null,
  backupCount: 2,
  renderScale: 1,
  antialias: true,
  maxFps: 0,
  showGrid: true,
  reflections: true,
  viewportBackground: 'theme',
  cameraFov: 45,
  orbitSpeed: 1,
  zoomSpeed: 1,
  invertZoom: false,
  showFps: false,
  speedUnit: 'kmh',
  powerUnit: 'hp',
  torqueUnit: 'nm',
  openFolderAfterExport: false,
  compressZip: true,
  previewSize: '1280x720',
  previewAngle: 'front-left',
  previewBackdrop: 'studio',
  contentDir: null,
  checkUpdatesOnStartup: true,
  includePrereleases: false,
  downloadConcurrency: 4,
  appRepo: 'Connor-Moyle/jbeam-forge',
  texturesRepo: 'Connor-Moyle/jbeam-forge-textures',
  meshesRepo: 'Connor-Moyle/jbeam-forge-meshes',
  scriptsRepo: 'Connor-Moyle/jbeam-forge-scripts',
  scriptFontSize: 13,
  scriptTabSize: 2,
  scriptStrictExport: false,
  scriptTestFps: 60,
  previewEveryConfig: true,
  extensionsEnabled: true,
  disabledExtensions: [],
  contentBranch: 'main',
};

/** Fields the renderer may change. `version` is owned by the main process. */
export const SettingsPatchSchema = SettingsSchema.omit({ version: true }).partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/**
 * Merge an unknown on-disk value over defaults. Unknown keys are dropped and
 * invalid fields fall back to their default individually, so one bad field
 * never wipes the rest of the user's settings.
 */
export function mergeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return out;
  const record = raw as Record<string, unknown>;
  const shape = SettingsSchema.shape;
  for (const key of Object.keys(shape) as (keyof Settings)[]) {
    if (key === 'version' || !(key in record)) continue;
    const parsed = shape[key].safeParse(record[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}
