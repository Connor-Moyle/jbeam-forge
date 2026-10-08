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

-- ---------------------------------------------------------------- checks
-- Three things the game's own tester doesn't try: do the doors and lids open and shut, how hard
-- does the car corner, and what does a 50 km/h pole do to it. Each runs on its own clock here and
-- sends its answer to JBeam Forge when it is done.
local check = nil

local function brokenCount()
  local n = 0
  for _, b in pairs(v.data.beams or {}) do if obj:beamIsBroken(b.cid) then n = n + 1 end end
  return n
end

local function send(name, result)
  obj:queueGameEngineLua('if jbeamForge then jbeamForge.onCheck(' .. serialize(name) .. ', ' .. serialize(result) .. ') end')
end

-- Every latch the car has (doors, bonnet, boot): its controller and the two nodes it joins.
local function latches()
  -- A latch's section is named after its controller and lists its node pairs by name, under a
  -- header row, as the game's own controller reads them.
  local out = {}
  for name, data in pairs(v.data) do
    if type(data) == 'table' and type(data.couplerNodes) == 'table' then
      local rows = tableFromHeaderTable(data.couplerNodes)
      local row = rows and rows[1]
      local ctrl = controller.getControllerSafe and controller.getControllerSafe(name) or (controller.getController and controller.getController(name))
      local a = row and beamstate.nodeNameMap[row.cid1]
      local b = row and beamstate.nodeNameMap[row.cid2]
      if a and b and ctrl and ctrl.detachGroup and ctrl.tryAttachGroupImpulse then out[#out + 1] = {name = name, a = a, b = b, ctrl = ctrl} end
    end
  end
  table.sort(out, function(x, y) return x.name < y.name end)
  return out
end

local function gap(l)
  return (vec3(obj:getNodePosition(l.a)) - vec3(obj:getNodePosition(l.b))):length()
end

M.doorsCheck = function()
  local done, err = pcall(function()
    local list = latches()
    for _, l in ipairs(list) do l.shut = gap(l) end
    check = {kind = 'doors', t = 0, list = list, stage = 'open'}
    for _, l in ipairs(list) do l.ctrl.detachGroup() end
    if #list == 0 then
      check = nil
      send('doors', {latches = 0, pass = true, note = 'no doors or lids with a latch'})
    end
  end)
  if not done then check = nil; send('doors', {error = tostring(err)}) end
end

M.skidpadCheck = function()
  pcall(function()
    if controller.mainController.setGearboxMode then controller.mainController.setGearboxMode('arcade') end
    input.event('parkingbrake', 0, 1)
    input.event('brake', 0, 1)
    input.event('steering', 1, 1)
    input.event('throttle', 0.55, 1)
  end)
  check = {kind = 'skidpad', t = 0, broken = brokenCount(), best = 0, sum = 0, n = 0, speed = 0}
end

M.poleCheck = function(kmh, x, y)
  pcall(function()
    if controller.mainController.setGearboxMode then controller.mainController.setGearboxMode('arcade') end
    input.event('parkingbrake', 0, 1)
    input.event('brake', 0, 1)
    input.event('steering', 0, 1)
    input.event('throttle', 1, 1)
  end)
  check = {kind = 'pole', t = 0, target = (kmh or 50) / 3.6, broken = brokenCount(), top = 0, last = 0, peak = 0, hit = nil, aim = x and y and vec3(x, y, 0) or nil, sign = 1, miss = nil, since = 0}
end

local function checkUpdate(dt)
  if not check then return end
  check.t = check.t + dt
  if check.kind == 'doors' then
    if check.stage == 'open' and check.t > 2.5 then
      for _, l in ipairs(check.list) do l.open = gap(l) end
      for _, l in ipairs(check.list) do l.ctrl.tryAttachGroupImpulse() end
      check.stage = 'shut'
    elseif check.stage == 'shut' and check.t > 6.5 then
      local out, pass = {}, true
      for _, l in ipairs(check.list) do
        local opened = (l.open - l.shut) > 0.02
        local shutAgain = gap(l) < l.shut + 0.02
        if not opened then pass = false end
        out[#out + 1] = {name = l.name, opened = opened, shutAgain = shutAgain, moved = math.floor((l.open - l.shut) * 1000 + 0.5)}
      end
      send('doors', {latches = #check.list, pass = pass, list = out})
      check = nil
    end
  elseif check.kind == 'skidpad' then
    -- Sideways pull, in g, once the car is round its circle (the first four seconds are the run-up).
    local g = math.abs(sensors.gx2 or 0) / 9.81
    -- Held to a town-corner speed: flat out, a strong car ran wide and off the pad.
    input.event('throttle', math.abs(electrics.values.wheelspeed or 0) < 10 and 0.6 or 0.08, 1)
    if check.t > 4 then
      check.sum = check.sum + g * dt
      check.n = check.n + dt
      check.best = math.max(check.best, g)
      check.speed = math.max(check.speed, math.abs(electrics.values.wheelspeed or 0))
    end
    if check.t > 12 then
      input.event('throttle', 0, 1)
      input.event('steering', 0, 1)
      input.event('brake', 1, 1)
      local average = check.n > 0 and check.sum / check.n or 0
      local broke = brokenCount() - check.broken
      send('skidpad', {g = math.floor(average * 100 + 0.5) / 100, peak = math.floor(check.best * 100 + 0.5) / 100, kmh = math.floor(check.speed * 3.6 + 0.5), broke = broke, pass = average >= 0.35 and broke == 0})
      check = nil
    end
  elseif check.kind == 'pole' then
    local speed = math.abs(electrics.values.airspeed or 0)
    -- Up to the speed, then held there.
    if not check.hit then input.event('throttle', speed < check.target and 1 or 0.12, 1) end
    -- Kept pointing at the pole: how far off to one side it is, as a steering input. Which way the
    -- wheel turns for a positive input is found by trying: if the aim gets worse, it is the other.
    if check.aim and not check.hit then
      local pos = obj:getPosition()
      local dir = obj:getDirectionVector()
      local tx, ty = check.aim.x - pos.x, check.aim.y - pos.y
      local far = math.sqrt(tx * tx + ty * ty)
      if far > 3 then
        local off = (dir.x * ty - dir.y * tx) / far
        check.since = check.since + dt
        if check.since > 0.6 then
          if check.miss and math.abs(off) > math.abs(check.miss) + 0.01 and math.abs(off) > 0.03 then check.sign = -check.sign end
          check.miss = off
          check.since = 0
        end
        input.event('steering', math.max(-0.5, math.min(0.5, -off * 4 * check.sign)), 1)
      end
    end
    check.top = math.max(check.top, speed)
    local slowing = (check.last - speed) / math.max(dt, 0.001)
    check.last = speed
    if speed > 5 and slowing > 40 and not check.hit then check.hit = {t = check.t, kmh = math.floor(speed * 3.6 + slowing * dt * 3.6 + 0.5)} end
    if check.hit then check.peak = math.max(check.peak, slowing / 9.81) end
    if (check.hit and check.t > check.hit.t + 3) or check.t > 25 then
      input.event('throttle', 0, 1)
      input.event('brake', 1, 1)
      local broke = brokenCount() - check.broken
      local list = latches()
      local shut = 0
      for _, l in ipairs(list) do if gap(l) < 0.05 then shut = shut + 1 end end
      send('pole', {hit = check.hit ~= nil, kmh = check.hit and check.hit.kmh or math.floor(check.top * 3.6 + 0.5), peakG = math.floor(check.peak * 10 + 0.5) / 10, broke = broke, latches = #list, stillShut = shut, pass = check.hit ~= nil})
      check = nil
    end
  end
end

M.updateGFX = function(dt)
  local done, err = pcall(checkUpdate, dt)
  if not done then
    local kind = check and check.kind or 'check'
    check = nil
    send(kind, {error = tostring(err)})
  end
end

M.telemetry = function()
  local done, err = pcall(telemetry)
  if not done then obj:queueGameEngineLua('if jbeamForge then jbeamForge.onTelemetry(' .. serialize({error = tostring(err)}) .. ') end') end
end

return M
