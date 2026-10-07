-- JBeam Forge, on the car's side: what the car really is once the game has built it (weight,
-- centre of gravity, wheelbase, what each wheel carries) and what it's doing (speed, revs, gear).
-- The game engine side asks with jbeamForgeProbe.telemetry() and hears back through
-- jbeamForge.onTelemetry(<table>).

local M = {}

local function dot(a, b)
  return a.x * b.x + a.y * b.y + a.z * b.z
end

local function telemetry()
  local out = {}
  local stats = obj:calcBeamStats()
  out.weight = stats and stats.total_weight or nil
  out.nodes = stats and stats.node_count or nil
  out.beams = stats and stats.beam_count or nil

  -- Positions relative to the car, measured along its own axes (it may be parked at any angle).
  local fwd = obj:getDirectionVector()
  local up = obj:getDirectionVectorUp()
  local right = fwd:cross(up)
  local cog = obj:calcCenterOfGravityRel(false)
  out.cog = {forward = dot(cog, fwd), right = dot(cog, right), up = dot(cog, up)}

  local wheelList, minF, maxF, lowest = {}, math.huge, -math.huge, math.huge
  for i = 0, (wheels.wheelRotatorCount or 0) - 1 do
    local wd = wheels.wheelRotators[i]
    if wd and wd.node1 then
      local p = obj:getNodePosition(wd.node1)
      local f = dot(p, fwd)
      minF, maxF = math.min(minF, f), math.max(maxF, f)
      local bottom = dot(p, up) - (wd.radius or 0)
      lowest = math.min(lowest, bottom)
      wheelList[#wheelList + 1] = {name = wd.name, load = wd.downForceRaw, radius = wd.radius, forward = f}
    end
  end
  out.wheels = wheelList
  if #wheelList >= 2 then out.wheelbase = maxF - minF end
  -- The centre of gravity's height above where the tyres touch the ground.
  if lowest < math.huge then out.cogHeight = out.cog.up - lowest end

  local e = electrics.values
  out.speed = e.airspeed
  out.rpm = e.rpm
  out.gear = e.gear
  out.throttle = e.throttle
  out.brake = e.brake
  out.fuel = e.fuel
  out.running = e.running
  out.ignition = e.ignitionLevel
  obj:queueGameEngineLua('if jbeamForge then jbeamForge.onTelemetry(' .. serialize(out) .. ') end')
end

-- What came apart: beams broken since spawn and the ones stretched or squashed most, with the
-- parts they come from (the game only says "Instability detected", not where).
local function diagnose()
  local out = {broken = 0, worst = {}}
  local list = {}
  for cid, beam in pairs(v.data.beams or {}) do
    if type(cid) == 'number' and type(beam) == 'table' then
      if obj:beamIsBroken(cid) then out.broken = out.broken + 1 end
      local rest = obj:getBeamRestLength(cid)
      local len = obj:getBeamLength(cid)
      local strain = (rest and rest > 1e-4 and len) and math.abs(len / rest - 1) or math.huge
      if strain ~= strain then strain = math.huge end
      local n1 = v.data.nodes[beam.id1]
      local n2 = v.data.nodes[beam.id2]
      list[#list + 1] = {strain = strain, a = n1 and n1.name or tostring(beam.id1), b = n2 and n2.name or tostring(beam.id2), part = beam.partOrigin, broken = obj:beamIsBroken(cid)}
    end
  end
  -- Broken beams by the part they come from.
  out.brokenByPart = {}
  out.brokenList = {}
  for _, b in ipairs(list) do
    if b.broken then
      local p = tostring(b.part or '?')
      out.brokenByPart[p] = (out.brokenByPart[p] or 0) + 1
      if #out.brokenList < 40 then out.brokenList[#out.brokenList + 1] = {b.a, b.b, p} end
    end
  end
  table.sort(list, function(x, y) return x.strain > y.strain end)
  for i = 1, math.min(15, #list) do
    local b = list[i]
    out.worst[i] = {b.a, b.b, b.strain == math.huge and 'NaN' or math.floor(b.strain * 1000) / 1000, b.part, b.broken}
  end
  out.beams = #list
  -- How far each part is out of shape: the pair of its nodes whose distance has changed most since
  -- it was built (a part that only moved, with the car or on its hinge, shows nothing here).
  local byPart = {}
  for cid, n in pairs(v.data.nodes or {}) do
    if type(cid) == 'number' and type(n) == 'table' and n.pos then
      local p = tostring(n.partOrigin or '?')
      local l = byPart[p]
      if not l then l = {}; byPart[p] = l end
      if #l < 48 then l[#l + 1] = {cid = cid, name = n.name or tostring(cid), was = vec3(n.pos)} end
    end
  end
  local bent = {}
  for part, l in pairs(byPart) do
    for _, n in ipairs(l) do n.now = vec3(obj:getNodePosition(n.cid)) end
    local worst, wa, wb, wd = 0, nil, nil, 0
    -- And which node is out of place: how much each one's distances to the others have changed, in all.
    local moved = {}
    for i = 1, #l do
      for j = i + 1, #l do
        local d0 = (l[i].was - l[j].was):length()
        local d = (l[i].now - l[j].now):length()
        if d0 > 0.05 and math.abs(d - d0) > worst then worst, wa, wb, wd = math.abs(d - d0), l[i].name, l[j].name, d0 end
        moved[i] = (moved[i] or 0) + math.abs(d - d0)
        moved[j] = (moved[j] or 0) + math.abs(d - d0)
      end
    end
    if worst > 0.004 then
      local order = {}
      for i = 1, #l do order[i] = {l[i].name, math.floor((moved[i] or 0) / math.max(1, #l - 1) * 1000 + 0.5)} end
      table.sort(order, function(x, y) return x[2] > y[2] end)
      local top = {}
      for i = 1, math.min(5, #order) do top[i] = order[i] end
      bent[#bent + 1] = {part, math.floor(worst * 1000 + 0.5), wa, wb, math.floor(wd * 1000 + 0.5), top}
    end
  end
  table.sort(bent, function(x, y) return x[2] > y[2] end)
  out.bent = {}
  for i = 1, math.min(14, #bent) do out.bent[i] = bent[i] end
  obj:queueGameEngineLua('if jbeamForge then jbeamForge.onDiagnose(' .. serialize(out) .. ') end')
end

M.diagnose = function()
  local done, err = pcall(diagnose)
  if not done then obj:queueGameEngineLua('if jbeamForge then jbeamForge.onDiagnose(' .. serialize({error = tostring(err)}) .. ') end') end
end

-- A drive check for the self-test: brake off and full throttle, then what the car did.
M.driveStart = function()
  pcall(function()
    -- As the game's own tester does: arcade shifting, so throttle from a standstill selects a gear.
    if controller.mainController.setGearboxMode then controller.mainController.setGearboxMode('arcade') end
    if controller.mainController.setFreeze then controller.mainController.setFreeze(0) end
    input.event('parkingbrake', 0, 1)
    input.event('brake', 0, 1)
    input.event('throttle', 1, 1)
  end)
end

M.driveReport = function()
  local done, err = pcall(function()
    local e = electrics.values
    local out = {speed = e.wheelspeed or e.airspeed, rpm = e.rpm, gear = e.gear, gearIndex = e.gearIndex, running = e.running, ignition = e.ignitionLevel, throttle = e.throttle, parkingbrake = e.parkingbrake, clutch = e.clutchRatio}
    local eng = powertrain and powertrain.getDevice and powertrain.getDevice('mainEngine')
    if eng then out.engine = {disabled = eng.isDisabled, stalled = eng.isStalled, starter = eng.starterEngagedCoef, av = eng.outputAV1, ignition = eng.ignitionCoef} end
    local gb = powertrain and powertrain.getDevice and powertrain.getDevice('gearbox')
    if gb then out.gearbox = {gear = gb.gearIndex, type = gb.type, mode = gb.mode} end
    out.controller = controller and controller.mainController and controller.mainController.typeName or tostring(controller and controller.mainController ~= nil)
    input.event('throttle', 0, 1)
    obj:queueGameEngineLua('if jbeamForge then jbeamForge.onDriveReport(' .. serialize(out) .. ') end')
  end)
  if not done then obj:queueGameEngineLua('if jbeamForge then jbeamForge.onDriveReport(' .. serialize({error = tostring(err)}) .. ') end') end
end

M.telemetry = function()
  local done, err = pcall(telemetry)
  if not done then obj:queueGameEngineLua('if jbeamForge then jbeamForge.onTelemetry(' .. serialize({error = tostring(err)}) .. ') end') end
end

return M
