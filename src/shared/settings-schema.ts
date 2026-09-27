import { z } from 'zod';

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
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  debugLogging: false,
  beamngInstallDir: null,
  beamngUserDir: null,
  author: null,
  focusGhostOpacity: 0.12,
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
