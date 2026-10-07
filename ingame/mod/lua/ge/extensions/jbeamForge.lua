-- JBeam Forge inside BeamNG.drive.
--
-- F10 opens JBeam Forge over the game, the way F11 opens the World Editor. The screens are the
-- same JBeam Forge as the desktop app (ui/ui-vue/mods/jbeamForge). This side does what only the
-- game can: the car being driven and its configuration, files in the user folder, drawing a
-- structure in the world, and spawning and testing cars in the game's own physics.
--
-- The screens call M.call(channel, json) and get JSON back: {ok = true, value = …} or
-- {ok = false, error = {message = …}}.

local M = {}

local ROUTE = 'jbeamForge'
local STORE = '/settings/jbeamForge/'
local logTag = 'jbeamForge'

local isOpen = false
-- A structure to draw in the world (vehicle space, metres), or nil.
local overlay = nil

-- ---------------------------------------------------------------- helpers

local function ok(value)
  return jsonEncode({ok = true, value = value})
end

local function fail(message)
  return jsonEncode({ok = false, error = {message = tostring(message)}})
end

-- A path the screens may read (anything in the game's file system) or write (only our own
-- folders: settings/jbeamForge and mods/unpacked/jbeam_forge_*).
local function cleanPath(path, writable)
  if type(path) ~= 'string' or path == '' then return nil end
  path = path:gsub('\\', '/')
  if path:find('%.%.') then return nil end
  if path:sub(1, 1) ~= '/' then path = '/' .. path end
  if writable and not (path:find('^/settings/jbeamForge/') or path:find('^/mods/unpacked/jbeam_forge_[%w_%-]+/')) then return nil end
  return path
end

local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local B64INDEX = {}
for i = 1, #B64 do B64INDEX[B64:byte(i)] = i - 1 end

local function b64encode(data)
  local out = {}
  local n = #data
  for i = 1, n, 3 do
    local a, b, c = data:byte(i, i + 2)
    local v = a * 65536 + (b or 0) * 256 + (c or 0)
    local c1 = bit.rshift(v, 18) % 64
    local c2 = bit.rshift(v, 12) % 64
    local c3 = bit.rshift(v, 6) % 64
    local c4 = v % 64
    out[#out + 1] = B64:sub(c1 + 1, c1 + 1) .. B64:sub(c2 + 1, c2 + 1) .. (b and B64:sub(c3 + 1, c3 + 1) or '=') .. (c and B64:sub(c4 + 1, c4 + 1) or '=')
  end
  return table.concat(out)
end

local function b64decode(text)
  text = text:gsub('[^%w%+/=]', '')
  local out = {}
  for i = 1, #text, 4 do
    local a, b, c, d = text:byte(i, i + 3)
    local v = (B64INDEX[a] or 0) * 262144 + (B64INDEX[b] or 0) * 4096 + (B64INDEX[c] or 0) * 64 + (B64INDEX[d] or 0)
    local s = string.char(bit.rshift(v, 16) % 256)
    if c and c ~= 61 then s = s .. string.char(bit.rshift(v, 8) % 256) end
    if d and d ~= 61 then s = s .. string.char(v % 256) end
    out[#out + 1] = s
  end
  return table.concat(out)
end

local function utf8char(cp)
  if cp < 0x80 then return string.char(cp) end
  if cp < 0x800 then return string.char(0xC0 + bit.rshift(cp, 6), 0x80 + cp % 64) end
  if cp < 0x10000 then return string.char(0xE0 + bit.rshift(cp, 12), 0x80 + bit.rshift(cp, 6) % 64, 0x80 + cp % 64) end
  return string.char(0xF0 + bit.rshift(cp, 18), 0x80 + bit.rshift(cp, 12) % 64, 0x80 + bit.rshift(cp, 6) % 64, 0x80 + cp % 64)
end

-- The screens send JSON with everything past ASCII as \uXXXX (the UI can't pass other characters
-- to Lua safely), and the game's JSON reader doesn't read those escapes: make them UTF-8 first.
local function unescapeUnicode(json)
  if not json:find('\\u', 1, true) then return json end
  json = json:gsub('(\\+)u[dD]([89abAB]%x%x)\\u[dD]([c-fC-F]%x%x)', function(slashes, hi, lo)
    if #slashes % 2 == 0 then return nil end
    local cp = 0x10000 + (tonumber('d' .. hi, 16) - 0xD800) * 1024 + (tonumber('d' .. lo, 16) - 0xDC00)
    return slashes:sub(2) .. utf8char(cp)
  end)
  return (json:gsub('(\\+)u(%x%x%x%x)', function(slashes, hex)
    if #slashes % 2 == 0 then return nil end
    return slashes:sub(2) .. utf8char(tonumber(hex, 16))
  end))
end

local function readBinary(path)
  local f = io.open(path, 'rb')
  if not f then return nil end
  local data = f:read('*all')
  f:close()
  return data
end

local function writeBinary(path, data)
  local dir = path:match('^(.*)/[^/]*$')
  if dir and dir ~= '' and not FS:directoryExists(dir) then FS:directoryCreate(dir, true) end
  local f = io.open(path, 'wb')
  if not f then return false end
  f:write(data)
  f:close()
  return true
end

-- ---------------------------------------------------------------- the car being driven

local function vec(p)
  if not p then return nil end
  return {p.x, p.y, p.z}
end

local function currentVehicle()
  local veh = getPlayerVehicle(0)
  if not veh then return nil end
  local bundle = core_vehicle_manager.getPlayerVehicleData()
  local vdata = bundle and bundle.vdata
  local config = bundle and bundle.config or {}
  local dir = vdata and vdata.vehicleDirectory or ('/vehicles/' .. veh:getJBeamFilename() .. '/')
  local out = {
    id = veh:getID(),
    model = veh:getJBeamFilename(),
    dir = dir,
    config = {
      file = config.partConfigFilename,
      parts = config.parts,
      vars = config.vars,
      paints = config.paints,
    },
    jbeamFiles = FS:findFiles(dir, '*.jbeam', -1, true, false),
    models = FS:findFiles(dir, '*.dae', -1, true, false),
    nodes = {},
    beams = {},
    flexbodies = {},
  }
  -- The structure as the game built it from the configuration: every value resolved.
  if vdata and vdata.nodes then
    local names = {}
    for cid = 0, tableSizeC(vdata.nodes) - 1 do
      local n = vdata.nodes[cid]
      if n then
        names[cid] = n.name or tostring(cid)
        out.nodes[#out.nodes + 1] = {id = names[cid], pos = vec(n.pos), weight = n.nodeWeight, part = n.partOrigin, collision = n.collision}
      end
    end
    if vdata.beams then
      for cid = 0, tableSizeC(vdata.beams) - 1 do
        local b = vdata.beams[cid]
        if b and names[b.id1] and names[b.id2] then
          out.beams[#out.beams + 1] = {names[b.id1], names[b.id2], b.beamSpring, b.beamDamp, b.beamStrength, b.beamDeform, b.partOrigin, b.beamType}
        end
      end
    end
    if vdata.flexbodies then
      for _, fb in pairs(vdata.flexbodies) do
        if type(fb) == 'table' and fb.mesh then
          -- The nodes it's bound to (its groups are gone by now, these are what they made).
          local bound = {}
          for _, cid in ipairs(type(fb._group_nodes) == 'table' and fb._group_nodes or {}) do
            if names[cid] then bound[#bound + 1] = names[cid] end
          end
          out.flexbodies[#out.flexbodies + 1] = {mesh = fb.originalMesh or fb.mesh, nodes = bound, part = fb.partOrigin}
        end
      end
    end
    if vdata.refNodes and vdata.refNodes[0] then
      local r = vdata.refNodes[0]
      out.refNodes = {ref = names[r.ref], back = names[r.back], left = names[r.left], up = names[r.up], leftCorner = names[r.leftCorner], rightCorner = names[r.rightCorner]}
    end
  end
  return out
end

-- ---------------------------------------------------------------- channels

local channels = {}

channels['store:read'] = function(req)
  local path = cleanPath(STORE .. tostring(req.key), true)
  return path and readFile(path) or nil
end

channels['store:write'] = function(req)
  local path = cleanPath(STORE .. tostring(req.key), true)
  if not path then error('Not a place JBeam Forge may write: ' .. tostring(req.key)) end
  writeBinary(path, req.text or '')
  return nil
end

channels['fs:read'] = function(req)
  local path = cleanPath(req.path, false)
  if not path or not FS:fileExists(path) then error('No such file: ' .. tostring(req.path)) end
  local data = readBinary(path) or readFile(path)
  if req.binary then return b64encode(data or '') end
  return data
end

channels['fs:exists'] = function(req)
  local out = {}
  for i, p in ipairs(req.paths or {}) do
    local path = cleanPath(p, false)
    out[i] = path ~= nil and FS:fileExists(path) or false
  end
  return out
end

channels['fs:list'] = function(req)
  local dir = cleanPath(req.dir, false)
  if not dir then return {} end
  return FS:findFiles(dir, req.pattern or '*', req.depth or 0, true, false)
end

channels['fs:writeMany'] = function(req)
  local bytes = 0
  for _, f in ipairs(req.files or {}) do
    local path = cleanPath(f.path, true)
    if not path then error('Not a place JBeam Forge may write: ' .. tostring(f.path)) end
    local data = f.base64 and b64decode(f.base64) or (f.text or '')
    if not writeBinary(path, data) then error('Could not write ' .. path) end
    bytes = bytes + #data
  end
  for _, c in ipairs(req.copies or {}) do
    local from = cleanPath(c.from, false)
    local to = cleanPath(c.to, true)
    if from and to and FS:fileExists(from) then
      local data = readBinary(from) or ''
      writeBinary(to, data)
      bytes = bytes + #data
    end
  end
  return bytes
end

channels['mods:refresh'] = function()
  -- A mod folder written while the game runs: let the mod manager mount it.
  if core_modmanager and core_modmanager.initDB then core_modmanager.initDB() end
  return nil
end

channels['vehicle:current'] = function()
  return currentVehicle()
end

-- A car to spawn once the game has it: a mod just written is mounted a moment later.
local pendingSpawn = nil

local function modelAvailable(model)
  return core_vehicles.getModelsData()[model] ~= nil
end

local function trySpawn(dt)
  if not pendingSpawn then return end
  pendingSpawn.t = pendingSpawn.t + (dt or 0)
  if modelAvailable(pendingSpawn.model) then
    core_vehicles.replaceVehicle(pendingSpawn.model, pendingSpawn.opt)
    pendingSpawn = nil
  elseif pendingSpawn.t > 20 then
    log('E', logTag, 'the game never found ' .. pendingSpawn.model .. ' to spawn')
    pendingSpawn = nil
  end
end

channels['vehicle:spawn'] = function(req)
  if type(req.model) ~= 'string' then error('No vehicle to spawn') end
  local opt = {}
  if type(req.config) == 'string' then opt.config = req.config end
  pendingSpawn = {model = req.model, opt = opt, t = 0}
  trySpawn(0)
  return nil
end

-- ---------------------------------------------------------------- telemetry and performance

-- The last reading from the car's side (jbeamForgeProbe), and when it came.
local telemetry = nil

function M.onTelemetry(t)
  telemetry = t
  if type(t) == 'table' then t.at = os.time() end
end

function M.onDriveReport(d)
  local car = getPlayerVehicle(0)
  log('I', logTag, 'self-test: drive ' .. tostring(car and car:getJBeamFilename() or '?') .. ' ' .. jsonEncode(d or {}))
end

-- The self-test's look at what came apart on a car (jbeamForgeProbe.diagnose), into the log.
function M.onDiagnose(d)
  local car = getPlayerVehicle(0)
  log('I', logTag, 'self-test: diagnose ' .. tostring(car and car:getJBeamFilename() or '?') .. ' ' .. jsonEncode(d or {}))
end

local function askTelemetry()
  local veh = getPlayerVehicle(0)
  if veh then veh:queueLuaCommand("extensions.load('jbeamForgeProbe'); jbeamForgeProbe.telemetry()") end
end

-- The driven car as it is: weight, centre of gravity, wheelbase, wheel loads, speed, revs. The
-- reading is a frame behind (the car's side answers on its next update), so this returns the last
-- one and asks for a new one.
channels['vehicle:telemetry'] = function()
  askTelemetry()
  return telemetry
end

-- The game's own performance tests (what fills in the vehicle selector's figures for its cars):
-- 0-100 km/h, top speed, braking and off-road, on the flat test map. They write the figures into
-- the configuration's info file in the user folder, so the selector shows them straight away.
local measure = nil

local function configKey(file)
  return type(file) == 'string' and file:match('([^/]+)%.pc$') or 'default'
end

function M.measured(reason)
  if not measure then return end
  local info = jsonReadFile('/vehicles/' .. measure.model .. '/info_' .. measure.config .. '.json') or {}
  local result = {model = measure.model, config = measure.config, finished = reason or 'done', info = info, telemetry = telemetry}
  jsonWriteFile(STORE .. 'measured/' .. measure.model .. '_' .. measure.config .. '.json', result, true)
  log('I', logTag, 'measured ' .. measure.model .. '/' .. measure.config .. ': ' .. dumps(info['0-100 km/h']) .. ' s to 100, ' .. dumps(info['Top Speed']) .. ' m/s')
  -- On screen too: the player is watching the car, not JBeam Forge.
  local said = {}
  if info['0-100 km/h'] then said[#said + 1] = string.format('0-100 km/h in %.1f s', info['0-100 km/h']) end
  if info['Top Speed'] then said[#said + 1] = string.format('top speed %d km/h', math.floor(info['Top Speed'] * 3.6 + 0.5)) end
  if info['100-0 km/h'] then said[#said + 1] = string.format('100-0 in %.1f m', info['100-0 km/h']) end
  if ui_message then ui_message('JBeam Forge: ' .. (#said > 0 and table.concat(said, ', ') .. '. Export again to put the figures in the mod.' or ('measuring stopped: ' .. tostring(reason))), 15, 'jbeamForge') end
  guihooks.trigger('JBeamForgeEvent', {event = 'measured', payload = result})
  measure.result = result
  measure.stage = 'done'
  -- The game's tester calls this as its own script does; ours takes its place only while measuring.
  local shim = rawget(_G, 'util_saveDynamicData')
  if shim and shim.jbeamForgeShim then rawset(_G, 'util_saveDynamicData', nil) end
end

local function startMeasuring()
  local veh = getPlayerVehicle(0)
  if not veh then return end
  if not rawget(_G, 'util_saveDynamicData') then
    rawset(_G, 'util_saveDynamicData', {jbeamForgeShim = true, heartbeat = function() if measure then measure.beat = 0 end end, vehicleDone = function() M.measured('done') end})
  end
  veh:setPositionRotation(0, 0, 0.5, 0, 0, 0, 1)
  askTelemetry()
  veh:queueLuaCommand("extensions.load('dynamicVehicleData'); dynamicVehicleData.performTests(" .. serialize(measure.model) .. ', ' .. serialize(measure.config) .. ')')
  measure.stage = 'run'
  measure.t = 0
  measure.beat = 0
end

local function measureUpdate(dt)
  if not measure or measure.stage == 'done' then return end
  measure.t = measure.t + (dt or 0)
  measure.beat = (measure.beat or 0) + (dt or 0)
  if measure.stage == 'level' and getMissionFilename():find('/autotest/') and measure.t > 5 then
    measure.stage = 'spawn'
    measure.t = 0
    core_vehicles.replaceVehicle(measure.model, {config = measure.file})
  elseif measure.stage == 'level' and measure.t > 120 then
    M.measured('the test map never loaded')
  elseif measure.stage == 'spawn' and measure.t > 6 then
    startMeasuring()
  elseif measure.stage == 'run' and (measure.beat > 30 or measure.t > 600) then
    M.measured(measure.beat > 30 and 'the car stopped answering' or 'took too long')
  end
end

channels['vehicle:measure'] = function(req)
  local car = currentVehicle()
  local model = type(req.model) == 'string' and req.model or (car and car.model)
  if not model then error('No car to measure: spawn one first') end
  local file = type(req.config) == 'string' and req.config or (car and car.config.file)
  measure = {model = model, file = file, config = configKey(file), stage = 'level', t = 0}
  if getMissionFilename():find('/autotest/') then
    measure.stage = 'spawn'
    core_vehicles.replaceVehicle(model, {config = file})
  else
    freeroam_freeroam.startFreeroamByName('autotest')
  end
  return {model = model, config = measure.config}
end

channels['vehicle:measureStatus'] = function()
  if not measure then return nil end
  return {stage = measure.stage, seconds = measure.t, result = measure.result}
end

channels['world:draw'] = function(req)
  overlay = req
  return nil
end

channels['ui:close'] = function()
  M.close()
  return nil
end

-- ---------------------------------------------------------------- open, close, draw

function M.call(channel, json)
  local handler = channels[channel]
  if not handler then return fail('JBeam Forge in the game has no "' .. tostring(channel) .. '" yet') end
  local req = json and json ~= '' and json ~= 'null' and jsonDecode(unescapeUnicode(json)) or {}
  local done, result = pcall(handler, req or {})
  if not done then
    log('E', logTag, tostring(channel) .. ': ' .. tostring(result))
    return fail(result)
  end
  return ok(result)
end

-- Something the player should see, in the log and on screen (F10 failing silently looked like a dead key).
local function tell(level, msg)
  log(level, logTag, msg)
  if ui_message then ui_message('JBeam Forge: ' .. msg, 8, 'jbeamForge') end
end

-- The route actually showing, whatever opened or closed it (Esc, the back button, another screen).
local function showing()
  local current = extensions.ui_router and extensions.ui_router.getCurrent and extensions.ui_router.getCurrent()
  if type(current) ~= 'table' then return false end
  -- The router's entry: {request = {name = …}, resolved = {…}, fromRoute = …}.
  local req = type(current.request) == 'table' and current.request or {}
  return req.name == ROUTE or req.fullRoute == ROUTE or current.name == ROUTE
end

local pendingCheck = nil -- seconds until we look whether the screen really opened
local retried = false

function M.open()
  if showing() then return end
  local rm = extensions.ui_router_routeManager
  if rm and rm.getRoute and not rm.getRoute(ROUTE) then
    tell('E', "its screen isn't registered in the game's interface. Restart the game after installing or updating it; if that doesn't help, a mod that replaces the interface may be blocking it (try the game without other UI mods).")
    return {success = false, reason = 'route not registered'}
  end
  log('I', logTag, 'opening')
  retried = false
  isOpen = true
  local result = extensions.ui_router.navigate(ROUTE)
  if type(result) == 'table' and result.success == false then
    tell('E', 'the screen could not open: ' .. tostring(result.reason or result.message or dumps(result)))
    isOpen = false
    return result
  end
  pendingCheck = 1.5
  return result
end

function M.close()
  isOpen = false
  overlay = nil
  pendingCheck = nil
  if showing() then
    log('I', logTag, 'closing')
    extensions.ui_router.navigate('play')
  end
end

function M.toggle()
  if showing() then M.close() else M.open() end
end

-- Follow the route: leaving the screen by any way closes it for us too.
function M.onAfterRouteChange(context)
  local to = context and context.toRoute
  isOpen = type(to) == 'table' and to.name == ROUTE
end

-- F10 is ours: if the game read its controls before this mod was mounted, ask it to read them again.
local bindCheck = 3
local function checkBinding(dt)
  if not bindCheck then return end
  bindCheck = bindCheck - (dt or 0)
  if bindCheck > 0 then return end
  local b = extensions.core_input_bindings
  local bound = b and b.getControlForAction and b.getControlForAction('jbeamForgeToggle')
  if bound then
    log('I', logTag, 'F10 is bound (' .. tostring(bound) .. ')')
    bindCheck = nil
    return
  end
  if bindCheck > -10 then
    log('W', logTag, 'F10 not bound yet: asking the game to read its controls again')
    if extensions.core_input_actions and extensions.core_input_actions.onFileChanged then extensions.core_input_actions.onFileChanged('/lua/ge/extensions/core/input/actions/jbeamForge.json') end
    if b and b.onFileChanged then b.onFileChanged('/settings/inputmaps/keyboard_jbeamForge.json', 'modified') end
    bindCheck = -10 -- one retry, a few seconds on
    return
  end
  bindCheck = nil
  tell('W', 'F10 is not bound. Bind it in Options → Controls → Gameplay → JBeam Forge, or type extensions.jbeamForge.toggle() in the console (~).')
end

local function checkOpened(dt)
  if not pendingCheck then return end
  pendingCheck = pendingCheck - (dt or 0)
  if pendingCheck > 0 then return end
  pendingCheck = nil
  if not showing() and not retried then
    -- The first open can outlast the router's patience while the screen loads: once more.
    retried = true
    log('W', logTag, 'the screen was slow to open: trying again')
    extensions.ui_router.navigate(ROUTE)
    pendingCheck = 4
    return
  end
  if not showing() then
    isOpen = false
    tell('E', "the screen didn't open. A mod that replaces the game's interface may be in the way: try the game without other UI mods, and check the log for JBeam Forge lines.")
  end
end

function M.isOpen()
  return isOpen
end

-- Tell the screens something happened (a car was spawned or switched).
local function emit(event, payload)
  guihooks.trigger('JBeamForgeEvent', {event = event, payload = payload})
end

function M.onVehicleSwitched()
  if isOpen then emit('vehicle:changed', nil) end
end

function M.onVehicleSpawned()
  if isOpen then emit('vehicle:changed', nil) end
end

local nodeColor = ColorF(0.95, 0.75, 0.2, 1)
local beamColor = ColorF(0.3, 0.6, 1, 0.8)

function M.onPreRender()
  if not isOpen or not overlay or not overlay.nodes then return end
  local veh = getPlayerVehicle(0)
  if not veh then return end
  local origin = veh:getPosition()
  local rot = quat(veh:getRotation())
  local world = {}
  for i, p in ipairs(overlay.nodes) do
    world[i] = origin + rot * vec3(p[1], p[2], p[3])
    debugDrawer:drawSphere(world[i], 0.02, nodeColor)
  end
  for _, b in ipairs(overlay.beams or {}) do
    local a, c = world[b[1] + 1], world[b[2] + 1]
    if a and c then debugDrawer:drawLine(a, c, beamColor) end
  end
end

-- Stay loaded across maps and scenarios (the game unloads extensions on a map change otherwise).
function M.onInit()
  setExtensionUnloadMode('jbeamForge', 'manual')
end

-- ---------------------------------------------------------------- self-test
--
-- Only when settings/jbeamForge/selftest.json exists (put there by the developer's test run):
-- start a map, wait for the car, open JBeam Forge as F10 does, and write what happened to
-- settings/jbeamForge/selftest-result.json. Without that file none of this runs.

local selftest = nil
local uiReport = nil

channels['selftest:report'] = function(req)
  uiReport = req
  return nil
end

-- What the screen should do in a self-test (nothing, unless selftest.json lists steps).
channels['selftest:plan'] = function()
  if not selftest then return nil end
  return {steps = selftest.steps}
end

local function startSelftest()
  if not selftest and FS:fileExists(STORE .. 'selftest.json') then
    local plan = jsonReadFile(STORE .. 'selftest.json') or {}
    selftest = {stage = 'menu', t = 0, level = plan.level or 'gridmap_v2', steps = plan.steps or {}, vehicle = plan.vehicle, config = plan.config, vehicles = plan.vehicles, measure = plan.measure, drive = plan.drive, serve = plan.serve, measured = {}}
    log('I', logTag, 'self-test: starting')
  end
end

-- Mod scripts run after the mod manager says it's ready, so check on loading too.
M.onModManagerReady = startSelftest

function M.onClientPostStartMission()
  if selftest and selftest.stage == 'level' then
    selftest.stage = 'drive'
    selftest.t = 0
  end
end

function M.onUpdate(dtReal)
  trySpawn(dtReal)
  measureUpdate(dtReal)
  checkBinding(dtReal)
  checkOpened(dtReal)
  if not selftest then return end
  selftest.t = selftest.t + (dtReal or 0)
  -- The map's start event can go missing (a car coming apart on spawn): a car in the world will do.
  if selftest.stage == 'level' and selftest.t > 45 and getPlayerVehicle(0) then
    selftest.stage = 'drive'
    selftest.t = 0
  end
  if selftest.stage == 'menu' and selftest.t > 8 then
    selftest.stage = 'level'
    selftest.t = 0
    freeroam_freeroam.startFreeroamByName(selftest.level)
  elseif selftest.stage == 'drive' and selftest.measure and selftest.vehicles then
    -- Each car through the game's performance tests, one after another.
    if not measure or measure.stage == 'done' then
      if measure and measure.result then
        selftest.measured[#selftest.measured + 1] = measure.result
        jsonWriteFile(STORE .. 'selftest-measured.json', selftest.measured, true)
      end
      selftest.vi = (selftest.vi or 0) + 1
      local v = selftest.vehicles[selftest.vi]
      if v then
        log('I', logTag, 'self-test: measuring ' .. tostring(v.vehicle) .. ' ' .. tostring(v.config or ''))
        measure = nil
        local done, err = pcall(channels['vehicle:measure'], {model = v.vehicle, config = v.config})
        if not done then log('E', logTag, 'self-test: could not measure ' .. tostring(v.vehicle) .. ': ' .. tostring(err)) end
      else
        selftest.vehicles = nil
        selftest.measure = nil
        measure = nil
      end
    end
  elseif selftest.stage == 'drive' and selftest.vehicles then
    -- A batch of cars, one after another: each gets a while to load and settle (its log lines are what count).
    if selftest.vi and not selftest.diagnosed and selftest.t > 10 then
      selftest.diagnosed = true
      local car = getPlayerVehicle(0)
      if car then car:queueLuaCommand("extensions.load('jbeamForgeProbe'); jbeamForgeProbe.diagnose()") end
    end
    -- With "drive": full throttle for a few seconds after the look, then what the car did.
    if selftest.drive and selftest.vi and not selftest.throttled and selftest.t > 11 then
      selftest.throttled = true
      local car = getPlayerVehicle(0)
      if car then car:queueLuaCommand("extensions.load('jbeamForgeProbe'); jbeamForgeProbe.driveStart()") end
    end
    if selftest.drive and selftest.vi and not selftest.drove and selftest.t > 18 then
      selftest.drove = true
      local car = getPlayerVehicle(0)
      if car then car:queueLuaCommand('jbeamForgeProbe.driveReport()') end
    end
    if selftest.t > (selftest.vi and (selftest.drive and 21 or 15) or 8) then
      selftest.diagnosed = false
      selftest.throttled = false
      selftest.drove = false
      selftest.vi = (selftest.vi or 0) + 1
      local v = selftest.vehicles[selftest.vi]
      selftest.t = 0
      if v then
        log('I', logTag, 'self-test: spawning ' .. tostring(v.vehicle) .. ' ' .. tostring(v.config or ''))
        local done, err = pcall(function() core_vehicles.replaceVehicle(v.vehicle, v.config and {config = v.config} or {}) end)
        if not done then log('E', logTag, 'self-test: could not spawn ' .. tostring(v.vehicle) .. ': ' .. tostring(err)) end
      else
        -- The batch is through (the last car had its full turn too).
        selftest.vehicles = nil
        selftest.vi = nil
        log('I', logTag, 'self-test: batch done')
        if selftest.serve then
          -- One of the game's own cars while waiting, so the batch's files can be swapped for the next.
          pcall(function() core_vehicles.replaceVehicle('pickup', {}) end)
          -- The game writes its log a block at a time: a few long lines after the last car's push them out to the
          -- file (few, because the log stops taking lines at 15000).
          for _ = 1, 16 do log('D', logTag, 'self-test: flush ' .. string.rep('.', 65536)) end
          jsonWriteFile(STORE .. 'queue-done.json', {id = selftest.queueId}, false)
        end
      end
    end
  elseif selftest.stage == 'drive' and selftest.serve then
    -- Kept open for the next batch: a test run drops queue.json here (the mods are already in
    -- place), the game picks up the new files, and the cars go through as above.
    if selftest.t > 1 then
      selftest.t = 0
      if FS:fileExists(STORE .. 'queue.json') then
        local q = jsonReadFile(STORE .. 'queue.json') or {}
        FS:removeFile(STORE .. 'queue.json')
        if core_modmanager and core_modmanager.initDB then core_modmanager.initDB() end
        selftest.vehicles = q.vehicles or {}
        selftest.drive = q.drive
        selftest.queueId = q.id
        selftest.vi = nil
        log('I', logTag, 'self-test: batch ' .. tostring(q.id) .. ' with ' .. tostring(#selftest.vehicles) .. ' cars')
      elseif FS:fileExists(STORE .. 'quit.json') then
        FS:removeFile(STORE .. 'quit.json')
        selftest = nil
        log('I', logTag, 'self-test: serving stopped')
        return
      end
    end
  elseif selftest.stage == 'drive' and selftest.t > 8 and selftest.vehicle and not selftest.spawned then
    -- The car under test (a mod's vehicle), in place of the map's own.
    selftest.spawned = true
    selftest.t = 0
    log('I', logTag, 'self-test: spawning ' .. tostring(selftest.vehicle) .. ' ' .. tostring(selftest.config or ''))
    core_vehicles.replaceVehicle(selftest.vehicle, selftest.config and {config = selftest.config} or {})
  elseif selftest.stage == 'drive' and selftest.t > 12 and getPlayerVehicle(0) then
    -- Press F10 the way the player does: through the game's controls, not by calling open().
    selftest.stage = 'press'
    selftest.t = 0
    local b = extensions.core_input_bindings
    selftest.bound = b and b.getControlForAction and b.getControlForAction('jbeamForgeToggle') or false
    local rm = extensions.ui_router_routeManager
    selftest.routeRegistered = rm and rm.getRoute and rm.getRoute(ROUTE) ~= nil or false
    local pressed = pcall(function() extensions.core_input_actions.triggerDownUp('jbeamForgeToggle') end)
    selftest.pressed = pressed
  elseif selftest.stage == 'press' and selftest.t > 8 then
    selftest.f10Opened = showing()
    selftest.stage = 'open'
    selftest.t = 0
    if not selftest.f10Opened then
      local navigated = M.open()
      selftest.navigate = navigated and {success = navigated.success, reason = navigated.reason or navigated.message} or 'nothing'
    end
  elseif selftest.stage == 'open' and (selftest.t > 300 or (selftest.t > 25 and (#selftest.steps == 0 or (uiReport and uiReport.done)))) then
    local car = currentVehicle()
    if car then jsonWriteFile(STORE .. 'selftest-car.json', car, false) end
    local current = extensions.ui_router.getCurrent and extensions.ui_router.getCurrent()
    jsonWriteFile(STORE .. 'selftest-result.json', {
      opened = isOpen,
      f10 = {bound = selftest.bound, routeRegistered = selftest.routeRegistered, pressed = selftest.pressed, opened = selftest.f10Opened},
      navigate = selftest.navigate,
      route = type(current) == 'table' and (current.name or current.routeName or dumps(current):sub(1, 400)) or tostring(current),
      ui = uiReport,
      spawned = selftest.vehicle,
      measured = #selftest.measured > 0 and selftest.measured or nil,
      vehicle = car and {model = car.model, nodes = #car.nodes, beams = #car.beams, flexbodies = #car.flexbodies, models = car.models, configFile = car.config.file} or nil,
    }, true)
    log('I', logTag, 'self-test: done')
    selftest = nil
  end
end

function M.onExtensionLoaded()
  log('I', logTag, 'JBeam Forge is ready: press F10 to open it.')
  startSelftest()
end

return M
