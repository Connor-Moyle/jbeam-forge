/* global forge */
// Warning lights pack: an example JBeam Forge extension that adds vehicle script templates.
// They appear in Scripts → Templates next to the built-in ones. A template is plain data: the
// controller's Lua, its settings (sent to it as jbeamData.<id>), its outputs and a test drive.

forge.scripts.registerTemplate({
  id: 'overheat_light',
  name: 'Overheat warning light',
  category: 'Driving aids',
  description: 'A warning light when the coolant or oil gets too hot, flashing when it is about to do damage. Use the value on a dash light.',
  name0: 'overheat',
  params: [
    { id: 'water', label: 'Coolant warning at', kind: 'number', default: 110, min: 80, max: 150, step: 1, unit: '°C' },
    { id: 'oil', label: 'Oil warning at', kind: 'number', default: 130, min: 90, max: 180, step: 1, unit: '°C' },
    { id: 'margin', label: 'Flashes this far above', kind: 'number', default: 10, min: 1, max: 40, step: 1, unit: '°C' },
  ],
  outputs: [{ suffix: '', label: 'Warning light (0/1)', min: 0, max: 1 }],
  actions: [],
  lua: `-- Overheat warning light (from the Warning lights pack extension).
local M = {}
M.type = "auxiliary"

local out = "jbf_overheat"
local water, oil, margin = 110, 130, 10
local t = 0

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  water = jbeamData.water or water
  oil = jbeamData.oil or oil
  margin = jbeamData.margin or margin
  t = 0
end

local function updateGFX(dt)
  t = t + dt
  local w = electrics.values.watertemp or 0
  local o = electrics.values.oiltemp or 0
  local on = (w >= water or o >= oil) and 1 or 0
  local critical = w >= water + margin or o >= oil + margin
  if critical and math.floor(t * 3) % 2 == 1 then on = 0 end
  electrics.values[out] = on
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
return M
`,
  test: { seconds: 10, tracks: [{ name: 'watertemp', points: [[0, 90], [5, 112], [10, 125]] }, { name: 'oiltemp', points: [[0, 95], [10, 120]] }], presses: [] },
});

forge.scripts.registerTemplate({
  id: 'speed_warning',
  name: 'Speed warning light',
  category: 'Driving aids',
  description: 'A light that comes on above a speed you set (a school-zone or track pit-limit reminder). A key changes it between two limits.',
  name0: 'speedwarn',
  params: [
    { id: 'limit', label: 'Warning above', kind: 'number', default: 120, min: 10, max: 400, step: 5, unit: 'km/h' },
    { id: 'pit', label: 'Second limit (pit lane)', kind: 'number', default: 60, min: 5, max: 200, step: 5, unit: 'km/h' },
  ],
  outputs: [{ suffix: '', label: 'Warning light (0/1)', min: 0, max: 1 }],
  actions: [{ id: 'swap', label: 'Speed warning: switch limit', key: 'lctrl k', call: 'swap()', desc: 'Switch between the two limits' }],
  lua: `-- Speed warning light (from the Warning lights pack extension).
local M = {}
M.type = "auxiliary"

local out = "jbf_speedwarn"
local limit, pit = 120, 60
local usePit = false

local savedData = {}

local function init(jbeamData)
  -- Reset may come without the jbeam data: keep the settings from the first init.
  jbeamData = jbeamData or savedData
  savedData = jbeamData
  out = jbeamData.out or out
  limit = jbeamData.limit or limit
  pit = jbeamData.pit or pit
  usePit = false
end

local function swap()
  usePit = not usePit
  guihooks.message("Speed warning: " .. (usePit and pit or limit) .. " km/h", 2, "jbf_speedwarn")
end

local function updateGFX(dt)
  local kmh = math.abs(electrics.values.wheelspeed or 0) * 3.6
  local current = usePit and pit or limit
  electrics.values[out] = kmh > current and 1 or 0
end

M.init = init
M.reset = init
M.updateGFX = updateGFX
M.swap = swap
return M
`,
  test: { seconds: 10, tracks: [{ name: 'wheelspeed', points: [[0, 0], [10, 40]] }], presses: [{ at: 5, action: 'swap' }] },
});

forge.ui.notify('Warning lights pack: two templates added to Scripts → Templates.', 'info');
