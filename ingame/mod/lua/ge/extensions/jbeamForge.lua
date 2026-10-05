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
        out.nodes[#out.nodes + 1] = {id = names[cid], pos = vec(n.pos), weight = n.nodeWeight, group = n.group, part = n.partOrigin, collision = n.collision}
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
        if type(fb) == 'table' and fb.mesh then out.flexbodies[#out.flexbodies + 1] = {mesh = fb.mesh, groups = fb['[group]'], part = fb.partOrigin} end
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

channels['vehicle:spawn'] = function(req)
  if type(req.model) ~= 'string' then error('No vehicle to spawn') end
  local opt = {}
  if type(req.config) == 'string' then opt.config = req.config end
  core_vehicles.replaceVehicle(req.model, opt)
  return nil
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
  local req = json and json ~= '' and jsonDecode(json) or {}
  local done, result = pcall(handler, req or {})
  if not done then
    log('E', logTag, tostring(channel) .. ': ' .. tostring(result))
    return fail(result)
  end
  return ok(result)
end

function M.open()
  if isOpen then return end
  isOpen = true
  extensions.ui_router.navigate(ROUTE)
end

function M.close()
  if not isOpen then return end
  isOpen = false
  overlay = nil
  extensions.ui_router.navigate('play')
end

function M.toggle()
  if isOpen then M.close() else M.open() end
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
  setExtensionUnloadMode(M, 'manual')
end

function M.onExtensionLoaded()
  log('I', logTag, 'JBeam Forge is ready: press F10 to open it.')
end

return M
