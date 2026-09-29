import { lauxlib, lua, lualib, to_jsstring, to_luastring } from 'fengari';

/**
 * The script test runner (fork): runs a vehicle script in a real Lua VM
 * (fengari, Lua 5.3 with LuaJIT's missing bits shimmed) against stand-ins
 * for BeamNG's vehicle API, through a driving scenario: electrics and inputs
 * over time, key presses at set times. It records every electrics value the
 * script writes, what it logs or shows on screen, the sounds it plays, and
 * the first error with its line. The game is the real test; this catches
 * mistakes and shows what the script does before you go in.
 *
 * Kept free of the DOM so it runs in a worker (the app) and in tests.
 */

export interface SandboxScenario {
  seconds: number;
  tracks: { name: string; points: [number, number][] }[];
  /** Lua called on the module at a time: "toggle()", "nudge(-1)". */
  presses: { at: number; call: string; label?: string }[];
  /** Glass or other beams that break at a time (by cid). */
  breaks?: { at: number; cid: number }[];
}

export interface SandboxInput {
  code: string;
  jbeamData: Record<string, unknown>;
  /** A small v.data: nodes and beams (with break groups) from the project. */
  vdata?: { nodes?: { cid: number; pos: [number, number, number] }[]; beams?: { cid: number; breakGroup?: string }[] };
  scenario: SandboxScenario;
  /** Frames per second of updateGFX (60 in game). */
  fps?: number;
  /** Instructions one call into the script may take before it's stopped as an endless loop. */
  budget?: number;
}

export interface SandboxResult {
  ok: boolean;
  error: { message: string; line: number | null; at: number | null } | null;
  times: number[];
  /** Electrics values the script wrote, sampled at `times`. */
  series: Record<string, number[]>;
  /** The scenario's own values, for reference. */
  inputs: Record<string, number[]>;
  log: { t: number; kind: 'print' | 'log' | 'message' | 'call' | 'press' | 'error'; msg: string }[];
  /** Sound sources the script made: volume and pitch over time. */
  sounds: Record<string, { file: string; volume: number[]; pitch: number[]; playing: number[] }>;
  hooks: string[];
}

/** A JS value as a Lua literal. */
export function luaLiteral(v: unknown, depth = 0): string {
  if (depth > 20) return 'nil';
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '')}"`;
  if (Array.isArray(v)) return `{${v.map((x) => luaLiteral(x, depth + 1)).join(',')}}`;
  if (typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      // Whole-number keys stay numbers (v.data.nodes[cid]).
      .map(([k, x]) => `[${/^-?\d{1,15}$/.test(k) ? k : luaLiteral(k)}]=${luaLiteral(x, depth + 1)}`)
      .join(',')}}`;
  }
  return 'nil';
}

/** The stand-in vehicle environment and the runner, in Lua. */
const PRELUDE = String.raw`
local __log, __t, __sounds, __soundOrder = {}, 0, {}, {}
local function __push(kind, msg)
  if #__log < 400 then __log[#__log + 1] = { t = __t, kind = kind, msg = tostring(msg) } end
end

-- LuaJIT (5.1) names on this Lua 5.3.
unpack = table.unpack
loadstring = load
math.pow = function(a, b) return a ^ b end
math.mod = math.fmod
bit = {
  band = function(a, b) return math.floor(a) & math.floor(b) end,
  bor = function(a, b) return math.floor(a) | math.floor(b) end,
  bxor = function(a, b) return math.floor(a) ~ math.floor(b) end,
  bnot = function(a) return ~math.floor(a) end,
  lshift = function(a, n) return math.floor(a) << n end,
  rshift = function(a, n) return math.floor(a) >> n end,
}

local function __ser(v, depth)
  depth = depth or 0
  if type(v) ~= "table" then return tostring(v) end
  if depth > 3 then return "{…}" end
  local parts = {}
  for k, x in pairs(v) do
    parts[#parts + 1] = tostring(k) .. " = " .. __ser(x, depth + 1)
    if #parts > 30 then parts[#parts + 1] = "…" break end
  end
  return "{ " .. table.concat(parts, ", ") .. " }"
end

function print(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end
  __push("print", table.concat(t, "  "))
end
function log(level, origin, msg) __push("log", tostring(level) .. " " .. tostring(origin) .. ": " .. tostring(msg)) end
function dump(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = __ser((select(i, ...))) end __push("print", table.concat(t, "  ")) end
function dumpz(v, depth) __push("print", __ser(v, 3 - (depth or 3))) end
function clamp(x, a, b) return math.min(math.max(x, a), b) end
function lerp(a, b, t) return a + (b - a) * t end
function sign(x) return x > 0 and 1 or (x < 0 and -1 or 0) end
function round(x) return math.floor(x + 0.5) end

local vecmt = {}
vecmt.__index = vecmt
function vec3(x, y, z)
  if type(x) == "table" then return setmetatable({ x = x.x or x[1] or 0, y = x.y or x[2] or 0, z = x.z or x[3] or 0 }, vecmt) end
  return setmetatable({ x = x or 0, y = y or 0, z = z or 0 }, vecmt)
end
vecmt.__add = function(a, b) return vec3(a.x + b.x, a.y + b.y, a.z + b.z) end
vecmt.__sub = function(a, b) return vec3(a.x - b.x, a.y - b.y, a.z - b.z) end
vecmt.__mul = function(a, b)
  if type(a) == "number" then return vec3(b.x * a, b.y * a, b.z * a) end
  if type(b) == "number" then return vec3(a.x * b, a.y * b, a.z * b) end
  return vec3(a.x * b.x, a.y * b.y, a.z * b.z)
end
vecmt.__unm = function(a) return vec3(-a.x, -a.y, -a.z) end
vecmt.__tostring = function(a) return "vec3(" .. a.x .. ", " .. a.y .. ", " .. a.z .. ")" end
function vecmt:length() return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z) end
function vecmt:squaredLength() return self.x * self.x + self.y * self.y + self.z * self.z end
function vecmt:normalized() local l = self:length() if l < 1e-12 then return vec3(0, 0, 0) end return vec3(self.x / l, self.y / l, self.z / l) end
function vecmt:dot(b) return self.x * b.x + self.y * b.y + self.z * b.z end
function vecmt:cross(b) return vec3(self.y * b.z - self.z * b.y, self.z * b.x - self.x * b.z, self.x * b.y - self.y * b.x) end
function vecmt:distance(b) return (self - b):length() end

function newTemporalSmoothing(inRate, outRate, autoCenterRate, start)
  local s = { value = start or 0, inRate = inRate or 1, outRate = outRate or inRate or 1 }
  function s:get(target, dt)
    local rate = math.abs(target) > math.abs(self.value) and self.inRate or self.outRate
    local step = rate * dt
    if self.value < target then self.value = math.min(target, self.value + step) else self.value = math.max(target, self.value - step) end
    return self.value
  end
  function s:getUncapped(target, dt) return self:get(target, dt) end
  function s:set(v) self.value = v end
  function s:reset() self.value = start or 0 end
  return s
end
function newTemporalSmoothingNonLinear(inRate, outRate, start)
  local s = { value = start or 0 }
  function s:get(target, dt) self.value = self.value + (target - self.value) * math.min(1, (inRate or 1) * dt) return self.value end
  function s:set(v) self.value = v end
  function s:reset() self.value = start or 0 end
  return s
end
function newExponentialSmoothing(window, start)
  local s = { value = start or 0, k = 2 / ((window or 1) + 1) }
  function s:get(sample) self.value = self.value + (sample - self.value) * self.k return self.value end
  function s:set(v) self.value = v end
  function s:reset() self.value = start or 0 end
  return s
end

-- Electrics: remember which values the script writes (the scenario writes through rawset).
local __ev, __written = {}, {}
electrics = { values = setmetatable({}, {
  __index = function(_, k) return __ev[k] end,
  __newindex = function(_, k, v) if type(v) == "boolean" then v = v and 1 or 0 end __ev[k] = v __written[k] = true end,
  __pairs = function() return next, __ev, nil end,
}) }
function electrics.setIgnitionLevel(l) __ev.ignitionLevel = l __push("call", "ignition " .. tostring(l)) end
function electrics.toggle_lights() __ev.lights = ((__ev.lights or 0) + 1) % 3 __push("call", "lights " .. __ev.lights) end
function electrics.setLightsState(s) __ev.lights = s __push("call", "lights " .. tostring(s)) end
function electrics.toggle_left_signal() __ev.signal_left_input = 1 - (__ev.signal_left_input or 0) __push("call", "left indicator") end
function electrics.toggle_right_signal() __ev.signal_right_input = 1 - (__ev.signal_right_input or 0) __push("call", "right indicator") end
function electrics.toggle_warn_signal() __ev.hazard = 1 - (__ev.hazard or 0) __push("call", "hazards " .. (__ev.hazard == 1 and "on" or "off")) end
function electrics.set_fog_lights(on) __ev.fog = on and 1 or 0 end
function electrics.horn(on) __ev.horn = on and 1 or 0 end

input = { throttle = 0, brake = 0, steering = 0, clutch = 0, parkingbrake = 0 }
function input.event(name, value) input[name] = value __push("call", "input " .. tostring(name) .. " = " .. tostring(value)) end

guihooks = {
  message = function(msg, ttl) __push("message", type(msg) == "table" and (msg.txt or __ser(msg)) or msg) end,
  trigger = function(event) __push("call", "UI event " .. tostring(event)) end,
}

local __broken = {}
local __sid = 0
obj = {}
function obj:getId() return 1 end
function obj:getPosition() return vec3(0, 0, 0) end
function obj:getVelocity() return vec3(0, -(__ev.wheelspeed or 0), 0) end
function obj:getDirectionVector() return vec3(0, -1, 0) end
function obj:getDirectionVectorUp() return vec3(0, 0, 1) end
function obj:getAirDensity() return 1.2 end
function obj:getNodePosition(cid) local n = v.data.nodes and v.data.nodes[cid] return n and vec3(n.pos) or vec3(0, 0, 0) end
function obj:beamIsBroken(cid) return __broken[cid] == true end
function obj:queueGameEngineLua(code) __push("call", "game engine Lua: " .. tostring(code)) end
function obj:createSFXSource(file, profile, name, node)
  __sid = __sid + 1
  local id = "sfx" .. __sid
  __sounds[id] = { file = tostring(file), volume = 1, pitch = 1, playing = 0 }
  __soundOrder[#__soundOrder + 1] = id
  __push("call", "sound source " .. tostring(file))
  return id
end
obj.createSFXSource2 = obj.createSFXSource
function obj:playSFX(id) if __sounds[id] then __sounds[id].playing = 1 end end
function obj:stopSFX(id) if __sounds[id] then __sounds[id].playing = 0 end end
function obj:setVolume(id, vol) if __sounds[id] then __sounds[id].volume = vol end end
function obj:setPitch(id, p) if __sounds[id] then __sounds[id].pitch = p end end
function obj:setVolumePitch(id, vol, p) if __sounds[id] then __sounds[id].volume = vol __sounds[id].pitch = p end end

local function stub(name)
  return setmetatable({}, { __index = function(_, k) return function() __push("call", name .. "." .. tostring(k) .. "()") end end })
end
local __devices = {
  mainEngine = { name = "mainEngine", type = "combustionEngine", revLimiterAV = 7000 * math.pi / 30, maxRPM = 7000, instantAfterFireCoef = 0, sustainedAfterFireCoef = 0, outputAV1 = 0 },
  gearbox = { name = "gearbox", type = "manualGearbox", gearIndex = 1 },
}
powertrain = {
  getDevice = function(name) return __devices[name] end,
  getDevices = function() return __devices end,
  setDeviceMode = function(name, mode) __push("call", "device " .. tostring(name) .. " mode " .. tostring(mode)) end,
}
local __controllers = {}
controller = {
  getController = function(name) return __controllers[name] end,
  getControllerSafe = function(name) return __controllers[name] or stub(name) end,
  mainController = stub("mainController"),
}
sensors = { gx = 0, gy = 0, gz = -9.81 }
beamstate = stub("beamstate")
damageTracker = { getDamage = function() return false end, setDamage = function() end }
wheels = { wheels = {}, wheelRotators = {} }
hydros = { hydros = {} }
`;

const RUNNER = String.raw`
v = { data = __VDATA }
local times, series, inputs, snd = {}, {}, {}, {}
local result = { ok = true, error = nil }
local function fail(err, at)
  local msg = tostring(err)
  local line = tonumber(msg:match("^script:(%d+):"))
  msg = msg:gsub("^script:%d+:%s*", "")
  result.ok = false
  result.error = { message = msg, line = line, at = at }
  __push("error", msg)
end

local function interp(points, t)
  if #points == 0 then return 0 end
  if t <= points[1][1] then return points[1][2] end
  for i = 2, #points do
    local a, b = points[i - 1], points[i]
    if t <= b[1] then
      local k = (b[1] > a[1]) and (t - a[1]) / (b[1] - a[1]) or 1
      return a[2] + (b[2] - a[2]) * k
    end
  end
  return points[#points][2]
end

local INPUTS = { throttle = true, brake = true, steering_input = true, clutch = true, parkingbrake = true }
local function applyTracks(t)
  __ev.ignitionLevel = __ev.ignitionLevel or 2
  __ev.lights = __ev.lights or 0
  __ev.wheelspeed = __ev.wheelspeed or 0
  for _, track in ipairs(__SCENARIO.tracks) do
    local value = interp(track.points, t)
    rawset(__ev, track.name, value)
    if INPUTS[track.name] then input[track.name == "steering_input" and "steering" or track.name] = value end
  end
  if __ev.airspeed == nil then __ev.airspeed = __ev.wheelspeed end
  if __ev.rpmTacho == nil and __ev.rpm then __ev.rpmTacho = __ev.rpm end
end

-- The step budget is per call into the script, so a long test of a busy script is fine.
local function abort() error("stopped after too many steps: an endless loop?", 2) end
local function guarded(fn, ...)
  debug.sethook(abort, "", __BUDGET)
  local r = table.pack(pcall(fn, ...))
  debug.sethook()
  return table.unpack(r, 1, r.n)
end

local chunk, err = load(__CODE, "=script")
local M = nil
if not chunk then
  fail(err, 0)
else
  local ok, mod = guarded(chunk)
  if not ok then fail(mod, 0)
  elseif type(mod) ~= "table" then fail("the script must return its module table (return M)", 0)
  else M = mod end
end

local hooks = {}
if M then
  for _, name in ipairs({ "init", "initSecondStage", "initSounds", "reset", "updateGFX", "update" }) do
    if type(M[name]) == "function" then hooks[#hooks + 1] = name end
  end
  __controllers[__JBEAM.name or "script"] = M
  applyTracks(0)
  for _, name in ipairs({ "init", "initSecondStage", "initSounds" }) do
    if result.ok and type(M[name]) == "function" then
      local ok, e = guarded(M[name], __JBEAM)
      if not ok then fail(e, 0) end
    end
  end
end

local dt = 1 / __FPS
local frames = math.floor(__SCENARIO.seconds * __FPS + 0.5)
local every = math.max(1, math.floor(__FPS / 30 + 0.5))
local nextPress = 1
local presses = __SCENARIO.presses
table.sort(presses, function(a, b) return a.at < b.at end)
local breaks = __SCENARIO.breaks or {}
local function sample(t)
  times[#times + 1] = t
  local n = #times
  for k, _ in pairs(__written) do
    local s = series[k]
    if not s then s = {} for i = 1, n - 1 do s[i] = 0 end series[k] = s end
    local x = __ev[k]
    s[n] = type(x) == "number" and x or (x and 1 or 0)
  end
  for _, track in ipairs(__SCENARIO.tracks) do
    local s = inputs[track.name] or {}
    inputs[track.name] = s
    s[n] = rawget(__ev, track.name) or 0
  end
  for _, id in ipairs(__soundOrder) do
    local s = snd[id]
    if not s then
      -- Made after the start: silent until then, like the series.
      s = { file = __sounds[id].file, volume = {}, pitch = {}, playing = {} }
      for i = 1, n - 1 do s.volume[i], s.pitch[i], s.playing[i] = 0, 1, 0 end
      snd[id] = s
    end
    s.volume[n], s.pitch[n], s.playing[n] = __sounds[id].volume, __sounds[id].pitch, __sounds[id].playing
  end
end

if M and result.ok then
  sample(0)
  for f = 1, frames do
    __t = f * dt
    applyTracks(__t)
    for _, b in ipairs(breaks) do if b.at <= __t and not __broken[b.cid] then __broken[b.cid] = true __push("call", "beam " .. b.cid .. " breaks") end end
    while nextPress <= #presses and presses[nextPress].at <= __t do
      local p = presses[nextPress]
      nextPress = nextPress + 1
      __push("press", p.label or p.call)
      local fn, e = load("local M = ... return M." .. p.call, "=press")
      if not fn then fail("key " .. p.call .. ": " .. tostring(e), __t) break end
      local ok, e2 = guarded(fn, M)
      if not ok then fail(e2, __t) break end
    end
    if not result.ok then break end
    for _, name in ipairs({ "update", "updateGFX" }) do
      if type(M[name]) == "function" then
        local ok, e = guarded(M[name], dt)
        if not ok then fail(e, __t) break end
      end
    end
    if not result.ok then break end
    if f % every == 0 then sample(__t) end
  end
end

-- JSON out.
local function enc(x)
  local t = type(x)
  if t == "nil" then return "null" end
  if t == "boolean" then return x and "true" or "false" end
  if t == "number" then if x ~= x or x == math.huge or x == -math.huge then return "0" end return string.format("%.6g", x) end
  if t == "string" then return '"' .. x:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"' end
  if t == "table" then
    if #x > 0 or next(x) == nil then
      local parts = {}
      for i = 1, #x do parts[i] = enc(x[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, v in pairs(x) do parts[#parts + 1] = enc(tostring(k)) .. ":" .. enc(v) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
return enc({ ok = result.ok, error = result.error or false, times = times, series = series, inputs = inputs, log = __log, sounds = snd, hooks = hooks })
`;

export function runSandbox(input: SandboxInput): SandboxResult {
  const fps = Math.max(10, Math.min(120, input.fps ?? 60));
  const seconds = Math.max(0, Math.min(120, input.scenario.seconds));
  const nodes: Record<number, { pos: [number, number, number] }> = {};
  for (const n of input.vdata?.nodes ?? []) nodes[n.cid] = { pos: n.pos };
  const beams: Record<number, { cid: number; breakGroup?: string }> = {};
  for (const b of input.vdata?.beams ?? []) beams[b.cid] = b;
  const source = [
    PRELUDE,
    `local __CODE = ${luaLiteral(input.code)}`,
    `local __JBEAM = ${luaLiteral(input.jbeamData)}`,
    `local __VDATA = ${luaLiteral({ nodes, beams })}`,
    `local __SCENARIO = ${luaLiteral({ ...input.scenario, seconds })}`,
    `local __FPS = ${fps}`,
    `local __BUDGET = ${Math.max(100_000, Math.min(500_000_000, input.budget ?? 20_000_000))}`,
    RUNNER,
  ].join('\n');
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  try {
    if (lauxlib.luaL_loadstring(L, to_luastring(source)) !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
    const json = to_jsstring(lua.lua_tostring(L, -1));
    const r = JSON.parse(json) as Omit<SandboxResult, 'error' | 'series' | 'inputs' | 'sounds'> & { error: SandboxResult['error'] | false; series: Record<string, number[]> | number[]; inputs: Record<string, number[]> | number[]; sounds: SandboxResult['sounds'] | never[] };
    const obj = <T>(x: T | never[]): T => (Array.isArray(x) ? ({} as T) : x);
    return { ...r, error: r.error || null, series: obj(r.series as Record<string, number[]>), inputs: obj(r.inputs as Record<string, number[]>), sounds: obj(r.sounds) };
  } catch (err) {
    return { ok: false, error: { message: `The test runner failed: ${err instanceof Error ? err.message : String(err)}`, line: null, at: null }, times: [], series: {}, inputs: {}, log: [], sounds: {}, hooks: [] };
  } finally {
    lua.lua_close(L);
  }
}
