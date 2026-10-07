import type { ScriptTemplate } from '../templates';

/**
 * Driver aids. The game has its own traction and stability control, but they are set up car by
 * car in each car's jbeam (wheel speed sensors, brake actuators, tuned thresholds); these work on
 * any car from what every car reports. Cruise control needs no script: the game's own
 * (Controls → Vehicle → Cruise control) works on every vehicle, a mod's included.
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
  electrics.values.throttleFactor = 1
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
  electrics.values.throttleFactor = factor
  electrics.values[out] = enabled and (factor < 0.97 and 2 or 1) or 0
end

local function toggle()
  enabled = not enabled
  if not enabled then
    factor = 1
    electrics.values.throttleFactor = 1
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
