import type { Settings, SettingsPatch } from './settings-schema';
import type { MaterialDef } from './materials/schema';

export interface LibraryStatus {
  scanning: boolean;
  /** beamng: suspension, brake and steering parts cut from the BeamNG.drive install. */
  folders: { kind: 'materials' | 'objects' | 'beamng'; folder: string; count: number; error: string | null }[];
}

import type { SetOptions } from './suspension/options';
import type { ContentKind, ContentManifest } from './content/manifest';
import type { ContentInfo, ContentProgress, ContentRef, DownloadResult, UpdatesInfo } from './content/types';

/** A complete suspension, engine or gearbox from a stock BeamNG vehicle (cut from the user's install). */
/** Text files the app saves and opens where the user picks. */
export const TEXT_FILE_KINDS = {
  pc: { label: 'BeamNG configuration (.pc)', ext: 'pc' },
  lua: { label: 'Lua script (.lua)', ext: 'lua' },
  jbscript: { label: 'JBeam Forge script (.jbscript)', ext: 'jbscript' },
} as const;
export type TextFileKind = keyof typeof TEXT_FILE_KINDS;

export interface SuspensionSet {
  /** "<vehicle>/<part>" */
  id: string;
  kind: 'suspension' | 'engine' | 'gearbox';
  /** The root part's slot type (what it plugs into). */
  slotType: string;
  engine?: EngineSpecs;
  gearbox?: GearboxSpecs;
  vehicle: string;
  vehicleName: string;
  brand: string;
  /** Brand logo (absolute), or null. */
  logo: string | null;
  axle: 'front' | 'rear' | 'any';
  /** MacPherson strut, Double wishbone, Solid axle, Leaf spring… */
  type: string;
  name: string;
  /** The suspension part itself. */
  part: string;
  /** The part and the defaults of its slots. */
  parts: string[];
  /** The set's meshes (absolute DAE). */
  mesh: string;
  /** The parts' jbeam definitions (absolute JSON), for bringing the jbeam over. */
  jbeam: string;
}

/** An Assetto Corsa car folder as read by main (src/main/import/acCar.ts). */
export interface AcCarInfo {
  folder: string;
  carId: string;
  /** The main (LOD 0) model, or null when the folder has none. */
  kn5: string | null;
  skins: string[];
  /** Relative path → file text (data/*.ini, data/*.lut, ui/ui_car.json, extension/…). */
  files: Record<string, string>;
  warnings: string[];
}

/** A ready-made object (brake caliper, disc, gauge…) from the objects pack. */
export interface ObjectItem {
  id: string;
  name: string;
  category: string;
  group: string;
  /** Mesh file (absolute). */
  mesh: string;
  /** Its material, textures absolute; null when the mesh brings its own (kn5). */
  material: MaterialDef | null;
  /** Who made it, when the licence asks for credit. */
  credit: string | null;
  /** Its materials are the game's own (BeamNG parts): referenced by name, never exported. */
  gameMaterials: boolean;
}

/** A material saved to the user's library. */
export interface LibraryItem {
  id: string;
  name: string;
  category: string;
  savedAt: string;
  def: MaterialDef;
}
import type { StoredLayout } from './layout-schema';
import type { BeamngDetection, InstallValidation } from './beamng';
import type { SourceFormat } from './project/schema';
import type { TaxonomyEntry } from './taxonomy/schema';
import type { JbeamObject } from './jbeam/parse';
import type { EngineSpecs, GearboxSpecs } from './powertrain/specs';

/**
 * Single source of truth for every IPC channel. The preload bridge only
 * forwards channels listed in INVOKE_CHANNELS / EVENT_CHANNELS, and main
 * registers handlers against the same map, so both sides stay in sync.
 */

export interface IpcError {
  message: string;
  code?: string;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

export interface DiagnosticInfo {
  app: { name: string; version: string };
  versions: { electron: string; chrome: string; node: string; v8: string };
  os: { platform: string; release: string; arch: string };
  gpu: Record<string, string>;
  logFile: string;
  userData: string;
  debugLogging: boolean;
  recentLog: string[];
}

export interface ProjectFile {
  path: string;
  text: string;
  /**
   * Folders outside the project's own folder that its sources/textures live
   * in and that the user hasn't allowed yet (see project:allowFolders).
   */
  pendingFolders: string[];
}

/** An exported mod: files (text or base64) and texture copies, all under vehicles/<slug>/. */
/** What the repository page says about the mod. */
export interface PublishListing {
  title: string;
  tagline: string;
  version: string;
  description: string;
  tags: string[];
  /** The checks the app ran, as shown to the user ("✓ …" / "✗ …"). */
  checklist: string[];
}

export interface ExportBundle {
  slug: string;
  projectName: string;
  files: { path: string; text?: string; base64?: string }[];
  copies: { from: string; to: string }[];
}

export interface RecentProject {
  path: string;
  name: string;
  slug: string;
  openedAt: string;
  /** False when the file has been moved or deleted since. */
  exists: boolean;
  /** JPEG data URL captured from the viewport on save, if any. */
  thumbnail: string | null;
}

/** Request/response types for renderer → main invokes. */
export interface InvokeContract {
  'settings:get': { req: undefined; res: Settings };
  'settings:update': { req: SettingsPatch; res: Settings };
  'layout:load': { req: undefined; res: StoredLayout | null };
  'layout:save': { req: StoredLayout; res: undefined };
  'layout:reset': { req: undefined; res: undefined };
  'diagnostics:get': { req: { rendererErrors?: string[] } | undefined; res: DiagnosticInfo };
  'diagnostics:copy': { req: { extra?: string } | undefined; res: undefined };
  'shell:openLogFolder': { req: undefined; res: undefined };
  /** Shows an open dialog; null when cancelled. */
  'project:open': { req: undefined; res: ProjectFile | null };
  'project:openRecent': { req: { path: string }; res: ProjectFile };
  /** Save to a path previously granted by a dialog/open/recent. */
  'project:save': { req: { path: string; text: string; thumbnail?: string | null }; res: undefined };
  /** Shows a save dialog; returns the chosen path, or null when cancelled. */
  'project:saveAs': { req: { text: string; suggestedName: string; thumbnail?: string | null }; res: string | null };
  /** Consent: let the opened project read its pending folders (remembered per project). */
  'project:allowFolders': { req: { path: string }; res: undefined };
  /** Undo history saved next to a project (JSON text), or null. */
  'project:readHistory': { req: { path: string }; res: string | null };
  'project:writeHistory': { req: { path: string; text: string }; res: undefined };
  'recent:list': { req: undefined; res: RecentProject[] };
  'recent:remove': { req: { path: string }; res: undefined };
  /** Reveal a recent/granted file in Explorer. */
  'shell:showItemInFolder': { req: { path: string }; res: undefined };
  /** Renderer reports unsaved changes so main can guard window close. */
  'window:setDirty': { req: { dirty: boolean }; res: undefined };
  /** Pick a model file to import (grants its folder for side files and textures). */
  'import:pickSource': { req: undefined; res: { path: string; format: SourceFormat; bytes: number } | null };
  /** Read a model/texture/side file inside a granted folder. */
  'import:readFile': { req: { path: string }; res: Uint8Array };
  /** Resolve texture references for a model (see src/main/import/textures.ts). */
  'import:resolveTextures': {
    req: { sourcePath: string; refs: string[]; textureDirs: string[] };
    res: { resolved: Record<string, string | null>; truncated: boolean };
  };
  /** "Locate folder…" for missing textures; grants the folder. */
  'import:pickTextureDir': { req: undefined; res: string | null };
  /** Pick an Assetto Corsa car folder and read it (model, skins, data files). */
  'ac:pickCar': { req: undefined; res: AcCarInfo | null };
  /** Complete engines and gearboxes from the BeamNG install. */
  'powertrain:catalogue': { req: undefined; res: SuspensionSet[] };
  /** Complete suspensions from the BeamNG install (empty until the install is set and read). */
  'suspension:catalogue': { req: undefined; res: SuspensionSet[] };
  /** A set's jbeam part definitions and the body nodes it attaches to (original positions). */
  'suspension:set': { req: { id: string }; res: { parts: Record<string, JbeamObject>; anchors: Record<string, [number, number, number]>; root: string; options?: SetOptions } | null };
  /** Your library folders: what each one gave, and whether a scan is running. */
  'library:status': { req: undefined; res: LibraryStatus };
  /** Scan your library folders again now. */
  'library:rescan': { req: undefined; res: LibraryStatus };
  /** Save a texture baked from a kn5's materials next to its extracted textures; returns its path. */
  'kn5:saveBaked': { req: { kn5Path: string; name: string; bytes: Uint8Array }; res: string };
  /** Save a texture painted or generated in the app (paint masks, liveries) as a PNG; returns its path. */
  'materials:saveTexture': { req: { name: string; bytes: Uint8Array }; res: string };
  /** Save a painted image (livery, paint-slot mask, UV template) where the user picks; returns the path, or null if cancelled. */
  'paint:saveImage': { req: { suggestedName: string; bytes: Uint8Array }; res: string | null };
  /** Save a vinyl group (.jbvinyl) where the user picks; returns the path, or null if cancelled. */
  'vinyl:save': { req: { suggestedName: string; text: string }; res: string | null };
  /** Open a vinyl group file the user picks. */
  'vinyl:open': { req: undefined; res: { path: string; text: string } | null };
  /** Save a text file of one of the app's kinds (.pc configuration, .lua script…) where the user picks; the path, or null if cancelled. */
  'file:saveText': { req: { kind: TextFileKind; suggestedName: string; text: string }; res: string | null };
  /** Open text files of one kind the user picks (several when `multiple`). */
  'file:openText': { req: { kind: TextFileKind; multiple?: boolean }; res: { path: string; name: string; text: string }[] };
  /** Pick an image for a material slot; its folder becomes readable. */
  'materials:pickTexture': { req: undefined; res: string | null };
  'materials:library': { req: undefined; res: LibraryItem[] };
  /** The material pack that ships with the app (read-only). */
  'materials:pack': { req: undefined; res: LibraryItem[] };
  /** The objects pack that ships with the app. */
  'objects:list': { req: undefined; res: ObjectItem[] };
  'materials:saveToLibrary': { req: { name: string; category: string; def: MaterialDef }; res: LibraryItem[] };
  'materials:removeFromLibrary': { req: { id: string }; res: LibraryItem[] };
  'materials:exportJbmat': { req: { name: string; category: string; def: MaterialDef }; res: string | null };
  /** Pick a .jbmat or a material pack (.zip) and add its materials to the library; null when cancelled. */
  'materials:importJbmat': { req: undefined; res: { items: LibraryItem[]; added: number; skipped: number } | null };
  /** Find a project's source file on disk (relative path, absolute path, next to the project). */
  'import:locateSource': { req: { projectPath: string | null; path: string; absolutePath: string }; res: string | null };
  /** run-desktop harness only (registered only in harness mode): scripted dialog answers. */
  'harness:queueDialog': { req: { answers: (string | null)[] }; res: undefined };
  /** The user-global taxonomy layer (userData/user-taxonomy.json). */
  'taxonomy:getUser': { req: undefined; res: TaxonomyEntry[] };
  /** Replace the user layer; rejects when the merged taxonomy would be invalid. */
  'taxonomy:saveUser': { req: { entries: TaxonomyEntry[] }; res: TaxonomyEntry[] };
  /** Install the exported mod unpacked into BeamNG's mods/unpacked/<slug> (replaces only our own previous export). */
  'export:install': { req: ExportBundle; res: { path: string; bytes: number } };
  /** Save the exported mod as a zip (save dialog); null when cancelled. */
  'export:zip': { req: ExportBundle; res: { path: string; bytes: number } | null };
  /** A folder ready to upload to the BeamNG repository: the mod zip, README, description, pictures and the checklist. */
  'export:publish': { req: { bundle: ExportBundle; listing: PublishListing }; res: { path: string; bytes: number } | null };
  /** Save a re-exported model (.glb binary or .dae text) wherever the user picks. */
  'export:saveModel': { req: { suggestedName: string; format: 'glb' | 'dae'; data: Uint8Array | string }; res: { path: string; bytes: number } | null };
  /** Reveal the last export in Explorer. */
  'export:reveal': { req: undefined; res: undefined };
  'beamng:detect': { req: undefined; res: BeamngDetection };
  'beamng:validate': { req: { dir: string }; res: InstallValidation };
  /** Engine sound blends in the install (fork): names an engine's soundConfig sampleName can take. */
  'beamng:engineSounds': { req: undefined; res: { name: string }[] };
  /** A sound blend's recorded samples by rpm and load, for the rev preview. */
  'beamng:soundSamples': { req: { name: string }; res: { path: string; rpm: number; load: number }[] };
  /** One sample file's bytes (null when the install doesn't have it). */
  'beamng:soundFile': { req: { path: string }; res: Uint8Array | null };
  /** Material names in the game's vehicle zips (fork), for using a stock material by name. */
  'beamng:gameMaterials': { req: undefined; res: { name: string; vehicle: string; paint: boolean }[] };
  'dialog:pickDirectory': { req: { title?: string; defaultPath?: string } | undefined; res: string | null };
  /** Downloads: the content folder and what's installed of textures and meshes. */
  'content:info': { req: undefined; res: ContentInfo };
  /** A content repository's manifest at a branch or tag (default: the latest). */
  'content:manifest': { req: { kind: ContentKind; ref?: string }; res: ContentManifest };
  /** The latest and every tagged version of a content repository. */
  'content:refs': { req: { kind: ContentKind }; res: ContentRef[] };
  /** Download and install all or some items; progress arrives as content:progress. */
  'content:download': { req: { kind: ContentKind; ref: string; ids: string[] | 'all' }; res: DownloadResult };
  'content:cancel': { req: { kind: ContentKind }; res: undefined };
  'content:remove': { req: { kind: ContentKind; ids: string[] | 'all' }; res: string[] };
  /** Show the content folder (or one kind's) in the file manager. */
  'content:reveal': { req: { kind?: ContentKind }; res: undefined };
  /** App versions on GitHub, newest first, and what's already downloaded. */
  'updates:info': { req: undefined; res: UpdatesInfo };
  /** Download one release file (installer, portable exe); progress arrives as updates:progress. */
  'updates:download': { req: { tag: string; asset: string }; res: string };
  'updates:cancel': { req: undefined; res: undefined };
  /** Run a downloaded installer (the app closes), or show a portable exe in its folder. */
  'updates:run': { req: { asset: string }; res: 'installing' | 'shown' };
  'updates:clear': { req: undefined; res: undefined };
  /** Show the settings file in the file manager. */
  'app:revealSettings': { req: undefined; res: undefined };
}

/** Commands the native menu forwards to the renderer. */
export const APP_COMMANDS = ['new', 'open', 'save', 'saveAs', 'close', 'import', 'importAc', 'undo', 'redo', 'selectAll', 'palette', 'shortcuts', 'settings', 'downloads', 'exportModelGlb', 'exportModelDae'] as const;
export type AppCommand = (typeof APP_COMMANDS)[number];

/** Payload types for main → renderer events. */
export interface EventContract {
  'menu:resetLayout': undefined;
  'menu:applyPreset': { preset: string };
  'settings:changed': Settings;
  'status:message': { text: string; tone: 'info' | 'success' | 'warning' | 'danger' };
  'menu:command': { command: AppCommand };
  /** Your library folders were scanned: reload the material pack and objects lists. */
  'library:changed': LibraryStatus;
  /** Downloaded textures or meshes changed: reload the packs. */
  'content:changed': { kind: ContentKind };
  'content:progress': ContentProgress;
  'updates:progress': { asset: string; done: number; total: number };
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;

export const INVOKE_CHANNELS = [
  'settings:get',
  'settings:update',
  'layout:load',
  'layout:save',
  'layout:reset',
  'diagnostics:get',
  'diagnostics:copy',
  'shell:openLogFolder',
  'project:open',
  'project:openRecent',
  'project:save',
  'project:saveAs',
  'recent:list',
  'recent:remove',
  'shell:showItemInFolder',
  'window:setDirty',
  'harness:queueDialog',
  'beamng:detect',
  'beamng:validate',
  'beamng:gameMaterials',
  'beamng:engineSounds',
  'beamng:soundSamples',
  'beamng:soundFile',
  'dialog:pickDirectory',
  'import:pickSource',
  'import:readFile',
  'import:resolveTextures',
  'import:pickTextureDir',
  'ac:pickCar',
  'suspension:catalogue',
  'powertrain:catalogue',
  'suspension:set',
  'library:status',
  'library:rescan',
  'kn5:saveBaked',
  'materials:saveTexture',
  'paint:saveImage',
  'vinyl:save',
  'vinyl:open',
  'file:saveText',
  'file:openText',
  'materials:pickTexture',
  'materials:library',
  'materials:pack',
  'objects:list',
  'materials:saveToLibrary',
  'materials:removeFromLibrary',
  'materials:exportJbmat',
  'materials:importJbmat',
  'import:locateSource',
  'project:allowFolders',
  'project:readHistory',
  'project:writeHistory',
  'taxonomy:getUser',
  'taxonomy:saveUser',
  'export:install',
  'export:zip',
  'export:publish',
  'export:saveModel',
  'export:reveal',
  'content:info',
  'content:manifest',
  'content:refs',
  'content:download',
  'content:cancel',
  'content:remove',
  'content:reveal',
  'updates:info',
  'updates:download',
  'updates:cancel',
  'updates:run',
  'updates:clear',
  'app:revealSettings',
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = [
  'menu:resetLayout',
  'menu:applyPreset',
  'settings:changed',
  'status:message',
  'menu:command',
  'library:changed',
  'content:changed',
  'content:progress',
  'updates:progress',
] as const satisfies readonly EventChannel[];

/** API surface exposed on `window.forge` by the preload script. */
export interface ForgeApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeContract[C]['req'] extends undefined
      ? [req?: InvokeContract[C]['req']]
      : [req: InvokeContract[C]['req']]
  ): Promise<IpcResult<InvokeContract[C]['res']>>;
  on<E extends EventChannel>(channel: E, listener: (payload: EventContract[E]) => void): () => void;
  /** True when launched by the run-desktop harness (enables test hooks). */
  readonly harness: boolean;
  readonly isDev: boolean;
}
