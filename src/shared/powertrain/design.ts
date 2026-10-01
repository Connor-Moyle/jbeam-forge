import { z } from 'zod';

/**
 * The engine designer: an engine described the way you'd design one (layout,
 * bore and stroke, valvetrain, cams, induction, fuel, tune) turned into what
 * the game needs: a torque curve, rev limits, weight, inertia and friction.
 * It's a believable model, not a simulation: the numbers land where real
 * engines of that shape do, and every choice moves them the way you'd expect.
 * The design is applied to a fitted base engine, which gives it its mounts,
 * shape and sound.
 */

export const ENGINE_LAYOUTS = ['inline', 'v', 'flat', 'w', 'rotary', 'electric'] as const;
export const BLOCK_MATERIALS = ['iron', 'aluminium', 'magnesium'] as const;
export const VALVETRAINS = ['ohv', 'sohc', 'dohc'] as const;
export const ASPIRATIONS = ['na', 'turbo', 'twin-turbo', 'supercharger'] as const;
export const FUELS = ['petrol', 'premium', 'race', 'e85', 'diesel'] as const;
export const FUEL_SYSTEMS = ['carburettor', 'single-point', 'port', 'direct'] as const;
export const INTAKES = ['economy', 'standard', 'sport', 'itb'] as const;
export const EXHAUSTS = ['restrictive', 'standard', 'sport', 'race'] as const;
export const FLYWHEELS = ['heavy', 'standard', 'light', 'race'] as const;

export const EngineDesignSchema = z.object({
  layout: z.enum(ENGINE_LAYOUTS),
  /** Cylinders (rotors for a rotary; ignored for electric). */
  cylinders: z.number().int().min(1).max(16),
  /** Bore and stroke in mm. */
  bore: z.number().min(40).max(140),
  stroke: z.number().min(40).max(140),
  block: z.enum(BLOCK_MATERIALS),
  head: z.enum(BLOCK_MATERIALS),
  valvetrain: z.enum(VALVETRAINS),
  valves: z.number().int().min(2).max(5),
  /** Variable valve timing: a broader curve. */
  vvt: z.boolean(),
  /** 0 = mild, low-down torque; 1 = race cams, power at the top. */
  cam: z.number().min(0).max(1),
  compression: z.number().min(6).max(22),
  aspiration: z.enum(ASPIRATIONS),
  /** Peak boost, psi. */
  boost: z.number().min(0).max(50),
  /** 0 = small turbo (early boost), 1 = big turbo (late boost, more at the top). */
  turboSize: z.number().min(0).max(1),
  fuel: z.enum(FUELS),
  fuelSystem: z.enum(FUEL_SYSTEMS),
  intake: z.enum(INTAKES),
  exhaust: z.enum(EXHAUSTS),
  /** 0 = rich and safe, 1 = lean and aggressive. */
  tune: z.number().min(0).max(1),
  redline: z.number().min(1500).max(20000),
  idle: z.number().min(300).max(2500),
  flywheel: z.enum(FLYWHEELS),
  /** Electric: motor power (kW) and its top speed (rpm). */
  motorKw: z.number().min(5).max(1500),
  motorRpm: z.number().min(3000).max(25000),
});

export type EngineDesign = z.infer<typeof EngineDesignSchema>;

export const DEFAULT_DESIGN: EngineDesign = {
  layout: 'inline',
  cylinders: 4,
  bore: 86,
  stroke: 86,
  block: 'iron',
  head: 'aluminium',
  valvetrain: 'dohc',
  valves: 4,
  vvt: false,
  cam: 0.4,
  compression: 10,
  aspiration: 'na',
  boost: 0,
  turboSize: 0.4,
  fuel: 'premium',
  fuelSystem: 'port',
  intake: 'standard',
  exhaust: 'standard',
  tune: 0.5,
  redline: 6800,
  idle: 850,
  flywheel: 'standard',
  motorKw: 150,
  motorRpm: 12000,
};

/** Ready-made starting points, like a parts catalogue. */
export const DESIGN_PRESETS: { id: string; label: string; design: Partial<EngineDesign> }[] = [
  { id: 'economy-i4', label: '1.6 economy four', design: { layout: 'inline', cylinders: 4, bore: 79, stroke: 81.5, valvetrain: 'sohc', valves: 2, cam: 0.15, compression: 9.5, fuel: 'petrol', fuelSystem: 'single-point', intake: 'economy', exhaust: 'restrictive', redline: 6000, flywheel: 'heavy' } },
  { id: 'hot-hatch', label: '2.0 hot-hatch turbo', design: { layout: 'inline', cylinders: 4, bore: 86, stroke: 86, valvetrain: 'dohc', valves: 4, vvt: true, cam: 0.45, compression: 9.5, aspiration: 'turbo', boost: 17, turboSize: 0.35, fuel: 'premium', fuelSystem: 'direct', intake: 'sport', exhaust: 'sport', redline: 6800 } },
  { id: 'e30-m10', label: '1.8 M10 four (E30 318i)', design: { layout: 'inline', cylinders: 4, bore: 89, stroke: 71, block: 'iron', head: 'aluminium', valvetrain: 'sohc', valves: 2, cam: 0.35, compression: 9.5, fuel: 'premium', fuelSystem: 'port', intake: 'standard', exhaust: 'standard', redline: 6200, idle: 800, flywheel: 'standard' } },
  { id: 's14', label: '2.3 S14 four (E30 M3)', design: { layout: 'inline', cylinders: 4, bore: 93.4, stroke: 84, block: 'iron', head: 'aluminium', valvetrain: 'dohc', valves: 4, cam: 0.7, compression: 10.5, fuel: 'premium', fuelSystem: 'port', intake: 'itb', exhaust: 'sport', redline: 7250, flywheel: 'light' } },
  { id: 'i6', label: '3.0 straight six', design: { layout: 'inline', cylinders: 6, bore: 84, stroke: 89.6, block: 'aluminium', valvetrain: 'dohc', valves: 4, vvt: true, cam: 0.45, compression: 10.5, fuelSystem: 'port', intake: 'sport', exhaust: 'sport', redline: 7000 } },
  { id: 'muscle-v8', label: '5.7 pushrod V8', design: { layout: 'v', cylinders: 8, bore: 101.6, stroke: 88.4, block: 'iron', head: 'iron', valvetrain: 'ohv', valves: 2, cam: 0.35, compression: 9.5, fuelSystem: 'port', intake: 'standard', exhaust: 'sport', redline: 5800, idle: 700, flywheel: 'heavy' } },
  { id: 'flat-6', label: '3.6 flat six', design: { layout: 'flat', cylinders: 6, bore: 100, stroke: 76.4, block: 'aluminium', valvetrain: 'dohc', valves: 4, vvt: true, cam: 0.6, compression: 11.3, fuelSystem: 'direct', intake: 'sport', exhaust: 'sport', redline: 7800, flywheel: 'light' } },
  { id: 'rotary', label: '1.3 twin-rotor', design: { layout: 'rotary', cylinders: 2, cam: 0.6, compression: 9.4, fuelSystem: 'port', intake: 'sport', exhaust: 'sport', redline: 8500, idle: 900, flywheel: 'light' } },
  { id: 'diesel', label: '2.0 turbo diesel', design: { layout: 'inline', cylinders: 4, bore: 84, stroke: 90, valvetrain: 'dohc', valves: 4, cam: 0.1, compression: 16.5, aspiration: 'turbo', boost: 22, turboSize: 0.3, fuel: 'diesel', fuelSystem: 'direct', intake: 'standard', exhaust: 'standard', redline: 4800, idle: 800, flywheel: 'heavy' } },
  { id: 'electric', label: 'Electric motor', design: { layout: 'electric', motorKw: 200, motorRpm: 14000, idle: 300, redline: 14000 } },
];

export interface DesignResult {
  displacementL: number;
  /** [rpm, Nm] up past the rev limit. */
  curve: [number, number][];
  peakTorque: { nm: number; rpm: number };
  peakPower: { kw: number; rpm: number };
  /** Where the curve ends and the limiter cuts in. */
  maxRPM: number;
  revLimiterRPM: number;
  idleRPM: number;
  massKg: number;
  inertia: number;
  friction: number;
  dynamicFriction: number;
  engineBrakeTorque: number;
  /** Mean piston speed at the limit (m/s). */
  pistonSpeed: number;
  /** 0 to 100: how long it'd last driven hard. */
  reliability: number;
  /** Rough fuel use at a steady cruise, L/100 km. */
  economy: number;
  /** Things to know: knock, piston speed, a valvetrain past its revs… */
  warnings: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const kwAt = (rpm: number, nm: number) => (nm * rpm * 2 * Math.PI) / 60000;

/** Displacement in litres. A rotary counts 0.654 L a rotor, as the 13B's 1.3 L. */
export function displacementOf(d: Pick<EngineDesign, 'layout' | 'cylinders' | 'bore' | 'stroke'>): number {
  if (d.layout === 'electric') return 0;
  if (d.layout === 'rotary') return d.cylinders * 0.654;
  return (Math.PI / 4) * (d.bore / 1000) ** 2 * (d.stroke / 1000) * d.cylinders * 1000;
}

/** Highest compression a fuel takes before it knocks (naturally aspirated; boost lowers it). */
const KNOCK_LIMIT: Record<EngineDesign['fuel'], number> = { petrol: 10, premium: 11, race: 12.5, e85: 13, diesel: 23 };
const VALVETRAIN_REVS: Record<EngineDesign['valvetrain'], number> = { ohv: 6500, sohc: 7500, dohc: 9500 };
const MATERIAL_MASS: Record<EngineDesign['block'], number> = { iron: 1, aluminium: 0.62, magnesium: 0.5 };
const MATERIAL_LIFE: Record<EngineDesign['block'], number> = { iron: 0, aluminium: -3, magnesium: -10 };

/** Turn a design into the engine the game will run. */
export function designEngine(d: EngineDesign): DesignResult {
  if (d.layout === 'electric') return electricEngine(d);
  const warnings: string[] = [];
  const litres = displacementOf(d);
  const rotary = d.layout === 'rotary';
  const diesel = d.fuel === 'diesel';
  const boosted = d.aspiration !== 'na' && d.boost > 0;

  // Breathing: how well it fills its cylinders at best (brake mean effective pressure, bar).
  let bmep = diesel ? 9.5 : 11.4;
  bmep *= { ohv: 0.94, sohc: 0.98, dohc: 1.0 }[d.valvetrain];
  bmep *= { 2: 0.95, 3: 0.98, 4: 1.0, 5: 1.01 }[d.valves] ?? 1;
  bmep *= { carburettor: 0.94, 'single-point': 0.96, port: 1.0, direct: 1.03 }[d.fuelSystem];
  bmep *= { economy: 0.95, standard: 1.0, sport: 1.03, itb: 1.06 }[d.intake];
  bmep *= { restrictive: 0.95, standard: 1.0, sport: 1.03, race: 1.05 }[d.exhaust];
  bmep *= { petrol: 0.98, premium: 1.0, race: 1.04, e85: 1.06, diesel: 1.0 }[d.fuel];
  bmep *= 1 + (d.tune - 0.5) * 0.08;
  bmep *= 1 + d.cam * 0.04; // big cams make a little more at their peak
  // Compression: about 3% a point, up to where the fuel knocks (lower with boost).
  // Boost lowers the knock limit; direct injection cools the charge and raises it.
  const knock = KNOCK_LIMIT[d.fuel] - (boosted ? d.boost / 12 : 0) + (d.fuelSystem === 'direct' && !diesel ? 1 : 0);
  const base = diesel ? 17 : 10;
  bmep *= 1 + clamp(Math.min(d.compression, knock) - base, -6, 6) * (diesel ? 0.012 : 0.03);
  if (d.compression > knock + 0.2) {
    bmep *= 1 - (d.compression - knock) * 0.04;
    warnings.push(`Compression ${d.compression}:1 is past what ${d.fuel === 'e85' ? 'E85' : d.fuel} takes${boosted ? ' with this boost' : ''} (about ${knock.toFixed(1)}:1): it knocks, losing power and reliability.`);
  }
  if (rotary) bmep *= 1.12;

  // Peak torque (four-stroke: T = bmep · Vd / 4π).
  const naPeak = (bmep * 1e5 * (litres / 1000)) / (4 * Math.PI);

  // Revs: what the valvetrain and the piston speed allow.
  const valveLimit = rotary ? 11000 : VALVETRAIN_REVS[d.valvetrain] * (1 + d.cam * 0.08) * (diesel ? 0.6 : 1);
  const redline = clamp(Math.round(d.redline / 50) * 50, d.idle + 1500, 20000);
  if (redline > valveLimit) warnings.push(`The ${d.valvetrain.toUpperCase()} valvetrain floats past about ${Math.round(valveLimit / 100) * 100} rpm: power falls away above it.`);
  const pistonSpeed = rotary ? 0 : (2 * (d.stroke / 1000) * redline) / 60;
  if (pistonSpeed > 22) warnings.push(`Mean piston speed is ${pistonSpeed.toFixed(1)} m/s at the limit (over about 22 is race territory): a shorter stroke or a lower limit lasts longer.`);

  // Where the torque peaks: mild cams low down, race cams high up.
  const peakFrac = (diesel ? 0.38 : 0.55) + d.cam * 0.3;
  const peakRpm = d.idle + (redline - d.idle) * peakFrac;
  const width = (diesel ? 0.32 : 0.42) * (d.vvt ? 1.35 : 1) * (1.15 - d.cam * 0.4);
  // Boost: a turbo comes in later the bigger it is; a supercharger is there from low down.
  const pressure = 1 + d.boost / 14.7;
  const spoolStart = d.idle + (redline - d.idle) * (0.12 + d.turboSize * 0.35) * (d.aspiration === 'twin-turbo' ? 0.8 : 1);
  const spoolFull = spoolStart + (redline - d.idle) * (0.12 + d.turboSize * 0.2);
  const boostAt = (rpm: number) => {
    if (!boosted) return 1;
    if (d.aspiration === 'supercharger') return 1 + (pressure - 1) * clamp(0.55 + (rpm - d.idle) / (redline - d.idle) * 0.45, 0, 1) * 0.92; // the drive belt costs a little
    const t = clamp((rpm - spoolStart) / Math.max(1, spoolFull - spoolStart), 0, 1);
    const bigTop = 1 + d.turboSize * 0.06 * clamp((rpm - spoolFull) / (redline - spoolFull + 1), 0, 1);
    return 1 + (pressure - 1) * (t * t * (3 - 2 * t)) * 0.88 * bigTop;
  };
  const shape = (rpm: number) => {
    const x = (rpm - peakRpm) / ((redline - d.idle) * width);
    const below = rpm < peakRpm;
    // Gentle on the way up, steeper past the peak; a little lower right at idle.
    const s = Math.exp(-(x * x) * (below ? 0.9 : 1.0));
    const floatLoss = rpm > valveLimit ? Math.max(0.3, 1 - ((rpm - valveLimit) / 1000) * 0.35) : 1;
    return (0.42 + 0.58 * s) * floatLoss;
  };
  const step = redline > 9000 ? 500 : 250;
  const curve: [number, number][] = [[0, r1(naPeak * 0.4)]];
  for (let rpm = 500; rpm <= redline + 1000; rpm += step) curve.push([rpm, r1(Math.max(1, naPeak * shape(rpm) * boostAt(rpm)))]);
  const peaks = peaksOf(curve, redline);

  // Weight: block and head by material, more for more cylinders, cams and plumbing.
  const blockKg = (30 + litres * 30) * MATERIAL_MASS[d.block];
  const headKg = (8 + d.cylinders * (d.valvetrain === 'dohc' ? 2.6 : 1.8) + (d.valves - 2) * d.cylinders * 0.2) * MATERIAL_MASS[d.head];
  const layoutKg = { inline: 0, v: 6, flat: 8, w: 12, rotary: -20, electric: 0 }[d.layout];
  const inductionKg = { na: 0, turbo: 14, 'twin-turbo': 24, supercharger: 18 }[d.aspiration];
  const massKg = Math.max(40, Math.round(blockKg + headKg + layoutKg + inductionKg + d.cylinders * 3 + (diesel ? 30 : 0)));

  // Rotating parts: the flywheel matters most.
  const inertia = Math.round({ heavy: 0.26, standard: 0.16, light: 0.1, race: 0.06 }[d.flywheel] * (0.6 + litres * 0.2) * 1000) / 1000;
  const friction = r1(8 + litres * 6 + (d.valvetrain === 'ohv' ? 2 : 0));
  const dynamicFriction = Math.round((0.012 + litres * 0.004) * 10000) / 10000;
  const engineBrakeTorque = Math.round(12 + litres * (diesel ? 18 : 14));

  // Reliability and economy.
  let reliability = 92 + MATERIAL_LIFE[d.block] + MATERIAL_LIFE[d.head] / 2;
  reliability -= Math.max(0, pistonSpeed - 18) * 4;
  reliability -= Math.max(0, redline - valveLimit) / 100;
  reliability -= Math.max(0, d.compression - knock) * 8;
  reliability -= boosted ? d.boost * 0.5 : 0;
  reliability -= (d.tune - 0.5) * 20;
  reliability -= d.cam * 6;
  if (rotary) reliability -= 10;
  if (diesel) reliability += 5;
  const economy = r1((litres * 3.2 + 2.5) * (diesel ? 0.75 : 1) * (1 + (d.tune - 0.5) * 0.15) * { carburettor: 1.15, 'single-point': 1.08, port: 1, direct: 0.92 }[d.fuelSystem] * (rotary ? 1.4 : 1) * (boosted ? 0.95 : 1));

  return {
    displacementL: Math.round(litres * 100) / 100,
    curve,
    peakTorque: peaks.torque,
    peakPower: peaks.power,
    maxRPM: redline + 100,
    revLimiterRPM: redline,
    idleRPM: d.idle,
    massKg,
    inertia,
    friction,
    dynamicFriction,
    engineBrakeTorque,
    pistonSpeed: Math.round(pistonSpeed * 10) / 10,
    reliability: Math.round(clamp(reliability, 5, 100)),
    economy,
    warnings,
  };
}

function electricEngine(d: EngineDesign): DesignResult {
  // Flat torque up to the base speed, then constant power to the top.
  const top = d.motorRpm;
  const baseRpm = top * 0.33;
  const peakNm = (d.motorKw * 60000) / (2 * Math.PI * baseRpm);
  const curve: [number, number][] = [];
  for (let rpm = 0; rpm <= top; rpm += 500) curve.push([rpm, r1(rpm <= baseRpm ? peakNm : (peakNm * baseRpm) / rpm)]);
  const peaks = peaksOf(curve, top);
  return {
    displacementL: 0,
    curve,
    peakTorque: peaks.torque,
    peakPower: peaks.power,
    maxRPM: top,
    revLimiterRPM: top,
    idleRPM: 0,
    massKg: Math.round(35 + d.motorKw * 0.22),
    inertia: 0.05,
    friction: 2,
    dynamicFriction: 0.002,
    engineBrakeTorque: 0,
    pistonSpeed: 0,
    reliability: 95,
    economy: r1(14 + d.motorKw * 0.01),
    warnings: [],
  };
}

function peaksOf(curve: readonly [number, number][], limit: number): { torque: { nm: number; rpm: number }; power: { kw: number; rpm: number } } {
  let torque = { nm: 0, rpm: 0 };
  let power = { kw: 0, rpm: 0 };
  for (const [rpm, nm] of curve) {
    if (rpm > limit) continue;
    if (nm > torque.nm) torque = { nm, rpm };
    const kw = kwAt(rpm, nm);
    if (kw > power.kw) power = { kw: r1(kw), rpm };
  }
  return { torque, power };
}

/** A short name: "2.0 L inline-4 turbo", "5.7 L V8", "twin-rotor", "electric 200 kW". */
export function designName(d: EngineDesign): string {
  if (d.layout === 'electric') return `Electric ${Math.round(d.motorKw)} kW`;
  const litres = displacementOf(d).toFixed(1);
  const shape = d.layout === 'rotary' ? `${d.cylinders === 1 ? 'single' : d.cylinders === 2 ? 'twin' : d.cylinders === 3 ? 'three' : 'four'}-rotor` : d.layout === 'inline' ? `inline-${d.cylinders}` : d.layout === 'flat' ? `flat-${d.cylinders}` : `${d.layout.toUpperCase()}${d.cylinders}`;
  const forced = { na: '', turbo: ' turbo', 'twin-turbo': ' twin-turbo', supercharger: ' supercharged' }[d.aspiration];
  return `${litres} L ${shape}${d.boost > 0 ? forced : ''}${d.fuel === 'diesel' ? ' diesel' : ''}`;
}

/** Cylinder counts each layout can have. */
export function cylinderChoices(layout: EngineDesign['layout']): number[] {
  switch (layout) {
    case 'inline':
      return [1, 2, 3, 4, 5, 6];
    case 'v':
      return [2, 4, 6, 8, 10, 12, 16];
    case 'flat':
      return [2, 4, 6, 8, 12];
    case 'w':
      return [8, 12, 16];
    case 'rotary':
      return [1, 2, 3, 4];
    case 'electric':
      return [1];
  }
}

/** Keep a design consistent after one choice changed (a V needs an even count, a diesel no spark revs…). */
export function tidyDesign(d: EngineDesign): EngineDesign {
  const choices = cylinderChoices(d.layout);
  const cylinders = choices.includes(d.cylinders) ? d.cylinders : choices.reduce((a, b) => (Math.abs(b - d.cylinders) < Math.abs(a - d.cylinders) ? b : a), choices[0]!);
  const boost = d.aspiration === 'na' ? 0 : d.boost > 0 ? d.boost : 10;
  const idle = Math.min(d.idle, d.redline - 1500);
  return { ...d, cylinders, boost, idle: Math.max(300, idle) };
}

/** What a design changes on a fitted engine: the numbers its mainEngine (and turbo) already has. */
export interface DesignTarget {
  /** Edit keys that exist on the base engine, so they can be set. */
  keys: { maxRPM?: string; revLimiterRPM?: string; idleRPM?: string; inertia?: string; friction?: string; dynamicFriction?: string; engineBrakeTorque?: string; wastegateStart?: string; wastegateLimit?: string };
  /** The base engine has a turbocharger of its own (its boost is added on top of the curve in game). */
  hasTurbo: boolean;
  /** The base engine set's weight, kg (its nodes). */
  gameMassKg: number;
}

/**
 * The builder's edits for a design: the curve (with the boost baked in,
 * unless the base engine's own turbo makes it in game), the revs, friction,
 * inertia, and the weight as a scale of the base engine's.
 */
export function editsForDesign(design: EngineDesign, target: DesignTarget, fields: Readonly<Record<string, number>>, massScaleKey: string): { fields: Record<string, number>; torque: [number, number][]; design: EngineDesign; result: DesignResult } {
  const result = designEngine(design);
  const turboInGame = target.hasTurbo && design.aspiration !== 'na' && design.aspiration !== 'supercharger' && design.boost > 0;
  const curve = turboInGame ? designEngine({ ...design, aspiration: 'na', boost: 0 }).curve : result.curve;
  const out: Record<string, number> = { ...fields };
  const set = (k: string | undefined, v: number) => {
    if (k) out[k] = v;
  };
  set(target.keys.maxRPM, result.maxRPM);
  set(target.keys.revLimiterRPM, result.revLimiterRPM);
  set(target.keys.idleRPM, result.idleRPM);
  set(target.keys.inertia, result.inertia);
  set(target.keys.friction, result.friction);
  set(target.keys.dynamicFriction, result.dynamicFriction);
  set(target.keys.engineBrakeTorque, result.engineBrakeTorque);
  if (turboInGame) {
    set(target.keys.wastegateStart, design.boost);
    set(target.keys.wastegateLimit, design.boost + 2);
  }
  if (target.gameMassKg > 0) out[massScaleKey] = Math.round(clamp(result.massKg / target.gameMassKg, 0.3, 3) * 100) / 100;
  return { fields: out, torque: curve, design, result };
}
