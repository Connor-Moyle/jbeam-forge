import type { ScriptTemplate } from '../templates';

/** Windows, sunroof and convertible roof: openings in the cabin. */

export const windows: ScriptTemplate = {
  id: 'windows',
  name: 'Power windows',
  category: 'Windows & roof',
  description: 'Windows that wind down and up with one touch, stop anywhere with a second touch, and (frameless doors) drop a little while the door is open, rising again once it shuts, like real coupés and convertibles.',
  needs: 'The window glass meshes to slide',
  name0: 'windows',
  params: [
    { id: 'glass', label: 'Window glass', kind: 'meshes', default: [], hint: 'Slides straight down; tilt the slide direction in the Inspector for curved doors.', animate: { output: '', motion: 'slide', from: 0, to: 0.42, axis: [0, 0, -1], pivot: 'centre', toParam: 'travel' } },
    { id: 'travel', label: 'Travel', kind: 'number', default: 0.42, min: 0.05, max: 1, step: 0.01, unit: 'm', scope: 'animation' },
    { id: 'seconds', label: 'Full travel time', kind: 'number', default: 3.5, min: 1, max: 10, step: 0.1, unit: 's' },
    { id: 'frameless', label: 'Frameless: drop when the door opens', kind: 'boolean', default: false },
    { id: 'drop', label: 'Drop', kind: 'number', default: 0.04, min: 0.01, max: 0.2, step: 0.005, unit: 'of the travel', hint: 'About 1.5 cm on most cars' },
    { id: 'doors', label: 'Door signals', kind: 'text', default: 'door_FL_coupler_notAttached,door_FR_coupler_notAttached', hint: 'Electrics values that are 1 while a door is open, comma separated' },
    { id: 'riseDelay', label: 'Rise after closing', kind: 'number', default: 0.35, min: 0, max: 3, step: 0.05, unit: 's', advanced: true },
  ],
  outputs: [{ suffix: '', label: 'Open (0 shut, 1 fully down)', min: 0, max: 1 }],
  actions: [
    { id: 'toggle', label: 'Windows: down or up', key: 'lctrl j', call: 'toggle()', desc: 'One touch down (or up); press again to stop' },
    { id: 'vent', label: 'Windows: vent', key: 'lctrl k', call: 'set(0.15)', desc: 'Open a crack' },
  ],
  lua: `-- JBeam Forge: power windows with one-touch travel and frameless drop.
local M = {}
M.type = "auxiliary"

local out = "jbf_windows"
local seconds = 3.5
local frameless = false
local drop = 0.04
local riseDelay = 0.35
local doors = {}
local position = 0 -- 0 shut, 1 fully down
local target = 0
local moving = false
local closedFor = 99

local function split(list)
  local t = {}
  for name in string.gmatch(list or "", "[^,%s]+") do t[#t + 1] = name end
  return t
end

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  seconds = jbeamData.seconds or seconds
  if jbeamData.frameless ~= nil then frameless = jbeamData.frameless end
  drop = jbeamData.drop or drop
  riseDelay = jbeamData.riseDelay or riseDelay
  doors = split(jbeamData.doors)
  position, target, moving, closedFor = 0, 0, false, 99
  electrics.values[out] = 0
end

local function anyDoorOpen()
  for _, name in ipairs(doors) do
    if (electrics.values[name] or 0) > 0.5 then return true end
  end
  return false
end

local function updateGFX(dt)
  if moving then
    local step = dt / seconds
    if position < target then position = math.min(target, position + step) else position = math.max(target, position - step) end
    if position == target then moving = false end
  end
  local shown = position
  if frameless then
    if anyDoorOpen() then closedFor = 0 else closedFor = closedFor + dt end
    -- The glass clears the seal while the door moves, then rises once it's shut.
    if closedFor < riseDelay then shown = math.max(position, drop) end
  end
  electrics.values[out] = shown
end

local function toggle()
  if moving then
    moving = false
    target = position
    return
  end
  target = position > 0.5 and 0 or 1
  moving = true
end

local function set(v)
  target = clamp(v or 0, 0, 1)
  moving = true
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
M.set = set
return M
`,
  test: {
    seconds: 14,
    tracks: [{ name: 'door_FL_coupler_notAttached', points: [[0, 0], [9, 0], [9.01, 1], [11, 1], [11.01, 0], [14, 0]] }],
    presses: [{ at: 0.5, action: 'toggle' }, { at: 2, action: 'toggle' }, { at: 3, action: 'toggle' }, { at: 7.5, action: 'vent' }],
  },
};

export const sunroof: ScriptTemplate = {
  id: 'sunroof',
  name: 'Sunroof',
  category: 'Windows & roof',
  description: 'A tilt-and-slide sunroof: one key tilts the glass up at the rear, then slides it back; pressing again closes it in the right order. A wind deflector rises as it opens.',
  needs: 'The sunroof glass (slides) and, if it has one, the wind deflector',
  name0: 'sunroof',
  params: [
    { id: 'glass', label: 'Sunroof glass', kind: 'meshes', default: [], animate: { output: '', motion: 'slide', from: 0, to: 0.38, axis: [0, 1, -0.05], pivot: 'centre', toParam: 'travel' } },
    { id: 'deflector', label: 'Wind deflector', kind: 'meshes', default: [], animate: { output: 'tilt', motion: 'rotate', from: 0, to: 25, axis: [1, 0, 0], pivot: 'front' } },
    { id: 'travel', label: 'Slide travel', kind: 'number', default: 0.38, min: 0.1, max: 1, step: 0.01, unit: 'm', scope: 'animation' },
    { id: 'tiltSeconds', label: 'Tilt time', kind: 'number', default: 0.8, min: 0.2, max: 3, step: 0.1, unit: 's' },
    { id: 'slideSeconds', label: 'Slide time', kind: 'number', default: 3, min: 0.5, max: 8, step: 0.1, unit: 's' },
  ],
  outputs: [
    { suffix: '', label: 'Slid back (0 shut, 1 open)', min: 0, max: 1 },
    { suffix: 'tilt', label: 'Tilt (0 flush, 1 tilted)', min: 0, max: 1 },
  ],
  actions: [
    { id: 'toggle', label: 'Sunroof: open or close', key: 'lctrl u', call: 'toggle()', desc: 'Tilt, slide back; or close' },
    { id: 'tilt', label: 'Sunroof: tilt', key: 'lctrl i', call: 'tiltOnly()', desc: 'Tilt the glass up to vent (or back down)' },
  ],
  lua: `-- JBeam Forge: tilt-and-slide sunroof.
local M = {}
M.type = "auxiliary"

local out, outTilt = "jbf_sunroof", "jbf_sunroof_tilt"
local tiltSeconds, slideSeconds = 0.8, 3
local slide, tilt = 0, 0
local wantOpen, wantTilt = false, false

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  outTilt = jbeamData.out_tilt or (out .. "_tilt")
  tiltSeconds = jbeamData.tiltSeconds or tiltSeconds
  slideSeconds = jbeamData.slideSeconds or slideSeconds
  slide, tilt, wantOpen, wantTilt = 0, 0, false, false
  electrics.values[out] = 0
  electrics.values[outTilt] = 0
end

local function updateGFX(dt)
  local tiltStep, slideStep = dt / tiltSeconds, dt / slideSeconds
  if wantOpen then
    -- Tilt first, then slide back.
    if tilt < 1 then tilt = math.min(1, tilt + tiltStep) else slide = math.min(1, slide + slideStep) end
  elseif slide > 0 then
    -- Slide home first, then settle flush.
    slide = math.max(0, slide - slideStep)
  elseif wantTilt then
    tilt = math.min(1, tilt + tiltStep)
  else
    tilt = math.max(0, tilt - tiltStep)
  end
  electrics.values[out] = slide
  electrics.values[outTilt] = tilt
end

local function toggle()
  wantOpen = not wantOpen
  wantTilt = false
end

local function tiltOnly()
  if wantOpen then return end
  wantTilt = not wantTilt
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
M.tiltOnly = tiltOnly
return M
`,
  test: { seconds: 12, tracks: [], presses: [{ at: 0.5, action: 'tilt' }, { at: 2.5, action: 'toggle' }, { at: 7.5, action: 'toggle' }] },
};

export const convertible: ScriptTemplate = {
  id: 'convertible',
  name: 'Convertible roof',
  category: 'Windows & roof',
  description: 'A folding soft top or hard top in stages, like the real thing: the tonneau cover lifts, the roof folds into the boot, the cover closes. Only works below a set speed, with a message if you try faster.',
  needs: 'The roof sections and the tonneau (roof storage) cover',
  name0: 'roof',
  params: [
    { id: 'front', label: 'Roof front section', kind: 'meshes', default: [], hint: 'Folds back over the rear section', animate: { output: '', motion: 'rotate', from: 0, to: 160, axis: [1, 0, 0], pivot: 'rear' } },
    { id: 'rear', label: 'Roof rear section', kind: 'meshes', default: [], animate: { output: '', motion: 'rotate', from: 0, to: -95, axis: [1, 0, 0], pivot: 'rear' } },
    { id: 'cover', label: 'Tonneau cover', kind: 'meshes', default: [], hint: 'Lifts at its front edge to let the roof in', animate: { output: 'cover', motion: 'rotate', from: 0, to: -65, axis: [1, 0, 0], pivot: 'rear' } },
    { id: 'coverSeconds', label: 'Cover time', kind: 'number', default: 2.5, min: 0.5, max: 8, step: 0.1, unit: 's' },
    { id: 'foldSeconds', label: 'Folding time', kind: 'number', default: 9, min: 2, max: 30, step: 0.5, unit: 's' },
    { id: 'maxSpeed', label: 'Works below', kind: 'number', default: 40, min: 0, max: 200, step: 5, unit: 'km/h' },
  ],
  outputs: [
    { suffix: '', label: 'Folded (0 up, 1 stowed)', min: 0, max: 1 },
    { suffix: 'cover', label: 'Cover open', min: 0, max: 1 },
    { suffix: 'open', label: 'Roof open (1 once stowed)', min: 0, max: 1 },
  ],
  actions: [{ id: 'toggle', label: 'Roof: open or close', key: 'lctrl h', call: 'toggle()', desc: 'Fold the roof away, or put it up' }],
  lua: `-- JBeam Forge: convertible roof in stages (cover up, roof folds, cover down).
local M = {}
M.type = "auxiliary"

local out, outCover, outOpen = "jbf_roof", "jbf_roof_cover", "jbf_roof_open"
local coverSeconds, foldSeconds, maxSpeed = 2.5, 9, 40
local fold, cover = 0, 0
local wantOpen = false

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  outCover = jbeamData.out_cover or (out .. "_cover")
  outOpen = jbeamData.out_open or (out .. "_open")
  coverSeconds = jbeamData.coverSeconds or coverSeconds
  foldSeconds = jbeamData.foldSeconds or foldSeconds
  maxSpeed = jbeamData.maxSpeed or maxSpeed
  fold, cover, wantOpen = 0, 0, false
end

local function updateGFX(dt)
  local c, f = dt / coverSeconds, dt / foldSeconds
  local target = wantOpen and 1 or 0
  if fold ~= target then
    -- The cover opens before the roof moves either way.
    if cover < 1 then
      cover = math.min(1, cover + c)
    elseif fold < target then
      fold = math.min(1, fold + f)
    else
      fold = math.max(0, fold - f)
    end
  else
    cover = math.max(0, cover - c)
  end
  electrics.values[out] = fold
  electrics.values[outCover] = cover
  electrics.values[outOpen] = (fold >= 1 and cover <= 0) and 1 or 0
end

local function toggle()
  local kmh = (electrics.values.wheelspeed or 0) * 3.6
  if kmh > maxSpeed then
    guihooks.message("Slow down below " .. maxSpeed .. " km/h to move the roof", 3, "jbf_roof")
    return
  end
  wantOpen = not wantOpen
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.toggle = toggle
return M
`,
  test: { seconds: 30, tracks: [{ name: 'wheelspeed', points: [[0, 0], [16, 0], [17, 20], [30, 20]] }], presses: [{ at: 0.5, action: 'toggle' }, { at: 15, action: 'toggle' }, { at: 20, action: 'toggle' }] },
};
