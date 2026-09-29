/**
 * What a vehicle script can use in BeamNG's vehicle Lua (fork): the globals,
 * the functions on them, the electrics values the game keeps, and the
 * functions a controller module can define. One list feeds the checker
 * (unknown names), the editor (completions and hover help) and the test
 * runner's stand-ins.
 *
 * BeamNG runs vehicle Lua on LuaJIT (Lua 5.1 with a few extras). Only what
 * vehicle Lua can reach is listed; game-engine Lua (the world, UI apps) is
 * another environment, reached with obj:queueGameEngineLua.
 */

export interface ApiEntry {
  /** Full name: "electrics.values", "obj:playSFX". */
  name: string;
  /** Call signature or type, as shown in completions. */
  sig: string;
  doc: string;
  kind: 'function' | 'method' | 'table' | 'value';
}

/** Lua's own globals (LuaJIT: 5.1 plus bit, jit). */
export const LUA_GLOBALS = [
  'assert', 'collectgarbage', 'error', 'getmetatable', 'setmetatable', 'ipairs', 'pairs', 'next', 'pcall', 'xpcall', 'print', 'rawequal', 'rawget', 'rawset', 'select', 'tonumber', 'tostring', 'type', 'unpack', 'load', 'loadstring', 'require',
  'math', 'string', 'table', 'os', 'coroutine', 'bit', 'jit', 'debug', '_G', '_VERSION',
] as const;

/** Globals BeamNG's vehicle Lua adds. */
export const BEAMNG_API: ApiEntry[] = [
  // Electrics: the car's shared values (read by props, lights, gauges and UI).
  { name: 'electrics', sig: 'table', doc: 'The car’s electrics: shared values every system reads (props, lights, gauges, sounds).', kind: 'table' },
  { name: 'electrics.values', sig: 'table<string, number>', doc: 'Every electrics value by name. Write your own (e.g. electrics.values.myWiper = 0.5) to drive props and lights.', kind: 'table' },
  { name: 'electrics.setIgnitionLevel', sig: 'electrics.setIgnitionLevel(level)', doc: '0 off, 1 accessory, 2 on, 3 starting.', kind: 'function' },
  { name: 'electrics.toggle_lights', sig: 'electrics.toggle_lights()', doc: 'Cycle headlights: off, low beam, high beam.', kind: 'function' },
  { name: 'electrics.setLightsState', sig: 'electrics.setLightsState(state)', doc: '0 off, 1 low beam, 2 high beam.', kind: 'function' },
  { name: 'electrics.toggle_left_signal', sig: 'electrics.toggle_left_signal()', doc: 'Left indicator on or off.', kind: 'function' },
  { name: 'electrics.toggle_right_signal', sig: 'electrics.toggle_right_signal()', doc: 'Right indicator on or off.', kind: 'function' },
  { name: 'electrics.toggle_warn_signal', sig: 'electrics.toggle_warn_signal()', doc: 'Hazard lights on or off.', kind: 'function' },
  { name: 'electrics.set_fog_lights', sig: 'electrics.set_fog_lights(on)', doc: 'Fog lights on (1) or off (0).', kind: 'function' },
  { name: 'electrics.horn', sig: 'electrics.horn(on)', doc: 'Sound the horn while true.', kind: 'function' },
  // Driver input.
  { name: 'input', sig: 'table', doc: 'The driver’s controls: input.throttle, input.brake, input.steering, input.clutch, input.parkingbrake (0–1, steering −1–1).', kind: 'table' },
  { name: 'input.throttle', sig: 'number', doc: 'Throttle pedal, 0–1.', kind: 'value' },
  { name: 'input.brake', sig: 'number', doc: 'Brake pedal, 0–1.', kind: 'value' },
  { name: 'input.steering', sig: 'number', doc: 'Steering, −1 (left) to 1 (right).', kind: 'value' },
  { name: 'input.clutch', sig: 'number', doc: 'Clutch pedal, 0–1.', kind: 'value' },
  { name: 'input.parkingbrake', sig: 'number', doc: 'Handbrake, 0–1.', kind: 'value' },
  { name: 'input.event', sig: 'input.event(name, value, filter)', doc: 'Set a control as if the driver moved it: input.event("throttle", 0.5, 1).', kind: 'function' },
  // The vehicle object.
  { name: 'obj', sig: 'userdata', doc: 'This vehicle in the physics engine. Call its functions with a colon: obj:getVelocity().', kind: 'table' },
  { name: 'obj:getId', sig: 'obj:getId()', doc: 'The vehicle’s id in the world.', kind: 'method' },
  { name: 'obj:getPosition', sig: 'obj:getPosition()', doc: 'Where the car is (vec3, metres).', kind: 'method' },
  { name: 'obj:getVelocity', sig: 'obj:getVelocity()', doc: 'Velocity (vec3, m/s).', kind: 'method' },
  { name: 'obj:getDirectionVector', sig: 'obj:getDirectionVector()', doc: 'Which way the car faces (vec3).', kind: 'method' },
  { name: 'obj:getDirectionVectorUp', sig: 'obj:getDirectionVectorUp()', doc: 'The car’s up direction (vec3).', kind: 'method' },
  { name: 'obj:getNodePosition', sig: 'obj:getNodePosition(cid)', doc: 'A node’s position relative to the car (vec3).', kind: 'method' },
  { name: 'obj:beamIsBroken', sig: 'obj:beamIsBroken(cid)', doc: 'Whether a beam has broken (glass, a hinge…).', kind: 'method' },
  { name: 'obj:getAirDensity', sig: 'obj:getAirDensity()', doc: 'Air density where the car is (kg/m³).', kind: 'method' },
  { name: 'obj:queueGameEngineLua', sig: 'obj:queueGameEngineLua(code)', doc: 'Run Lua in the game engine (world, UI, sounds outside the car).', kind: 'method' },
  { name: 'obj:createSFXSource', sig: 'obj:createSFXSource(file, profile, name, nodeId)', doc: 'Make a sound source on a node; returns its id. Profiles: "AudioDefaultLoop3D", "AudioDefault3D".', kind: 'method' },
  { name: 'obj:playSFX', sig: 'obj:playSFX(id)', doc: 'Start a sound source.', kind: 'method' },
  { name: 'obj:stopSFX', sig: 'obj:stopSFX(id)', doc: 'Stop a sound source.', kind: 'method' },
  { name: 'obj:setVolume', sig: 'obj:setVolume(id, volume)', doc: 'A sound source’s volume, 0–1.', kind: 'method' },
  { name: 'obj:setPitch', sig: 'obj:setPitch(id, pitch)', doc: 'A sound source’s pitch, 1 = as recorded.', kind: 'method' },
  { name: 'obj:setVolumePitch', sig: 'obj:setVolumePitch(id, volume, pitch)', doc: 'Volume and pitch together.', kind: 'method' },
  // Jbeam data.
  { name: 'v', sig: 'table', doc: 'This vehicle’s loaded jbeam: v.data.nodes, v.data.beams, v.data.props, v.data.variables…', kind: 'table' },
  { name: 'v.data', sig: 'table', doc: 'The jbeam data of every loaded part, merged.', kind: 'table' },
  // Other controllers and the powertrain.
  { name: 'controller', sig: 'table', doc: 'The car’s controllers (scripts like this one).', kind: 'table' },
  { name: 'controller.getController', sig: 'controller.getController(name)', doc: 'Another controller by name, or nil.', kind: 'function' },
  { name: 'controller.getControllerSafe', sig: 'controller.getControllerSafe(name)', doc: 'Another controller by name; calls on a missing one do nothing.', kind: 'function' },
  { name: 'controller.mainController', sig: 'table', doc: 'The shifting and driving controller (vehicleController).', kind: 'table' },
  { name: 'powertrain', sig: 'table', doc: 'Engine, gearbox, differentials and shafts.', kind: 'table' },
  { name: 'powertrain.getDevice', sig: 'powertrain.getDevice(name)', doc: 'A device by name ("mainEngine", "gearbox"), or nil.', kind: 'function' },
  { name: 'powertrain.getDevices', sig: 'powertrain.getDevices()', doc: 'Every device by name.', kind: 'function' },
  { name: 'powertrain.setDeviceMode', sig: 'powertrain.setDeviceMode(name, mode)', doc: 'Switch a device’s mode (a transfer case to "low", a differential to "locked").', kind: 'function' },
  { name: 'sensors', sig: 'table', doc: 'Acceleration felt by the car: sensors.gx, sensors.gy, sensors.gz (m/s²).', kind: 'table' },
  { name: 'beamstate', sig: 'table', doc: 'Breaking and deforming: beamstate.breakBreakGroup(group)…', kind: 'table' },
  { name: 'beamstate.breakBreakGroup', sig: 'beamstate.breakBreakGroup(group)', doc: 'Break every beam in a break group (pop a door off, shatter glass).', kind: 'function' },
  { name: 'damageTracker', sig: 'table', doc: 'Damage the game tracks: damageTracker.getDamage(group, name).', kind: 'table' },
  { name: 'damageTracker.getDamage', sig: 'damageTracker.getDamage(group, name)', doc: 'Whether a tracked part is damaged (e.g. "engine", "engineDisabled").', kind: 'function' },
  { name: 'wheels', sig: 'table', doc: 'The wheels: wheels.wheels, wheels.wheelRotators.', kind: 'table' },
  { name: 'hydros', sig: 'table', doc: 'The car’s hydros (beams that change length).', kind: 'table' },
  // UI and logging.
  { name: 'guihooks', sig: 'table', doc: 'Messages to the game’s UI.', kind: 'table' },
  { name: 'guihooks.message', sig: 'guihooks.message(text, seconds, category)', doc: 'Show a message on screen.', kind: 'function' },
  { name: 'guihooks.trigger', sig: 'guihooks.trigger(event, data)', doc: 'Send an event to UI apps.', kind: 'function' },
  { name: 'log', sig: 'log(level, origin, message)', doc: 'Write to the game’s log: level "I", "W", "E" or "D".', kind: 'function' },
  { name: 'dump', sig: 'dump(value)', doc: 'Print any value, tables included.', kind: 'function' },
  { name: 'dumpz', sig: 'dumpz(value, depth)', doc: 'Print a table to a depth.', kind: 'function' },
  // Helpers.
  { name: 'clamp', sig: 'clamp(x, min, max)', doc: 'x kept between min and max.', kind: 'function' },
  { name: 'lerp', sig: 'lerp(from, to, t)', doc: 'Between from and to by t (0–1).', kind: 'function' },
  { name: 'sign', sig: 'sign(x)', doc: '−1, 0 or 1.', kind: 'function' },
  { name: 'round', sig: 'round(x)', doc: 'x to the nearest whole number.', kind: 'function' },
  { name: 'vec3', sig: 'vec3(x, y, z)', doc: 'A 3D vector, with :length(), :normalized(), :dot(), :cross(), + and *.', kind: 'function' },
  { name: 'newTemporalSmoothing', sig: 'newTemporalSmoothing(inRate, outRate, autoCenterRate, start)', doc: 'Moves toward a target at a limited rate per second: s:get(target, dt), s:set(value), s:reset().', kind: 'function' },
  { name: 'newExponentialSmoothing', sig: 'newExponentialSmoothing(window, start)', doc: 'Smooths a noisy value: s:get(sample), s:set(value).', kind: 'function' },
];

/** Electrics values the game keeps (read them; props and scripts can use any of them). */
export const ELECTRICS: { name: string; doc: string; unit?: string }[] = [
  { name: 'wheelspeed', doc: 'Road speed from the wheels', unit: 'm/s' },
  { name: 'airspeed', doc: 'Speed through the air', unit: 'm/s' },
  { name: 'rpm', doc: 'Engine speed', unit: 'rpm' },
  { name: 'rpmTacho', doc: 'Engine speed for the rev counter', unit: 'rpm' },
  { name: 'gear', doc: 'Gear as text or number (R, N, 1, 2… or P R N D)' },
  { name: 'gearIndex', doc: 'Gear as a number (−1 reverse, 0 neutral)' },
  { name: 'throttle', doc: 'Throttle', unit: '0–1' },
  { name: 'brake', doc: 'Brake', unit: '0–1' },
  { name: 'clutch', doc: 'Clutch', unit: '0–1' },
  { name: 'steering', doc: 'Steering wheel angle', unit: '°' },
  { name: 'steering_input', doc: 'Steering input', unit: '−1–1' },
  { name: 'parkingbrake', doc: 'Handbrake', unit: '0–1' },
  { name: 'ignitionLevel', doc: '0 off, 1 accessory, 2 on, 3 starting' },
  { name: 'running', doc: 'Engine running (0/1)' },
  { name: 'lights', doc: 'Headlights: 0 off, 1 low, 2 high' },
  { name: 'lowbeam', doc: 'Low beam on (0/1)' },
  { name: 'highbeam', doc: 'High beam on (0/1)' },
  { name: 'fog', doc: 'Fog lights on (0/1)' },
  { name: 'signal_L', doc: 'Left indicator lit (flashes 0/1)' },
  { name: 'signal_R', doc: 'Right indicator lit (flashes 0/1)' },
  { name: 'hazard', doc: 'Hazards on (0/1)' },
  { name: 'reverse', doc: 'In reverse (0/1)' },
  { name: 'horn', doc: 'Horn sounding (0/1)' },
  { name: 'fuel', doc: 'Fuel left', unit: '0–1' },
  { name: 'watertemp', doc: 'Coolant temperature', unit: '°C' },
  { name: 'oiltemp', doc: 'Oil temperature', unit: '°C' },
  { name: 'engineLoad', doc: 'Engine load', unit: '0–1' },
  { name: 'turboBoost', doc: 'Turbo boost', unit: 'psi' },
  { name: 'altitude', doc: 'Height above sea level', unit: 'm' },
  { name: 'abs', doc: 'ABS working (0/1)' },
  { name: 'tcs', doc: 'Traction control working (0/1)' },
  { name: 'esc', doc: 'Stability control working (0/1)' },
  { name: 'isShifting', doc: 'Changing gear (0/1)' },
  { name: 'odometer', doc: 'Distance driven', unit: 'm' },
  { name: 'lightbar', doc: 'Light bar mode' },
];

/** Functions a controller module (the M table a script returns) can define; the game calls them. */
export const CONTROLLER_HOOKS: { name: string; sig: string; doc: string }[] = [
  { name: 'init', sig: 'init(jbeamData)', doc: 'Called once when the car spawns, with this controller’s settings from the jbeam.' },
  { name: 'initSecondStage', sig: 'initSecondStage(jbeamData)', doc: 'After every controller has run init.' },
  { name: 'reset', sig: 'reset(jbeamData)', doc: 'When the car is reset (R).' },
  { name: 'updateGFX', sig: 'updateGFX(dt)', doc: 'Every frame (about 60 times a second): animations, lights, logic.' },
  { name: 'update', sig: 'update(dt)', doc: 'Every physics step (2000 times a second): only for fast control like traction.' },
  { name: 'initSounds', sig: 'initSounds(jbeamData)', doc: 'Make sound sources here.' },
  { name: 'resetSounds', sig: 'resetSounds(jbeamData)', doc: 'Reset sounds with the car.' },
  { name: 'beamBroke', sig: 'beamBroke(id, energy)', doc: 'A beam broke.' },
  { name: 'setParameters', sig: 'setParameters(parameters)', doc: 'Settings changed from outside (another controller or the UI).' },
  { name: 'onDeserialize', sig: 'onDeserialize(data)', doc: 'Restore state after a Lua reload.' },
  { name: 'onSerialize', sig: 'onSerialize()', doc: 'Return state to keep over a Lua reload.' },
];

/** Every name a script may read without declaring it. */
export const KNOWN_GLOBALS: ReadonlySet<string> = new Set([...LUA_GLOBALS, ...BEAMNG_API.filter((e) => !e.name.includes('.') && !e.name.includes(':')).map((e) => e.name)]);

/** Standard library functions missing from vehicle Lua (sandboxed: no files or processes). */
export const UNAVAILABLE: Record<string, string> = {
  'os.execute': 'Vehicle Lua can’t run programs.',
  'os.remove': 'Vehicle Lua can’t delete files.',
  'os.rename': 'Vehicle Lua can’t rename files.',
  'os.exit': 'Would close the game.',
  'io.open': 'Vehicle Lua has no file access: use jbeam data (v.data) for settings.',
  'io.read': 'Vehicle Lua has no console input.',
  'io.write': 'Use print or log instead.',
};
