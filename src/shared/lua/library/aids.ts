import type { ScriptTemplate } from '../templates';

/**
 * Driver aids. The game has its own traction and stability control, but they are set up car by
 * car in each car's jbeam (wheel speed sensors, brake actuators, tuned thresholds); these work on
 * any car from what every car reports. Cruise control needs no script: the game's own
 * (Controls → Vehicle → Cruise control) works on every vehicle, a mod's included. Nor does power
 * steering: how heavy the wheel feels is the player's own setting (Options → Controls → Force
 * feedback and steering assistance), the same for every car.
 *
 * The aids share the engine's throttle (electrics.values.throttleFactor): each records its own
 * cut and the engine gets the smallest, so traction control, stability control and a drive mode
 * can all be fitted to one car.
 */

export const tractionControl: ScriptTemplate = {
  id: 'traction_control',
  name: 'Traction control',
  category: 'Performance',
  description: 'Eases the throttle when the driven wheels spin faster than the car is moving, and gives it back as they grip. A key turns it off for burnouts and drifting. Works on any engine, with no sensors to set up.',
  name0: 'tc',
  params: [
    { id: 'slip', label: 'Slip allowed', kind: 'number', default: 0.15, min: 0.02, max: 0.6, step: 0.01, hint: 'How much faster than the car the driven wheels may turn before it steps in (0.15 = 15%)' },
    { id: 'strength', label: 'Strength', kind: 'number', default: 2.5, min: 0.5, max: 8, step: 0.1, hint: 'How hard it cuts for each bit of slip past the limit' },
    { id: 'floor', label: 'Least throttle', kind: 'number', default: 0.15, min: 0, max: 0.8, step: 0.05, hint: 'It never cuts below this share of your throttle' },
    { id: 'start', label: 'Starts', kind: 'choice', default: 'on', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
  ],
  outputs: [{ suffix: '', label: 'State (0 off, 1 on, 2 cutting)', min: 0, max: 2 }],
  actions: [{ id: 'toggle', label: 'Traction control: on / off', key: 'lctrl t', call: 'toggle()', desc: 'Turn traction control on or off' }],
  lua: `-- JBeam Forge: traction control. Compares how fast the driven wheels turn
-- with how fast the car moves, and scales the engine's throttle down while
-- they spin (electrics.values.throttleFactor, which every engine reads).
local M = {}
M.type = "auxiliary"

local out = "jbf_tc"
local slipAllowed = 0.15
local strength = 2.5
local floor = 0.15
local enabled = true
local factor = 1

local savedData = {}

-- The aids share the engine's throttle: each keeps its own cut, and the engine
-- gets the smallest of them (electrics.values.throttleFactor, which every engine reads).
local function setCut(name, value)
  electrics.values["jbf_cut_" .. name] = value
  local least = 1
  for _, key in ipairs({"tc", "esc", "mode"}) do
    local cut = electrics.values["jbf_cut_" .. key]
    if cut and cut < least then least = cut end
  end
  electrics.values.throttleFactor = least
end

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  slipAllowed = jbeamData.slip or slipAllowed
  strength = jbeamData.strength or strength
  floor = jbeamData.floor or floor
  enabled = (jbeamData.start or "on") ~= "off"
  factor = 1
  setCut("tc", 1)
  electrics.values[out] = enabled and 1 or 0
end

-- The fastest driven wheel (m/s at the tyre), or the car's wheel speed when
-- the wheels can't be asked one by one.
local function drivenSpeed()
  local best = 0
  if wheels and wheels.wheelCount and wheels.wheels then
    for i = 0, wheels.wheelCount - 1 do
      local w = wheels.wheels[i]
      if w and w.isPropulsed then best = math.max(best, math.abs(w.wheelSpeed or 0)) end
    end
    if best > 0 then return best end
  end
  return math.abs(electrics.values.wheelspeed or 0)
end

local function updateGFX(dt)
  local road = math.abs(electrics.values.airspeed or 0)
  -- Below walking pace any wheel speed is "slip": measure against 2 m/s there.
  local slip = (drivenSpeed() - road) / math.max(road, 2)
  local want = 1
  if enabled and (electrics.values.throttle or 0) > 0.05 and slip > slipAllowed then
    want = math.max(floor, 1 - (slip - slipAllowed) * strength)
  end
  -- Cut quickly, give back gently, so it doesn't hunt.
  local rate = want < factor and 14 or 3
  factor = factor + (want - factor) * math.min(1, dt * rate)
  setCut("tc", factor)
  electrics.values[out] = enabled and (factor < 0.97 and 2 or 1) or 0
end

local function toggle()
  enabled = not enabled
  if not enabled then
    factor = 1
    setCut("tc", 1)
  end
  guihooks.message(enabled and "Traction control on" or "Traction control off", 2, "jbf_tc")
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
return M
`,
  test: {
    seconds: 8,
    tracks: [
      { name: 'throttle', points: [[0, 0], [1, 1], [8, 1]] },
      // The wheels run away from the car between 1 and 4 s, then it hooks up.
      { name: 'wheelspeed', points: [[0, 0], [1, 0], [2, 18], [4, 20], [5, 14], [8, 22]] },
      { name: 'airspeed', points: [[0, 0], [1, 0], [4, 9], [5, 13.5], [8, 21.5]] },
    ],
    presses: [],
  },
};

export const stabilityControl: ScriptTemplate = {
  id: 'stability_control',
  name: 'Stability control',
  category: 'Performance',
  description: 'Eases the throttle when the car starts to slide sideways, and gives it back as it straightens. A key turns it off for drifting. Works on any car: it compares where the car points with where it is going.',
  name0: 'esc',
  params: [
    { id: 'angle', label: 'Slide allowed', kind: 'number', default: 7, min: 2, max: 25, step: 1, hint: 'Degrees between where the car points and where it travels before it steps in' },
    { id: 'strength', label: 'Strength', kind: 'number', default: 0.08, min: 0.02, max: 0.3, step: 0.01, hint: 'Share of throttle taken off for each degree past the limit' },
    { id: 'floor', label: 'Least throttle', kind: 'number', default: 0.1, min: 0, max: 0.8, step: 0.05, hint: 'It never cuts below this share of your throttle' },
    { id: 'start', label: 'Starts', kind: 'choice', default: 'on', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
  ],
  outputs: [{ suffix: '', label: 'State (0 off, 1 on, 2 cutting)', min: 0, max: 2 }],
  actions: [{ id: 'toggle', label: 'Stability control: on / off', key: 'lctrl k', call: 'toggle()', desc: 'Turn stability control on or off' }],
  lua: `-- JBeam Forge: stability control. Measures the angle between the way the car
-- points and the way it travels, and eases the engine's throttle while the
-- car slides further than allowed.
local M = {}
M.type = "auxiliary"

local out = "jbf_esc"
local angleAllowed = 7
local strength = 0.08
local floor = 0.1
local enabled = true
local factor = 1

local savedData = {}

-- The aids share the engine's throttle: each keeps its own cut, and the engine
-- gets the smallest of them (electrics.values.throttleFactor, which every engine reads).
local function setCut(name, value)
  electrics.values["jbf_cut_" .. name] = value
  local least = 1
  for _, key in ipairs({"tc", "esc", "mode"}) do
    local cut = electrics.values["jbf_cut_" .. key]
    if cut and cut < least then least = cut end
  end
  electrics.values.throttleFactor = least
end

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  angleAllowed = jbeamData.angle or angleAllowed
  strength = jbeamData.strength or strength
  floor = jbeamData.floor or floor
  enabled = (jbeamData.start or "on") ~= "off"
  factor = 1
  setCut("esc", 1)
  electrics.values[out] = enabled and 1 or 0
end

-- Degrees between the car's nose and its path over the ground (0 below 5 m/s,
-- where a car turning on the spot would read as a slide).
local function slideAngle()
  local v = obj:getVelocity()
  local dir = obj:getDirectionVector()
  local speed = v:length()
  if speed < 5 then return 0 end
  local along = v:dot(dir)
  local across = math.sqrt(math.max(0, speed * speed - along * along))
  return math.deg(math.atan(across / math.max(0.001, math.abs(along))))
end

local function updateGFX(dt)
  local want = 1
  if enabled then
    local over = slideAngle() - angleAllowed
    if over > 0 then want = math.max(floor, 1 - over * strength) end
  end
  -- Cut quickly, give back gently, so it doesn't hunt.
  local rate = want < factor and 10 or 2.5
  factor = factor + (want - factor) * math.min(1, dt * rate)
  setCut("esc", factor)
  electrics.values[out] = enabled and (factor < 0.97 and 2 or 1) or 0
end

local function toggle()
  enabled = not enabled
  if not enabled then
    factor = 1
    setCut("esc", 1)
  end
  guihooks.message(enabled and "Stability control on" or "Stability control off", 2, "jbf_esc")
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
return M
`,
  test: {
    seconds: 6,
    tracks: [
      { name: 'throttle', points: [[0, 0], [1, 1], [6, 1]] },
      { name: 'wheelspeed', points: [[0, 0], [1, 5], [6, 30]] },
    ],
    presses: [{ at: 3, action: 'toggle' }],
  },
};

export const driveModes: ScriptTemplate = {
  id: 'drive_modes',
  name: 'Drive modes',
  category: 'Performance',
  description: 'A key steps through Eco, Comfort and Sport. Eco and Comfort hold back part of the throttle; Sport gives all of it. The mode is an output a gauge, a light or a screen can show.',
  name0: 'mode',
  params: [
    { id: 'eco', label: 'Eco throttle', kind: 'number', default: 0.6, min: 0.2, max: 1, step: 0.05, hint: 'Share of full throttle the engine gets in Eco' },
    { id: 'comfort', label: 'Comfort throttle', kind: 'number', default: 0.85, min: 0.2, max: 1, step: 0.05, hint: 'Share of full throttle the engine gets in Comfort' },
    { id: 'start', label: 'Starts in', kind: 'choice', default: 'comfort', options: [{ value: 'eco', label: 'Eco' }, { value: 'comfort', label: 'Comfort' }, { value: 'sport', label: 'Sport' }] },
  ],
  outputs: [{ suffix: '', label: 'Mode (0 Eco, 1 Comfort, 2 Sport)', min: 0, max: 2 }],
  actions: [{ id: 'next', label: 'Drive mode: next', key: 'lctrl m', call: 'next()', desc: 'Step to the next drive mode' }],
  lua: `-- JBeam Forge: drive modes. Eco and Comfort hold back part of the throttle,
-- Sport gives all of it. The mode number goes out as an electrics value.
local M = {}
M.type = "auxiliary"

local out = "jbf_mode"
local names = {"Eco", "Comfort", "Sport"}
local share = {0.6, 0.85, 1}
local mode = 2

local savedData = {}

-- The aids share the engine's throttle: each keeps its own cut, and the engine
-- gets the smallest of them (electrics.values.throttleFactor, which every engine reads).
local function setCut(name, value)
  electrics.values["jbf_cut_" .. name] = value
  local least = 1
  for _, key in ipairs({"tc", "esc", "mode"}) do
    local cut = electrics.values["jbf_cut_" .. key]
    if cut and cut < least then least = cut end
  end
  electrics.values.throttleFactor = least
end

local function show()
  setCut("mode", share[mode])
  electrics.values[out] = mode - 1
end

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  share[1] = jbeamData.eco or share[1]
  share[2] = jbeamData.comfort or share[2]
  local start = jbeamData.start or "comfort"
  mode = start == "eco" and 1 or start == "sport" and 3 or 2
  show()
end

local function updateGFX(dt)
  -- Kept up every frame: another aid may have let its own cut go.
  show()
end

local function next()
  mode = mode % 3 + 1
  show()
  guihooks.message("Drive mode: " .. names[mode], 2, "jbf_mode")
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.next = next
return M
`,
  test: {
    seconds: 6,
    tracks: [{ name: 'throttle', points: [[0, 0], [1, 1], [6, 1]] }],
    presses: [{ at: 2, action: 'next' }, { at: 4, action: 'next' }],
  },
};
