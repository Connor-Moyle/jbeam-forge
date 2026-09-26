import type { Settings, SettingsPatch } from './settings-schema';
import type { StoredLayout } from './layout-schema';
import type { BeamngDetection, InstallValidation } from './beamng';

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

export interface ProjectReadResult {
  path: string;
  text: string;
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
  'project:read': { req: { path: string }; res: ProjectReadResult };
  'project:write': { req: { path: string; text: string }; res: undefined };
  'beamng:detect': { req: undefined; res: BeamngDetection };
  'beamng:validate': { req: { dir: string }; res: InstallValidation };
  'dialog:pickDirectory': { req: { title?: string; defaultPath?: string } | undefined; res: string | null };
}

/** Payload types for main → renderer events. */
export interface EventContract {
  'menu:resetLayout': undefined;
  'menu:applyPreset': { preset: string };
  'settings:changed': Settings;
  'status:message': { text: string; tone: 'info' | 'success' | 'warning' | 'danger' };
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
  'project:read',
  'project:write',
  'beamng:detect',
  'beamng:validate',
  'dialog:pickDirectory',
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = [
  'menu:resetLayout',
  'menu:applyPreset',
  'settings:changed',
  'status:message',
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
