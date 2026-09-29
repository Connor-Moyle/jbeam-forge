import type { ScriptTemplate } from '../templates';
import { base64Of, windNoiseWav } from '../sound';

/** Lights, driving aids and cabin sounds. */

export const welcomeLights: ScriptTemplate = {
  id: 'welcome_lights',
  name: 'Welcome and follow-me-home lights',
  category: 'Lights',
  description: 'Puddle and courtesy lights that come on while a door is open and fade out after it shuts, and headlights that stay on for a while after you switch off (follow me home).',
  name0: 'welcome',
  params: [
    { id: 'doors', label: 'Door signals', kind: 'text', default: 'door_FL_coupler_notAttached,door_FR_coupler_notAttached', hint: 'Electrics values that are 1 while a door is open' },
    { id: 'fade', label: 'Fade out', kind: 'number', default: 1.5, min: 0.1, max: 10, step: 0.1, unit: 's' },
    { id: 'follow', label: 'Follow me home', kind: 'number', default: 30, min: 0, max: 120, step: 5, unit: 's', hint: '0 = off' },
  ],
  outputs: [
    { suffix: '', label: 'Courtesy lights (0–1)', min: 0, max: 1 },
    { suffix: 'home', label: 'Follow-me-home headlights (0/1)', min: 0, max: 1 },
  ],
  actions: [],
  lua: `-- JBeam Forge: courtesy (puddle) lights and follow-me-home headlights.
-- Use the values on light materials (glow maps) or lamp props.
local M = {}
M.type = "auxiliary"

local out, outHome = "jbf_welcome", "jbf_welcome_home"
local doors = {}
local fade, follow = 1.5, 30
local level = 0
local homeLeft = 0
local lastIgnition = nil

local function init(jbeamData)
  out = jbeamData.out or out
  outHome = jbeamData.out_home or (out .. "_home")
  doors = {}
  for name in string.gmatch(jbeamData.doors or "", "[^,%s]+") do doors[#doors + 1] = name end
  fade = jbeamData.fade or fade
  follow = jbeamData.follow or follow
  level, homeLeft, lastIgnition = 0, 0, nil
end

local function updateGFX(dt)
  local open = false
  for _, name in ipairs(doors) do
    if (electrics.values[name] or 0) > 0.5 then open = true end
  end
  if open then level = 1 else level = math.max(0, level - dt / fade) end

  local ignition = electrics.values.ignitionLevel or 2
  if lastIgnition and lastIgnition > 0 and ignition == 0 and (electrics.values.lights or 0) > 0 then homeLeft = follow end
  if ignition > 0 then homeLeft = 0 end
  lastIgnition = ignition
  homeLeft = math.max(0, homeLeft - dt)

  electrics.values[out] = level
  electrics.values[outHome] = homeLeft > 0 and 1 or 0
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: {
    seconds: 12,
    tracks: [
      { name: 'door_FL_coupler_notAttached', points: [[0, 0], [1, 0], [1.01, 1], [3, 1], [3.01, 0], [12, 0]] },
      { name: 'ignitionLevel', points: [[0, 2], [6, 2], [6.01, 0], [12, 0]] },
      { name: 'lights', points: [[0, 1], [12, 1]] },
    ],
    presses: [],
  },
};

export const ambientLights: ScriptTemplate = {
  id: 'ambient_lights',
  name: 'Ambient cabin lighting',
  category: 'Lights',
  description: 'Interior mood lighting with brightness steps, a slow breathing effect, and a colour you cycle through with a key. Put its values on the ambient strip’s light material.',
  name0: 'ambient',
  params: [
    { id: 'colours', label: 'Colours', kind: 'number', default: 8, min: 1, max: 32, step: 1, hint: 'How many colours the key cycles through' },
    { id: 'breathe', label: 'Breathing time', kind: 'number', default: 4, min: 1, max: 20, step: 0.5, unit: 's' },
    { id: 'onlyAtNight', label: 'Only with the headlights on', kind: 'boolean', default: false },
  ],
  outputs: [
    { suffix: '', label: 'Brightness (0–1)', min: 0, max: 1 },
    { suffix: 'colour', label: 'Colour number', min: 0, max: 31 },
    { suffix: 'hue', label: 'Colour hue (0–1)', min: 0, max: 1 },
  ],
  actions: [
    { id: 'mode', label: 'Ambient light: brightness', key: 'lctrl o', call: 'cycleMode()', desc: 'Off → low → high → breathing' },
    { id: 'colour', label: 'Ambient light: colour', key: 'lctrl p', call: 'nextColour()', desc: 'Next colour' },
  ],
  lua: `-- JBeam Forge: ambient cabin lighting.
local M = {}
M.type = "auxiliary"

local MODES = { "off", "low", "high", "breathing" }
local out, outColour, outHue = "jbf_ambient", "jbf_ambient_colour", "jbf_ambient_hue"
local colours, breathe, onlyAtNight = 8, 4, false
local mode, colour, t, level = 2, 0, 0, 0

local function init(jbeamData)
  out = jbeamData.out or out
  outColour = jbeamData.out_colour or (out .. "_colour")
  outHue = jbeamData.out_hue or (out .. "_hue")
  colours = math.max(1, math.floor(jbeamData.colours or colours))
  breathe = jbeamData.breathe or breathe
  if jbeamData.onlyAtNight ~= nil then onlyAtNight = jbeamData.onlyAtNight end
  mode, colour, t, level = 2, 0, 0, 0
end

local function updateGFX(dt)
  t = t + dt
  local target = ({ 0, 0.35, 1, 0.55 + 0.45 * math.sin(t * 2 * math.pi / breathe) })[mode]
  if onlyAtNight and (electrics.values.lights or 0) == 0 then target = 0 end
  if (electrics.values.ignitionLevel or 2) == 0 then target = 0 end
  level = level + (target - level) * math.min(1, dt * 6)
  electrics.values[out] = level
  electrics.values[outColour] = colour
  electrics.values[outHue] = colour / colours
end

local function cycleMode()
  mode = mode % 4 + 1
  guihooks.message("Ambient light: " .. MODES[mode], 2, "jbf_ambient")
end

local function nextColour()
  colour = (colour + 1) % colours
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.cycleMode = cycleMode
M.nextColour = nextColour
return M
`,
  test: { seconds: 10, tracks: [], presses: [{ at: 1, action: 'mode' }, { at: 4, action: 'colour' }, { at: 5, action: 'colour' }] },
};

export const brakeFlash: ScriptTemplate = {
  id: 'brake_flash',
  name: 'Emergency brake flash',
  category: 'Driving aids',
  description: 'Flashes the brake lights (or any light on its value) under an emergency stop from speed, and puts the hazards on once stopped, like modern cars’ emergency stop signal.',
  name0: 'ess',
  params: [
    { id: 'decel', label: 'Braking harder than', kind: 'number', default: 7, min: 3, max: 15, step: 0.5, unit: 'm/s²' },
    { id: 'minSpeed', label: 'From above', kind: 'number', default: 50, min: 10, max: 200, step: 5, unit: 'km/h' },
    { id: 'rate', label: 'Flash rate', kind: 'number', default: 4, min: 1, max: 10, step: 0.5, unit: 'Hz' },
    { id: 'hazards', label: 'Hazards on once stopped', kind: 'boolean', default: true },
  ],
  outputs: [
    { suffix: '', label: 'Flashing (0/1)', min: 0, max: 1 },
    { suffix: 'active', label: 'Emergency stop detected', min: 0, max: 1 },
  ],
  actions: [],
  lua: `-- JBeam Forge: emergency stop signal (flashing brake lights, then hazards).
local M = {}
M.type = "auxiliary"

local out, outActive = "jbf_ess", "jbf_ess_active"
local decelLimit, minSpeed, rate, hazards = 7, 50, 4, true
local lastSpeed = nil
local decel = 0
local active = false
local t = 0
local hazardsSet = false

local function init(jbeamData)
  out = jbeamData.out or out
  outActive = jbeamData.out_active or (out .. "_active")
  decelLimit = jbeamData.decel or decelLimit
  minSpeed = jbeamData.minSpeed or minSpeed
  rate = jbeamData.rate or rate
  if jbeamData.hazards ~= nil then hazards = jbeamData.hazards end
  lastSpeed, decel, active, t, hazardsSet = nil, 0, false, 0, false
end

local function updateGFX(dt)
  local speed = electrics.values.wheelspeed or 0
  if lastSpeed and dt > 0 then
    local now = (lastSpeed - speed) / dt
    decel = decel + (now - decel) * math.min(1, dt * 8)
  end
  lastSpeed = speed
  local braking = (electrics.values.brake or 0) > 0.2
  if not active and braking and decel > decelLimit and speed * 3.6 > minSpeed then
    active = true
    t = 0
  end
  if active then
    t = t + dt
    if speed < 0.5 then
      if hazards and not hazardsSet and (electrics.values.hazard or 0) == 0 then
        electrics.toggle_warn_signal()
        hazardsSet = true
      end
      active = false
    elseif not braking or decel < decelLimit * 0.4 then
      active = false
    end
  end
  if speed > 3 then hazardsSet = false end
  electrics.values[out] = (active and math.floor(t * rate * 2) % 2 == 0) and 1 or 0
  electrics.values[outActive] = active and 1 or 0
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: {
    seconds: 8,
    tracks: [
      { name: 'wheelspeed', points: [[0, 25], [2, 25], [5.5, 0], [8, 0]] },
      { name: 'brake', points: [[0, 0], [2, 0], [2.05, 1], [6, 1], [8, 0]] },
    ],
    presses: [],
  },
};

export const windNoise: ScriptTemplate = {
  id: 'wind_noise',
  name: 'Wind and road noise',
  category: 'Sound',
  description: 'Rushing air that grows with speed when a window, the sunroof or the roof is open, or the glass is broken: louder the more is open and the faster you go. Ships its own looping wind sound.',
  name0: 'windnoise',
  params: [
    { id: 'openings', label: 'Openings', kind: 'text', default: 'jbf_windows,jbf_sunroof,jbf_roof_open', hint: 'Electrics values (0–1) of windows and roofs, comma separated' },
    { id: 'glass', label: 'Broken glass counts', kind: 'boolean', default: true, hint: 'Beams in break groups with glass or window in the name' },
    { id: 'volume', label: 'Loudest', kind: 'number', default: 0.8, min: 0, max: 2, step: 0.05 },
    { id: 'fullSpeed', label: 'Loudest at', kind: 'number', default: 140, min: 40, max: 300, step: 10, unit: 'km/h' },
    { id: 'sound', label: 'Sound file', kind: 'text', default: '', hint: 'Empty: the wind sound made with the export. Or a looping sound in your mod', advanced: true },
  ],
  outputs: [{ suffix: '', label: 'Noise level (0–1)', min: 0, max: 1 }],
  actions: [],
  files: () => [{ path: 'sounds/jbf_wind_loop.wav', base64: base64Of(windNoiseWav()) }],
  extraData: (ctx) => ({ defaultSound: `vehicles/${ctx.slug}/sounds/jbf_wind_loop.wav` }),
  lua: `-- JBeam Forge: wind and road noise through open windows, roofs and broken glass.
local M = {}
M.type = "auxiliary"

local out = "jbf_windnoise"
local openings = {}
local useGlass = true
local volume, fullSpeed = 0.8, 140
local soundFile = ""
local glassBeams = {}
local broken = 0
local checkIn = 0
local source = nil
local level = 0

local function init(jbeamData)
  out = jbeamData.out or out
  openings = {}
  for name in string.gmatch(jbeamData.openings or "", "[^,%s]+") do openings[#openings + 1] = name end
  if jbeamData.glass ~= nil then useGlass = jbeamData.glass end
  volume = jbeamData.volume or volume
  fullSpeed = jbeamData.fullSpeed or fullSpeed
  soundFile = jbeamData.sound or ""
  if soundFile == "" then soundFile = jbeamData.defaultSound or "" end
  glassBeams, broken, checkIn, level = {}, 0, 0, 0
  if useGlass and v.data.beams then
    for _, beam in pairs(v.data.beams) do
      local group = type(beam.breakGroup) == "string" and beam.breakGroup:lower() or ""
      if group:find("glass") or group:find("window") then glassBeams[#glassBeams + 1] = beam.cid end
    end
  end
end

local function initSounds()
  if soundFile ~= "" then
    source = obj:createSFXSource(soundFile, "AudioDefaultLoop3D", "jbfWindNoise", 0)
    if source then obj:playSFX(source) end
  end
end

local function updateGFX(dt)
  checkIn = checkIn - dt
  if checkIn <= 0 and #glassBeams > 0 then
    checkIn = 0.5
    broken = 0
    for _, cid in ipairs(glassBeams) do
      if obj:beamIsBroken(cid) then broken = broken + 1 end
    end
  end
  local open = 0
  for _, name in ipairs(openings) do open = open + clamp(electrics.values[name] or 0, 0, 1) end
  if broken > 0 then open = open + 1 end
  open = clamp(open, 0, 1.5)
  local speed = clamp((electrics.values.airspeed or electrics.values.wheelspeed or 0) * 3.6 / fullSpeed, 0, 1.3)
  local target = clamp(open * speed * speed, 0, 1)
  level = level + (target - level) * math.min(1, dt * 3)
  electrics.values[out] = level
  if source then obj:setVolumePitch(source, level * volume, 0.8 + speed * 0.4) end
end

M.init = init
M.initSounds = initSounds
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: {
    seconds: 14,
    tracks: [
      { name: 'wheelspeed', points: [[0, 0], [8, 36], [14, 36]] },
      { name: 'airspeed', points: [[0, 0], [8, 36], [14, 36]] },
      { name: 'jbf_windows', points: [[0, 0], [3, 0], [5, 1], [10, 1], [12, 0], [14, 0]] },
    ],
    presses: [],
  },
};
