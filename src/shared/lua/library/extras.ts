import type { ScriptTemplate } from '../templates';

/**
 * More everyday features: gauge needles from any value, a trip computer, central locking,
 * daytime running lights, a low-fuel warning, a seatbelt reminder and a gear display. Each only
 * reads the car's standard electrics and writes its own values, so it's safe on any car; use the
 * values on props (needles), glowing materials (lights) or a screen.
 */

export const gaugeNeedle: ScriptTemplate = {
  id: 'gauge_needle',
  name: 'Gauge needle',
  category: 'Display',
  description: 'Turns any value the car has (boost, oil temperature, oil pressure, fuel, battery…) into a smooth 0–1 needle position for a gauge prop. Pick the value and the range the dial shows.',
  name0: 'gauge',
  params: [
    { id: 'source', label: 'Value to show', kind: 'text', default: 'turboBoost', hint: 'An electrics value: turboBoost, oiltemp, watertemp, oilpressure, fuel, rpm, wheelspeed…' },
    { id: 'min', label: 'Dial starts at', kind: 'number', default: 0, min: -1000, max: 100000, step: 1 },
    { id: 'max', label: 'Dial ends at', kind: 'number', default: 25, min: -1000, max: 100000, step: 1 },
    { id: 'smooth', label: 'Needle smoothing', kind: 'number', default: 8, min: 0.5, max: 40, step: 0.5, unit: '/s', hint: 'Higher follows faster' },
  ],
  outputs: [{ suffix: '', label: 'Needle (0–1)', min: 0, max: 1 }],
  actions: [],
  lua: `-- JBeam Forge: gauge needle. Maps one of the car's values onto a 0-1 needle.
local M = {}
M.type = "auxiliary"

local out = "jbf_gauge"
local source = "turboBoost"
local low, high, smooth = 0, 25, 8
local needle = 0

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  source = jbeamData.source or source
  low = jbeamData.min or low
  high = jbeamData.max or high
  if high == low then high = low + 1 end
  smooth = jbeamData.smooth or smooth
  needle = 0
  electrics.values[out] = 0
end

local function updateGFX(dt)
  local value = electrics.values[source] or low
  local target = clamp((value - low) / (high - low), 0, 1)
  needle = needle + (target - needle) * math.min(1, smooth * dt)
  electrics.values[out] = needle
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: { seconds: 6, tracks: [{ name: 'turboBoost', points: [[0, 0], [2, 18], [4, 22], [6, 2]] }], presses: [] },
};

export const tripComputer: ScriptTemplate = {
  id: 'trip_computer',
  name: 'Trip computer',
  category: 'Display',
  description: 'Trip distance, average speed and fuel used since the last reset, for a dash screen or a digital gauge. A key resets the trip.',
  name0: 'trip',
  params: [{ id: 'units', label: 'Units', kind: 'choice', default: 'km', options: [{ value: 'km', label: 'Kilometres' }, { value: 'mi', label: 'Miles' }] }],
  outputs: [
    { suffix: '', label: 'Trip distance (km or mi)', min: 0, max: 100000 },
    { suffix: 'avg', label: 'Average speed (km/h or mph)', min: 0, max: 500 },
    { suffix: 'fuel', label: 'Fuel used (0–1 of the tank)', min: 0, max: 1 },
  ],
  actions: [{ id: 'reset', label: 'Trip computer: reset', key: 'lctrl t', call: 'resetTrip()', desc: 'Start a new trip' }],
  lua: `-- JBeam Forge: trip computer. Distance, average speed and fuel used since the last reset.
local M = {}
M.type = "auxiliary"

local out, outAvg, outFuel = "jbf_trip", "jbf_trip_avg", "jbf_trip_fuel"
local perKm = 1
local metres, seconds = 0, 0
local fuelAtStart = nil

local savedData = {}

local function resetTrip()
  metres, seconds = 0, 0
  fuelAtStart = electrics.values.fuel
  guihooks.message("Trip reset", 2, "jbf_trip")
end

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  outAvg = jbeamData.out_avg or (out .. "_avg")
  outFuel = jbeamData.out_fuel or (out .. "_fuel")
  perKm = jbeamData.units == "mi" and 1.609344 or 1
  metres, seconds = 0, 0
  fuelAtStart = nil
end

local function updateGFX(dt)
  local speed = math.abs(electrics.values.wheelspeed or 0)
  if fuelAtStart == nil then fuelAtStart = electrics.values.fuel end
  if speed > 0.5 then
    metres = metres + speed * dt
    seconds = seconds + dt
  end
  local distance = metres / 1000 / perKm
  electrics.values[out] = distance
  electrics.values[outAvg] = seconds > 0 and distance / (seconds / 3600) or 0
  electrics.values[outFuel] = math.max(0, (fuelAtStart or 0) - (electrics.values.fuel or 0))
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.resetTrip = resetTrip
return M
`,
  test: { seconds: 10, tracks: [{ name: 'wheelspeed', points: [[0, 0], [2, 25], [8, 25], [10, 0]] }, { name: 'fuel', points: [[0, 0.8], [10, 0.79]] }], presses: [{ at: 9, action: 'reset' }] },
};

export const centralLocking: ScriptTemplate = {
  id: 'central_locking',
  name: 'Central locking',
  category: 'Body',
  description: 'A key locks and unlocks the car: the indicators flash once to lock and twice to unlock, and it locks itself when you drive off. Use the lock value on door-pin props or a dash light.',
  name0: 'locks',
  params: [{ id: 'autoLock', label: 'Lock when driving off', kind: 'number', default: 15, min: 0, max: 100, step: 1, unit: 'km/h', hint: '0 never locks by itself' }],
  outputs: [
    { suffix: '', label: 'Locked (0/1)', min: 0, max: 1 },
    { suffix: 'flash', label: 'Indicator flash (0/1)', min: 0, max: 1 },
  ],
  actions: [{ id: 'toggle', label: 'Central locking: lock/unlock', key: 'lctrl l', call: 'toggle()', desc: 'Lock or unlock the doors' }],
  lua: `-- JBeam Forge: central locking with indicator flashes.
local M = {}
M.type = "auxiliary"

local out, outFlash = "jbf_locks", "jbf_locks_flash"
local autoLock = 15
local locked = false
local flashes, flashT = 0, 0

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  outFlash = jbeamData.out_flash or (out .. "_flash")
  autoLock = jbeamData.autoLock or autoLock
  locked = false
  flashes, flashT = 0, 0
end

local function setLocked(value)
  locked = value
  flashes = value and 1 or 2
  flashT = 0
  guihooks.message(value and "Locked" or "Unlocked", 2, "jbf_locks")
end

local function toggle()
  setLocked(not locked)
end

local function updateGFX(dt)
  local kmh = math.abs(electrics.values.wheelspeed or 0) * 3.6
  if autoLock > 0 and not locked and kmh > autoLock then setLocked(true) end
  local flash = 0
  if flashes > 0 then
    flashT = flashT + dt
    flash = (flashT % 0.6) < 0.3 and 1 or 0
    if flashT >= flashes * 0.6 then flashes = 0 end
  end
  electrics.values[out] = locked and 1 or 0
  electrics.values[outFlash] = flash
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
return M
`,
  test: { seconds: 8, tracks: [{ name: 'wheelspeed', points: [[0, 0], [4, 0], [6, 8], [8, 8]] }], presses: [{ at: 0.5, action: 'toggle' }, { at: 2, action: 'toggle' }] },
};

export const daytimeLights: ScriptTemplate = {
  id: 'daytime_lights',
  name: 'Daytime running lights',
  category: 'Lights',
  description: 'Lights that are on whenever the engine is, and dim (or go out) when the headlights come on, like modern LED strips. Use the value on a glowing material.',
  name0: 'drl',
  params: [{ id: 'withHeadlights', label: 'With headlights on', kind: 'number', default: 0.3, min: 0, max: 1, step: 0.05, hint: '0 off, 1 full brightness' }],
  outputs: [{ suffix: '', label: 'Brightness (0–1)', min: 0, max: 1 }],
  actions: [],
  lua: `-- JBeam Forge: daytime running lights.
local M = {}
M.type = "auxiliary"

local out = "jbf_drl"
local withHeadlights = 0.3
local level = 0

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  withHeadlights = jbeamData.withHeadlights or withHeadlights
  level = 0
end

local function updateGFX(dt)
  local running = (electrics.values.ignitionLevel or 2) >= 2
  local headlights = (electrics.values.lights or 0) > 0
  local target = 0
  if running then target = headlights and withHeadlights or 1 end
  level = level + (target - level) * math.min(1, 6 * dt)
  electrics.values[out] = level
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: { seconds: 8, tracks: [{ name: 'ignitionLevel', points: [[0, 0], [1, 0], [1.01, 2], [8, 2]] }, { name: 'lights', points: [[0, 0], [4, 0], [4.01, 1], [8, 1]] }], presses: [] },
};

export const lowFuelWarning: ScriptTemplate = {
  id: 'low_fuel',
  name: 'Low-fuel warning',
  category: 'Driving aids',
  description: 'A warning light that comes on when the tank runs low and flashes when it is nearly empty, with a message the first time. Use the value on a dash light.',
  name0: 'lowfuel',
  params: [
    { id: 'low', label: 'Comes on below', kind: 'number', default: 0.12, min: 0.01, max: 0.5, step: 0.01, hint: 'Share of the tank' },
    { id: 'empty', label: 'Flashes below', kind: 'number', default: 0.04, min: 0, max: 0.3, step: 0.01 },
  ],
  outputs: [{ suffix: '', label: 'Warning light (0/1)', min: 0, max: 1 }],
  actions: [],
  lua: `-- JBeam Forge: low-fuel warning light.
local M = {}
M.type = "auxiliary"

local out = "jbf_lowfuel"
local low, empty = 0.12, 0.04
local t = 0
local warned = false

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  low = jbeamData.low or low
  empty = math.min(jbeamData.empty or empty, low)
  t = 0
  warned = false
end

local function updateGFX(dt)
  t = t + dt
  local fuel = electrics.values.fuel or 1
  local on = fuel < low and 1 or 0
  if fuel < empty and math.floor(t * 2) % 2 == 1 then on = 0 end
  if on == 1 and not warned then
    warned = true
    guihooks.message("Fuel low", 4, "jbf_lowfuel")
  end
  if fuel > low then warned = false end
  electrics.values[out] = on
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: { seconds: 8, tracks: [{ name: 'fuel', points: [[0, 0.2], [8, 0.02]] }], presses: [] },
};

export const seatbeltReminder: ScriptTemplate = {
  id: 'seatbelt',
  name: 'Seatbelt reminder',
  category: 'Comfort',
  description: 'The seatbelt light that comes on with the ignition and flashes once you drive off, until a key says the belt is on. Use the value on a dash light.',
  name0: 'seatbelt',
  params: [{ id: 'speed', label: 'Flashes above', kind: 'number', default: 10, min: 1, max: 60, step: 1, unit: 'km/h' }],
  outputs: [{ suffix: '', label: 'Warning light (0/1)', min: 0, max: 1 }],
  actions: [{ id: 'buckle', label: 'Seatbelt: on/off', key: 'lctrl b', call: 'buckle()', desc: 'Fasten or undo the seatbelt' }],
  lua: `-- JBeam Forge: seatbelt reminder light.
local M = {}
M.type = "auxiliary"

local out = "jbf_seatbelt"
local speedLimit = 10
local buckled = false
local t = 0

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  speedLimit = jbeamData.speed or speedLimit
  buckled = false
  t = 0
end

local function buckle()
  buckled = not buckled
  guihooks.message(buckled and "Seatbelt on" or "Seatbelt off", 2, "jbf_seatbelt")
end

local function updateGFX(dt)
  t = t + dt
  local on = 0
  if not buckled and (electrics.values.ignitionLevel or 2) >= 1 then
    on = 1
    local kmh = math.abs(electrics.values.wheelspeed or 0) * 3.6
    if kmh > speedLimit and math.floor(t * 2) % 2 == 1 then on = 0 end
  end
  electrics.values[out] = on
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.buckle = buckle
return M
`,
  test: { seconds: 8, tracks: [{ name: 'wheelspeed', points: [[0, 0], [2, 0], [4, 10], [8, 10]] }], presses: [{ at: 6, action: 'buckle' }] },
};

export const gearDisplay: ScriptTemplate = {
  id: 'gear_display',
  name: 'Gear display',
  category: 'Display',
  description: 'The gear you are in as a number (−1 reverse, 0 neutral) and a shift-up arrow for a digital dash, with the arrow lighting at your shift point.',
  name0: 'geardisplay',
  params: [{ id: 'shift', label: 'Shift-up arrow at', kind: 'number', default: 6000, min: 1000, max: 15000, step: 100, unit: 'rpm' }],
  outputs: [
    { suffix: '', label: 'Gear (−1 reverse, 0 neutral, 1…)', min: -1, max: 10 },
    { suffix: 'up', label: 'Shift-up arrow (0/1)', min: 0, max: 1 },
  ],
  actions: [],
  lua: `-- JBeam Forge: gear display with a shift-up arrow.
local M = {}
M.type = "auxiliary"

local out, outUp = "jbf_geardisplay", "jbf_geardisplay_up"
local shiftAt = 6000

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  outUp = jbeamData.out_up or (out .. "_up")
  shiftAt = jbeamData.shift or shiftAt
end

local function updateGFX(dt)
  local gear = electrics.values.gearIndex or 0
  electrics.values[out] = gear
  electrics.values[outUp] = (gear > 0 and (electrics.values.rpm or 0) >= shiftAt) and 1 or 0
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: { seconds: 6, tracks: [{ name: 'gearIndex', points: [[0, 1], [3, 1], [3.01, 2], [6, 2]] }, { name: 'rpm', points: [[0, 1000], [2.9, 6500], [3.01, 4200], [6, 6200]] }], presses: [] },
};
