import type { ScriptTemplate } from '../templates';

/** Wipers, mirrors, seats and pop-up headlights: things that move on the car. */

export const wipers: ScriptTemplate = {
  id: 'wipers',
  name: 'Windscreen wipers',
  category: 'Body',
  description: 'Off, intermittent, low and high speed, parking at the bottom of the screen; a wash does three quick wipes. The arms sweep with an easing like real motors.',
  needs: 'The wiper arm meshes (and blades) to animate',
  name0: 'wipers',
  params: [
    { id: 'arms', label: 'Wiper arms', kind: 'meshes', default: [], hint: 'Each arm turns about its base; set the pivot and axis per arm in the Inspector if they need it.', animate: { output: '', motion: 'rotate', from: 0, to: 95, axis: [0, -0.35, 0.94], pivot: 'bottom', toParam: 'sweep' } },
    { id: 'sweep', label: 'Sweep angle', kind: 'number', default: 95, min: 30, max: 180, step: 1, unit: '°', hint: 'How far the arms travel (sets the animation)', scope: 'animation' },
    { id: 'lowSeconds', label: 'Low speed wipe', kind: 'number', default: 1.4, min: 0.5, max: 4, step: 0.1, unit: 's' },
    { id: 'highSeconds', label: 'High speed wipe', kind: 'number', default: 0.85, min: 0.3, max: 3, step: 0.05, unit: 's' },
    { id: 'pauseSeconds', label: 'Intermittent pause', kind: 'number', default: 4, min: 1, max: 20, step: 0.5, unit: 's' },
  ],
  outputs: [
    { suffix: '', label: 'Arm position', min: 0, max: 1 },
    { suffix: 'mode', label: 'Mode (0 off, 1 intermittent, 2 low, 3 high)', min: 0, max: 3 },
  ],
  actions: [
    { id: 'cycle', label: 'Wipers: next speed', key: 'lctrl w', call: 'cycle()', desc: 'Off → intermittent → low → high → off' },
    { id: 'wash', label: 'Wipers: wash', key: 'lctrl q', call: 'wash()', desc: 'Three quick wipes' },
  ],
  lua: `-- JBeam Forge: windscreen wipers.
-- Off, intermittent, low and high; a wash does three wipes. Writes the arm
-- position (0 parked, 1 fully out) for the arm props, and the mode.
local M = {}
M.type = "auxiliary"

local MODES = { "off", "intermittent", "low", "high" }
local out, outMode = "jbf_wipers", "jbf_wipers_mode"
local lowSeconds, highSeconds, pauseSeconds = 1.4, 0.85, 4
local mode = 0 -- 0 off, 1 intermittent, 2 low, 3 high
local phase = 0 -- 0..1 through one wipe, out and back
local wait = 0
local washWipes = 0

-- Out and back, eased at each end like a crank-driven linkage.
local function position(p)
  local x = p < 0.5 and p * 2 or (1 - p) * 2
  return 0.5 - 0.5 * math.cos(x * math.pi)
end

local function init(jbeamData)
  out = jbeamData.out or out
  outMode = jbeamData.out_mode or (out .. "_mode")
  lowSeconds = jbeamData.lowSeconds or lowSeconds
  highSeconds = jbeamData.highSeconds or highSeconds
  pauseSeconds = jbeamData.pauseSeconds or pauseSeconds
  mode, phase, wait, washWipes = 0, 0, 0, 0
  electrics.values[out] = 0
  electrics.values[outMode] = 0
end

local function updateGFX(dt)
  -- Keep going until parked, even after being switched off.
  if mode > 0 or washWipes > 0 or phase > 0 then
    if wait > 0 then
      wait = wait - dt
    else
      local seconds = (mode == 3) and highSeconds or lowSeconds
      if washWipes > 0 then seconds = highSeconds end
      phase = phase + dt / seconds
      if phase >= 1 then
        phase = 0
        if washWipes > 0 then washWipes = washWipes - 1 end
        if mode == 1 and washWipes == 0 then wait = pauseSeconds end
      end
    end
  end
  electrics.values[out] = position(phase)
  electrics.values[outMode] = mode
end

local function setMode(m)
  mode = clamp(math.floor(m or 0), 0, 3)
  wait = 0
  guihooks.message("Wipers: " .. MODES[mode + 1], 2, "jbf_wipers")
end

local function cycle()
  setMode((mode + 1) % 4)
end

local function wash()
  washWipes = 3
  wait = 0
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.setMode = setMode
M.cycle = cycle
M.wash = wash
return M
`,
  test: { seconds: 12, tracks: [{ name: 'wheelspeed', points: [[0, 0], [12, 20]] }], presses: [{ at: 0.5, action: 'cycle' }, { at: 4, action: 'cycle' }, { at: 7, action: 'cycle' }, { at: 9.5, action: 'cycle' }] },
};

export const mirrors: ScriptTemplate = {
  id: 'mirrors',
  name: 'Folding mirrors',
  category: 'Body',
  description: 'Power-folding door mirrors: fold and unfold with a key, and fold on their own when the ignition goes off (and back out when it comes on).',
  needs: 'The two mirror housings (glass included) to animate',
  name0: 'mirrors',
  params: [
    { id: 'housings', label: 'Mirror housings', kind: 'meshes', default: [], hint: 'Each folds about a vertical hinge at its inner edge; the right one folds the other way.', animate: { output: '', motion: 'rotate', from: 0, to: 68, axis: [0, 0, 1], pivot: 'inner', mirror: true } },
    { id: 'seconds', label: 'Folding time', kind: 'number', default: 2.2, min: 0.5, max: 6, step: 0.1, unit: 's' },
    { id: 'autoFold', label: 'Fold when the ignition is off', kind: 'boolean', default: true },
  ],
  outputs: [{ suffix: '', label: 'Folded (0 out, 1 folded)', min: 0, max: 1 }],
  actions: [{ id: 'toggle', label: 'Mirrors: fold or unfold', key: 'lctrl m', call: 'toggle()', desc: 'Fold or unfold the door mirrors' }],
  lua: `-- JBeam Forge: power-folding mirrors.
local M = {}
M.type = "auxiliary"

local out = "jbf_mirrors"
local seconds = 2.2
local autoFold = true
local folded = 0 -- 0 out, 1 folded
local target = 0
local lastIgnition = nil

local function init(jbeamData)
  out = jbeamData.out or out
  seconds = jbeamData.seconds or seconds
  if jbeamData.autoFold ~= nil then autoFold = jbeamData.autoFold end
  folded, target, lastIgnition = 0, 0, nil
  electrics.values[out] = 0
end

local function updateGFX(dt)
  if autoFold then
    local ignition = electrics.values.ignitionLevel or 2
    if lastIgnition ~= nil and ignition ~= lastIgnition then
      if ignition == 0 then target = 1 elseif lastIgnition == 0 then target = 0 end
    end
    lastIgnition = ignition
  end
  local step = dt / seconds
  if folded < target then folded = math.min(target, folded + step) else folded = math.max(target, folded - step) end
  electrics.values[out] = folded
end

local function toggle()
  target = target > 0.5 and 0 or 1
end

local function set(v)
  target = clamp(v or 0, 0, 1)
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
M.set = set
return M
`,
  test: { seconds: 10, tracks: [{ name: 'ignitionLevel', points: [[0, 2], [5.9, 2], [6, 0], [10, 0]] }], presses: [{ at: 0.5, action: 'toggle' }, { at: 3.5, action: 'toggle' }] },
};

export const seats: ScriptTemplate = {
  id: 'seats',
  name: 'Power seats',
  category: 'Comfort',
  description: 'Slide the seat forward and back and recline the backrest with keys. Easy entry slides it back while the driver’s door is open and returns it after.',
  needs: 'The seat cushion (slides) and backrest (reclines) meshes',
  name0: 'seat',
  params: [
    { id: 'cushion', label: 'Seat (slides)', kind: 'meshes', default: [], hint: 'Everything that slides with the seat', animate: { output: 'slide', motion: 'slide', from: 0, to: 0.2, axis: [0, 1, 0], pivot: 'centre' } },
    { id: 'backrest', label: 'Backrest (reclines)', kind: 'meshes', default: [], animate: { output: 'recline', motion: 'rotate', from: -8, to: 22, axis: [1, 0, 0], pivot: 'bottom' } },
    { id: 'speed', label: 'Motor speed', kind: 'number', default: 0.25, min: 0.05, max: 1, step: 0.05, unit: 'of the travel per s' },
    { id: 'easyEntry', label: 'Easy entry', kind: 'boolean', default: true, hint: 'Slides fully back while the door is open' },
    { id: 'door', label: 'Door signal', kind: 'electrics', default: 'doorFL_coupler_notAttached', hint: 'Electrics value that is 1 while the door is open' },
    { id: 'start', label: 'Starting position', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.05, advanced: true },
  ],
  outputs: [
    { suffix: 'slide', label: 'Slide (0 forward, 1 back)', min: 0, max: 1 },
    { suffix: 'recline', label: 'Recline (0 upright, 1 reclined)', min: 0, max: 1 },
  ],
  actions: [
    { id: 'forward', label: 'Seat: forward', key: 'lctrl up', call: 'nudge(-1)', desc: 'Slide the seat forward a step' },
    { id: 'back', label: 'Seat: back', key: 'lctrl down', call: 'nudge(1)', desc: 'Slide the seat back a step' },
    { id: 'recline', label: 'Seat: recline', key: 'lctrl right', call: 'tilt(1)', desc: 'Recline the backrest a step' },
    { id: 'upright', label: 'Seat: upright', key: 'lctrl left', call: 'tilt(-1)', desc: 'Bring the backrest up a step' },
  ],
  lua: `-- JBeam Forge: power seat with easy entry.
local M = {}
M.type = "auxiliary"

local outSlide, outRecline = "jbf_seat_slide", "jbf_seat_recline"
local speed = 0.25
local easyEntry = true
local door = "doorFL_coupler_notAttached"
local slide, recline = 0.5, 0.3
local slideTarget, reclineTarget = 0.5, 0.3
local saved = nil

local function init(jbeamData)
  outSlide = jbeamData.out_slide or outSlide
  outRecline = jbeamData.out_recline or outRecline
  speed = jbeamData.speed or speed
  if jbeamData.easyEntry ~= nil then easyEntry = jbeamData.easyEntry end
  door = jbeamData.door or door
  slide = jbeamData.start or 0.5
  slideTarget, recline, reclineTarget, saved = slide, 0.3, 0.3, nil
end

local function move(current, target, dt)
  local step = speed * dt
  if current < target then return math.min(target, current + step) end
  return math.max(target, current - step)
end

local function updateGFX(dt)
  if easyEntry then
    local open = (electrics.values[door] or 0) > 0.5
    if open and not saved then
      saved = slideTarget
      slideTarget = 1
    elseif not open and saved then
      slideTarget = saved
      saved = nil
    end
  end
  slide = move(slide, slideTarget, dt)
  recline = move(recline, reclineTarget, dt)
  electrics.values[outSlide] = slide
  electrics.values[outRecline] = recline
end

local function nudge(direction)
  slideTarget = clamp(slideTarget + 0.1 * direction, 0, 1)
  if saved then saved = slideTarget end
end

local function tilt(direction)
  reclineTarget = clamp(reclineTarget + 0.1 * direction, 0, 1)
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.nudge = nudge
M.tilt = tilt
return M
`,
  test: { seconds: 12, tracks: [{ name: 'doorFL_coupler_notAttached', points: [[0, 0], [6, 0], [6.01, 1], [9, 1], [9.01, 0], [12, 0]] }], presses: [{ at: 0.5, action: 'forward' }, { at: 0.8, action: 'forward' }, { at: 2.5, action: 'recline' }, { at: 2.8, action: 'recline' }] },
};

export const popupLights: ScriptTemplate = {
  id: 'popup_lights',
  name: 'Pop-up headlights',
  category: 'Lights',
  description: 'Headlight pods that rise when the lights come on and fold away when they go off, with a wink on a key. Flashing the high beam raises them too.',
  needs: 'The headlight pod meshes (lenses included)',
  name0: 'popups',
  params: [
    { id: 'pods', label: 'Headlight pods', kind: 'meshes', default: [], hint: 'Each turns about a sideways hinge at its rear edge', animate: { output: '', motion: 'rotate', from: 0, to: -52, axis: [1, 0, 0], pivot: 'rear' } },
    { id: 'seconds', label: 'Rising time', kind: 'number', default: 0.8, min: 0.2, max: 3, step: 0.05, unit: 's' },
  ],
  outputs: [{ suffix: '', label: 'Raised (0 down, 1 up)', min: 0, max: 1 }],
  actions: [{ id: 'wink', label: 'Headlights: wink', key: 'lctrl l', call: 'wink()', desc: 'Raise and lower the pods once' }],
  lua: `-- JBeam Forge: pop-up headlights.
local M = {}
M.type = "auxiliary"

local out = "jbf_popups"
local seconds = 0.8
local raised = 0
local winking = 0

local function init(jbeamData)
  out = jbeamData.out or out
  seconds = jbeamData.seconds or seconds
  raised, winking = 0, 0
  electrics.values[out] = 0
end

local function updateGFX(dt)
  local lightsOn = (electrics.values.lights or 0) > 0 or (electrics.values.highbeam or 0) > 0
  local target = lightsOn and 1 or 0
  if winking > 0 then
    winking = winking - dt
    target = winking > seconds and 1 or 0
  end
  local step = dt / seconds
  if raised < target then raised = math.min(target, raised + step) else raised = math.max(target, raised - step) end
  electrics.values[out] = raised
end

local function wink()
  winking = seconds * 2.2
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.wink = wink
return M
`,
  test: { seconds: 8, tracks: [{ name: 'lights', points: [[0, 0], [2, 0], [2.01, 1], [5, 1], [5.01, 0], [8, 0]] }], presses: [{ at: 6, action: 'wink' }] },
};
