import { z } from 'zod';

/**
 * Vehicle scripts (fork): Lua controllers that ship with the car. Each is
 * made from a template (its settings set in easy mode) or written by hand
 * (advanced mode, `code` set). On export each becomes a controller file,
 * a row in its part's jbeam `controller` section (with its settings), and
 * input actions the player can bind.
 */

export const SCRIPT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const ScriptParamValueSchema = z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]);
export type ScriptParamValue = z.infer<typeof ScriptParamValueSchema>;

/** A key the player presses, and the function of the script it calls. */
export const ScriptActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(80),
  /** BeamNG control name ("lctrl w", "numpad5"…); empty = not bound by default. */
  key: z.string().max(40),
  /** Lua called on the script's module: "toggle()", "set(1)". */
  call: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*\([^\n]{0,200}\)$/),
});
export type ScriptAction = z.infer<typeof ScriptActionSchema>;

export const VehicleScriptSchema = z.object({
  id: z.string().min(1),
  /** The controller's name in the game (Lua identifier-like, unique on the car). */
  name: z.string().regex(SCRIPT_NAME_PATTERN),
  /** Shown in the app. */
  label: z.string().min(1).max(80),
  /** The template it's made from; null = written by hand. */
  templateId: z.string().nullable(),
  enabled: z.boolean(),
  /** The template's settings (mesh lists included), passed to the script as its jbeam data. */
  params: z.record(z.string(), ScriptParamValueSchema),
  /** Hand-written or edited Lua; null = the template's own. */
  code: z.string().max(500_000).nullable(),
  /** The part that carries it (it runs only when that part is on the car); null = the body. */
  partId: z.string().nullable(),
  /** Keys: the template's actions with the user's keys, or a hand-written script's own. */
  actions: z.array(ScriptActionSchema).optional(),
});
export type VehicleScript = z.infer<typeof VehicleScriptSchema>;

/** A script saved to the user's library (or downloaded): enough to add it to any car. */
export const LibraryScriptSchema = z.object({
  format: z.literal('jbforge-script'),
  version: z.literal(1),
  name: z.string().regex(SCRIPT_NAME_PATTERN),
  label: z.string().min(1).max(80),
  description: z.string().max(4000),
  category: z.string().max(40),
  templateId: z.string().nullable(),
  params: z.record(z.string(), ScriptParamValueSchema),
  code: z.string().max(500_000).nullable(),
  actions: z.array(ScriptActionSchema).optional(),
  author: z.string().max(120).optional(),
});
export type LibraryScript = z.infer<typeof LibraryScriptSchema>;
