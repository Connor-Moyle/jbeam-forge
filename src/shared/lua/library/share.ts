import { defaultParams, type ScriptTemplate } from '../templates';
import { LibraryScriptSchema, type LibraryScript, type VehicleScript } from '../types';

/**
 * Scripts as files (fork): a template or a car's script saved to the user's
 * library (.jbscript), shared, downloaded from the scripts repository, and
 * added to another car.
 */

export function templateToLibrary(t: ScriptTemplate): LibraryScript {
  return { format: 'jbforge-script', version: 1, name: t.name0, label: t.name, description: t.description, category: t.category, templateId: t.id, params: defaultParams(t), code: null };
}

/** A car's script for the library: its settings and code, without the meshes it was pointed at (another car has others). */
export function scriptToLibrary(s: VehicleScript, t: ScriptTemplate | undefined, description: string, author?: string): LibraryScript {
  const params = Object.fromEntries(Object.entries(s.params).filter(([k, v]) => {
    const def = t?.params.find((p) => p.id === k);
    return !(def?.kind === 'meshes' || def?.kind === 'mesh' || Array.isArray(v));
  }));
  return {
    format: 'jbforge-script',
    version: 1,
    name: s.name,
    label: s.label,
    description: description || t?.description || '',
    category: t?.category ?? 'My scripts',
    templateId: s.templateId,
    params,
    code: s.code ?? (t ? null : ''),
    ...(s.actions?.length ? { actions: s.actions } : {}),
    ...(author ? { author } : {}),
  };
}

/** Read a .jbscript file (throws with a readable message). */
export function parseLibraryScript(text: string, file = 'The file'): LibraryScript {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${file} isn't a JBeam Forge script (not JSON).`);
  }
  const r = LibraryScriptSchema.safeParse(raw);
  if (!r.success) throw new Error(`${file} isn't a JBeam Forge script: ${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? ''}`.trim());
  return r.data;
}

/** A unique controller name on the car, from a wanted one. */
export function uniqueScriptName(want: string, taken: ReadonlySet<string>): string {
  const base = want.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 34) || 'script';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
  return name;
}

/** A library entry as a script on this car (the template's defaults fill in what it doesn't say). */
export function libraryToScript(entry: LibraryScript, t: ScriptTemplate | undefined, taken: ReadonlySet<string>, id: string): VehicleScript {
  return {
    id,
    name: uniqueScriptName(entry.name, taken),
    label: entry.label,
    templateId: t ? entry.templateId : null,
    enabled: true,
    params: { ...(t ? defaultParams(t) : {}), ...entry.params },
    code: entry.code ?? (t ? null : ''),
    partId: null,
    ...(entry.actions?.length ? { actions: entry.actions } : {}),
  };
}

/** The starting point of a hand-written script. */
export const BLANK_SCRIPT = `-- A vehicle script (controller). The game calls the functions you put in M.
-- Settings come in as jbeamData (the controller's row in the jbeam).
local M = {}
M.type = "auxiliary"

local out = "jbf_myscript"
local value = 0

-- Once, when the car spawns.
local function init(jbeamData)
  out = jbeamData.out or out
  value = 0
end

-- Every frame (dt: seconds since the last one).
local function updateGFX(dt)
  local speed = electrics.values.wheelspeed or 0 -- m/s
  value = clamp(speed / 30, 0, 1)
  electrics.values[out] = value
end

-- Called from a key (add one under Keys).
local function toggle()
  guihooks.message("Hello from my script", 2, "myscript")
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
return M
`;
