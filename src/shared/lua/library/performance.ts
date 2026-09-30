import type { ScriptTemplate } from '../templates';

/** Aero, launch control, pops and bangs, shift light: driving and performance. */

export const activeAero: ScriptTemplate = {
  id: 'active_aero',
  name: 'Active rear wing',
  category: 'Performance',
  description: 'A rear wing that rises above a set speed and tucks away below it, and stands up as an air brake under hard braking at speed. A key cycles auto, always up and always down.',
  needs: 'The wing (rises) and, for an air brake, the wing blade (tilts)',
  name0: 'aero',
  params: [
    { id: 'wing', label: 'Wing (rises)', kind: 'meshes', default: [], animate: { output: '', motion: 'slide', from: 0, to: 0.09, axis: [0, 0.35, 1], pivot: 'centre', toParam: 'rise' } },
    { id: 'blade', label: 'Wing blade (tilts)', kind: 'meshes', default: [], animate: { output: 'angle', motion: 'rotate', from: 0, to: 55, axis: [1, 0, 0], pivot: 'front' } },
    { id: 'rise', label: 'Rise', kind: 'number', default: 0.09, min: 0.02, max: 0.4, step: 0.01, unit: 'm', scope: 'animation' },
    { id: 'upSpeed', label: 'Rises above', kind: 'number', default: 90, min: 20, max: 250, step: 5, unit: 'km/h' },
    { id: 'downSpeed', label: 'Tucks away below', kind: 'number', default: 60, min: 0, max: 240, step: 5, unit: 'km/h' },
    { id: 'airBrake', label: 'Air brake under hard braking', kind: 'boolean', default: true },
    { id: 'airBrakeSpeed', label: 'Air brake above', kind: 'number', default: 100, min: 30, max: 300, step: 5, unit: 'km/h', advanced: true },
    { id: 'cruiseAngle', label: 'Blade at speed', kind: 'number', default: 0.2, min: 0, max: 1, step: 0.05, hint: 'Of the full tilt', advanced: true },
    { id: 'seconds', label: 'Travel time', kind: 'number', default: 1.2, min: 0.2, max: 5, step: 0.1, unit: 's', advanced: true },
  ],
  outputs: [
    { suffix: '', label: 'Raised (0 stowed, 1 up)', min: 0, max: 1 },
    { suffix: 'angle', label: 'Blade tilt (1 = air brake)', min: 0, max: 1 },
    { suffix: 'mode', label: 'Mode (0 auto, 1 up, 2 down)', min: 0, max: 2 },
  ],
  actions: [{ id: 'mode', label: 'Wing: auto / up / down', key: 'lctrl g', call: 'cycleMode()', desc: 'Cycle the wing between automatic, always up and always down' }],
  lua: `-- JBeam Forge: active rear wing with air brake.
local M = {}
M.type = "auxiliary"

local MODES = { "auto", "up", "down" }
local out, outAngle, outMode = "jbf_aero", "jbf_aero_angle", "jbf_aero_mode"
local upSpeed, downSpeed = 90, 60
local airBrake, airBrakeSpeed, cruiseAngle = true, 100, 0.2
local seconds = 1.2
local mode = 0
local raised, angle = 0, 0
local wantUp = false

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  outAngle = jbeamData.out_angle or (out .. "_angle")
  outMode = jbeamData.out_mode or (out .. "_mode")
  upSpeed = jbeamData.upSpeed or upSpeed
  downSpeed = math.min(jbeamData.downSpeed or downSpeed, upSpeed)
  if jbeamData.airBrake ~= nil then airBrake = jbeamData.airBrake end
  airBrakeSpeed = jbeamData.airBrakeSpeed or airBrakeSpeed
  cruiseAngle = jbeamData.cruiseAngle or cruiseAngle
  seconds = jbeamData.seconds or seconds
  mode, raised, angle, wantUp = 0, 0, 0, false
end

local function toward(current, target, dt)
  local step = dt / seconds
  if current < target then return math.min(target, current + step) end
  return math.max(target, current - step)
end

local function updateGFX(dt)
  local kmh = (electrics.values.wheelspeed or 0) * 3.6
  -- Hysteresis: up above one speed, down below a lower one.
  if kmh > upSpeed then wantUp = true elseif kmh < downSpeed then wantUp = false end
  local up = (mode == 1) or (mode == 0 and wantUp)
  if mode == 2 then up = false end
  local braking = airBrake and up and kmh > airBrakeSpeed and (electrics.values.brake or 0) > 0.6
  raised = toward(raised, up and 1 or 0, dt)
  angle = toward(angle, braking and 1 or (up and cruiseAngle or 0), dt * 3)
  electrics.values[out] = raised
  electrics.values[outAngle] = angle
  electrics.values[outMode] = mode
end

local function cycleMode()
  mode = (mode + 1) % 3
  guihooks.message("Rear wing: " .. MODES[mode + 1], 2, "jbf_aero")
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.cycleMode = cycleMode
return M
`,
  test: {
    seconds: 20,
    tracks: [
      { name: 'wheelspeed', points: [[0, 0], [8, 36], [12, 36], [14, 20], [17, 10], [20, 0]] },
      { name: 'brake', points: [[0, 0], [12, 0], [12.1, 1], [14, 1], [14.1, 0], [20, 0]] },
    ],
    presses: [],
  },
};

export const launchControl: ScriptTemplate = {
  id: 'launch_control',
  name: 'Launch control',
  category: 'Performance',
  description: 'Arm it, hold the brake, floor the throttle: the engine holds a launch rpm until you let go of the brake, then the limiter goes back to normal. Popular on drag and track builds.',
  name0: 'launch',
  params: [
    { id: 'rpm', label: 'Launch rpm', kind: 'number', default: 4500, min: 1500, max: 12000, step: 100, unit: 'rpm' },
    { id: 'engine', label: 'Engine device', kind: 'text', default: 'mainEngine', advanced: true },
  ],
  outputs: [{ suffix: '', label: 'State (0 off, 1 armed, 2 holding)', min: 0, max: 2 }],
  actions: [{ id: 'toggle', label: 'Launch control: arm', key: 'lctrl n', call: 'toggle()', desc: 'Arm or disarm launch control' }],
  lua: `-- JBeam Forge: launch control. Holds the engine at a launch rpm on the
-- brake with the throttle down, by lowering its rev limiter; puts it back
-- when you launch.
local M = {}
M.type = "auxiliary"

local out = "jbf_launch"
local launchRPM = 4500
local engineName = "mainEngine"
local armed, holding = false, false
local engine = nil
local normalLimiter = nil

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  launchRPM = jbeamData.rpm or launchRPM
  engineName = jbeamData.engine or engineName
  armed, holding = false, false
  electrics.values[out] = 0
end

local function initSecondStage()
  engine = powertrain.getDevice(engineName)
  if engine then normalLimiter = engine.revLimiterAV end
end

local function release()
  if holding and engine and normalLimiter then engine.revLimiterAV = normalLimiter end
  holding = false
end

local function updateGFX(dt)
  if armed and engine and normalLimiter then
    local stopped = (electrics.values.wheelspeed or 0) < 1
    local ready = stopped and (electrics.values.brake or 0) > 0.3 and (electrics.values.throttle or 0) > 0.9
    if ready and not holding then
      holding = true
      engine.revLimiterAV = launchRPM * math.pi / 30
    elseif holding and (electrics.values.brake or 0) < 0.1 then
      release()
      armed = false
      guihooks.message("Launch!", 1, "jbf_launch")
    end
  end
  electrics.values[out] = holding and 2 or (armed and 1 or 0)
end

local function toggle()
  if armed then release() end
  armed = not armed
  guihooks.message(armed and ("Launch control armed: " .. launchRPM .. " rpm") or "Launch control off", 2, "jbf_launch")
end

M.init = init
M.initSecondStage = initSecondStage
M.reset = function(jbeamData)
  release()
  init(jbeamData)
end
M.updateGFX = updateGFX
M.toggle = toggle
return M
`,
  test: {
    seconds: 10,
    tracks: [
      { name: 'brake', points: [[0, 0], [1, 1], [6, 1], [6.1, 0], [10, 0]] },
      { name: 'throttle', points: [[0, 0], [2, 0], [2.2, 1], [10, 1]] },
      { name: 'wheelspeed', points: [[0, 0], [6.2, 0], [10, 25]] },
    ],
    presses: [{ at: 0.5, action: 'toggle' }],
  },
};

export const popsAndBangs: ScriptTemplate = {
  id: 'pops_bangs',
  name: 'Pops and bangs',
  category: 'Sound',
  description: 'Exhaust crackle on the overrun, switchable between off, street and race tunes with a key. Sets the engine’s own afterfire strength, so it sounds the way the game’s backfires do.',
  name0: 'pops',
  params: [
    { id: 'street', label: 'Street tune', kind: 'number', default: 0.6, min: 0, max: 5, step: 0.1, hint: 'Afterfire strength' },
    { id: 'race', label: 'Race tune', kind: 'number', default: 2.5, min: 0, max: 10, step: 0.1 },
    { id: 'start', label: 'Starts in', kind: 'choice', default: 'street', options: [{ value: 'off', label: 'Off' }, { value: 'street', label: 'Street' }, { value: 'race', label: 'Race' }] },
    { id: 'engine', label: 'Engine device', kind: 'text', default: 'mainEngine', advanced: true },
  ],
  outputs: [{ suffix: '', label: 'Tune (0 off, 1 street, 2 race)', min: 0, max: 2 }],
  actions: [{ id: 'cycle', label: 'Exhaust: next tune', key: 'lctrl b', call: 'cycle()', desc: 'Off → street → race' }],
  lua: `-- JBeam Forge: pops and bangs. Switches the engine's afterfire (overrun
-- crackle) between off, street and race.
local M = {}
M.type = "auxiliary"

local TUNES = { "off", "street", "race" }
local out = "jbf_pops"
local strength = { 0, 0.6, 2.5 }
local tune = 2
local engineName = "mainEngine"
local engine = nil
local base = nil

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  strength = { 0, jbeamData.street or 0.6, jbeamData.race or 2.5 }
  engineName = jbeamData.engine or engineName
  local start = jbeamData.start or "street"
  tune = 2
  for i, name in ipairs(TUNES) do if name == start then tune = i end end
end

local function apply()
  electrics.values[out] = tune - 1
  if not engine then return end
  base = base or { instant = engine.instantAfterFireCoef or 0, sustained = engine.sustainedAfterFireCoef or 0 }
  local k = strength[tune]
  engine.instantAfterFireCoef = base.instant + k
  engine.sustainedAfterFireCoef = base.sustained + k * 0.5
end

local function initSecondStage()
  engine = powertrain.getDevice(engineName)
  apply()
end

local function updateGFX(dt)
  electrics.values[out] = tune - 1
end

local function cycle()
  tune = tune % 3 + 1
  apply()
  guihooks.message("Exhaust: " .. TUNES[tune], 2, "jbf_pops")
end

M.init = init
M.initSecondStage = initSecondStage
M.updateGFX = updateGFX
M.cycle = cycle
return M
`,
  test: { seconds: 4, tracks: [], presses: [{ at: 1, action: 'cycle' }, { at: 2, action: 'cycle' }, { at: 3, action: 'cycle' }] },
};

export const shiftLight: ScriptTemplate = {
  id: 'shift_light',
  name: 'Shift light',
  category: 'Performance',
  description: 'A shift light that comes on at your shift point and flashes near the limiter, and a 0–1 bar for an LED strip across the dash. Use its values on light materials or needles.',
  name0: 'shiftlight',
  params: [
    { id: 'from', label: 'Bar starts at', kind: 'number', default: 4000, min: 500, max: 12000, step: 100, unit: 'rpm' },
    { id: 'shift', label: 'Shift at', kind: 'number', default: 6500, min: 1000, max: 15000, step: 100, unit: 'rpm' },
    { id: 'flash', label: 'Flash from', kind: 'number', default: 6900, min: 1000, max: 16000, step: 100, unit: 'rpm' },
    { id: 'rate', label: 'Flash rate', kind: 'number', default: 8, min: 1, max: 20, step: 1, unit: 'Hz', advanced: true },
  ],
  outputs: [
    { suffix: '', label: 'Shift light (0/1)', min: 0, max: 1 },
    { suffix: 'bar', label: 'Rev bar (0–1)', min: 0, max: 1 },
  ],
  actions: [],
  lua: `-- JBeam Forge: shift light and rev bar.
local M = {}
M.type = "auxiliary"

local out, outBar = "jbf_shiftlight", "jbf_shiftlight_bar"
local from, shift, flash, rate = 4000, 6500, 6900, 8
local t = 0

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  outBar = jbeamData.out_bar or (out .. "_bar")
  from = jbeamData.from or from
  shift = math.max(jbeamData.shift or shift, from + 1)
  flash = jbeamData.flash or flash
  rate = jbeamData.rate or rate
  t = 0
end

local function updateGFX(dt)
  t = t + dt
  local rpm = electrics.values.rpm or 0
  local on = rpm >= shift and 1 or 0
  if rpm >= flash and math.floor(t * rate * 2) % 2 == 1 then on = 0 end
  electrics.values[out] = on
  electrics.values[outBar] = clamp((rpm - from) / (shift - from), 0, 1)
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: { seconds: 6, tracks: [{ name: 'rpm', points: [[0, 900], [4, 7200], [5, 7200], [6, 3000]] }], presses: [] },
};
