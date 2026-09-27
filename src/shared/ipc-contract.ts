import type { Settings, SettingsPatch } from './settings-schema';
import type { MaterialDef } from './materials/schema';

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
  /** Save a texture baked from a kn5's materials next to its extracted textures; returns its path. */
  'kn5:saveBaked': { req: { kn5Path: string; name: string; bytes: Uint8Array }; res: string };
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
  /** Save a re-exported model (.glb binary or .dae text) wherever the user picks. */
  'export:saveModel': { req: { suggestedName: string; format: 'glb' | 'dae'; data: Uint8Array | string }; res: { path: string; bytes: number } | null };
  /** Reveal the last export in Explorer. */
  'export:reveal': { req: undefined; res: undefined };
  'beamng:detect': { req: undefined; res: BeamngDetection };
  'beamng:validate': { req: { dir: string }; res: InstallValidation };
  'dialog:pickDirectory': { req: { title?: string; defaultPath?: string } | undefined; res: string | null };
}

/** Commands the native menu forwards to the renderer. */
export const APP_COMMANDS = ['new', 'open', 'save', 'saveAs', 'close', 'import', 'importAc', 'undo', 'redo', 'selectAll', 'palette', 'shortcuts', 'settings', 'exportModelGlb', 'exportModelDae'] as const;
export type AppCommand = (typeof APP_COMMANDS)[number];

/** Payload types for main → renderer events. */
export interface EventContract {
  'menu:resetLayout': undefined;
  'menu:applyPreset': { preset: string };
  'settings:changed': Settings;
  'status:message': { text: string; tone: 'info' | 'success' | 'warning' | 'danger' };
  'menu:command': { command: AppCommand };
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
  'dialog:pickDirectory',
  'import:pickSource',
  'import:readFile',
  'import:resolveTextures',
  'import:pickTextureDir',
  'ac:pickCar',
  'kn5:saveBaked',
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
  'export:saveModel',
  'export:reveal',
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = [
  'menu:resetLayout',
  'menu:applyPreset',
  'settings:changed',
  'status:message',
  'menu:command',
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
