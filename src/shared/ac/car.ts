import { iniNumber, parseIni, parseLut, type Ini } from './files';

/**
 * What an Assetto Corsa car's data files say about it, pulled into one plain
 * summary. Worked out from the stored file text each time, so better parsing
 * later improves projects that were imported earlier.
 */

export interface AcAxleTyre {
  name: string | null;
  /** Metres. */
  radius: number | null;
  rimRadius: number | null;
  width: number | null;
}

export interface AcCarSummary {
  name: string | null;
  brand: string | null;
  carClass: string | null;
  country: string | null;
  year: number | null;
  author: string | null;
  /** Plain text (the game's <br> turned into line breaks). */
  description: string | null;
  tags: string[];
  /** Kilograms, including the driver as AC counts it. */
  massKg: number | null;
  maxFuelL: number | null;
  wheelbase: number | null;
  /** Share of the weight on the front axle (0–1). */
  frontWeight: number | null;
  trackFront: number | null;
  trackRear: number | null;
  suspensionFront: string | null;
  suspensionRear: string | null;
  tyresFront: AcAxleTyre;
  tyresRear: AcAxleTyre;
  engine: {
    limiter: number | null;
    idle: number | null;
    /** rpm → Nm, from power.lut (before any turbo boost). */
    torqueCurve: [number, number][];
    peakTorque: { nm: number; rpm: number } | null;
    peakPower: { kw: number; rpm: number } | null;
    turbo: boolean;
  };
  drivetrain: {
    layout: string | null;
    gears: number[];
    reverse: number | null;
    finalDrive: number | null;
    diffPower: number | null;
    diffCoast: number | null;
  };
  brakes: { maxTorque: number | null; frontShare: number | null };
  steering: { lock: number | null; ratio: number | null };
  /** Files kept with the project, by folder. */
  fileCount: { data: number; extension: number; ui: number };
}

/** ui_car.json as the game writes it: tolerate raw tabs/newlines in strings, trailing commas and a BOM. */
export function parseUiJson(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/"(?:[^"\\]|\\.)*"/gs, (s) => s.replace(/[\r\n\t]/g, (c) => (c === '\t' ? '\\t' : '\\n')))
    .replace(/,\s*([}\]])/g, '$1');
  try {
    const v: unknown = JSON.parse(cleaned);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function plainDescription(html: string | null): string | null {
  if (!html) return null;
  return (
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || null
  );
}

function tyre(ini: Ini | undefined, axle: 'FRONT' | 'REAR'): AcAxleTyre {
  return {
    name: ini?.[axle]?.NAME ?? null,
    radius: iniNumber(ini, axle, 'RADIUS'),
    rimRadius: iniNumber(ini, axle, 'RIM_RADIUS'),
    width: iniNumber(ini, axle, 'WIDTH'),
  };
}

const SUSPENSION_NAMES: Record<string, string> = {
  DWB: 'Double wishbone',
  DWB2: 'Double wishbone',
  STRUT: 'MacPherson strut',
  AXLE: 'Solid axle',
  ML: 'Multi-link',
};

/** Case-insensitive file lookup: data/car.ini, DATA/Car.INI… */
function fileText(files: Readonly<Record<string, string>>, path: string): string | undefined {
  const want = path.toLowerCase();
  for (const [k, v] of Object.entries(files)) if (k.toLowerCase() === want) return v;
  return undefined;
}

export function summarizeAcCar(files: Readonly<Record<string, string>>): AcCarSummary {
  const ini = (name: string) => {
    const t = fileText(files, `data/${name}`);
    return t === undefined ? undefined : parseIni(t);
  };
  const car = ini('car.ini');
  const susp = ini('suspensions.ini');
  const tyres = ini('tyres.ini');
  const engine = ini('engine.ini');
  const drive = ini('drivetrain.ini');
  const brakes = ini('brakes.ini');
  const uiText = fileText(files, 'ui/ui_car.json');
  const ui = uiText ? parseUiJson(uiText) : null;

  const powerFile = engine?.HEADER?.POWER_CURVE ?? 'power.lut';
  const curveText = fileText(files, `data/${powerFile}`);
  const torqueCurve = curveText ? parseLut(curveText) : [];
  let peakTorque: AcCarSummary['engine']['peakTorque'] = null;
  let peakPower: AcCarSummary['engine']['peakPower'] = null;
  const limiter = iniNumber(engine, 'ENGINE_DATA', 'LIMITER');
  for (const [rpm, nm] of torqueCurve) {
    if (limiter !== null && rpm > limiter) continue; // the curve often runs past the limiter
    if (!peakTorque || nm > peakTorque.nm) peakTorque = { nm, rpm };
    const kw = (nm * rpm * 2 * Math.PI) / 60 / 1000;
    if (!peakPower || kw > peakPower.kw) peakPower = { kw, rpm };
  }

  const gearCount = iniNumber(drive, 'GEARS', 'COUNT') ?? 0;
  const gears: number[] = [];
  for (let i = 1; i <= gearCount; i++) {
    const g = iniNumber(drive, 'GEARS', `GEAR_${i}`);
    if (g !== null) gears.push(g);
  }
  const suspType = (axle: 'FRONT' | 'REAR') => {
    const t = susp?.[axle]?.TYPE?.toUpperCase();
    return t ? (SUSPENSION_NAMES[t] ?? t) : null;
  };
  const yearRaw = ui?.year;
  const year = typeof yearRaw === 'number' ? yearRaw : typeof yearRaw === 'string' && /^\d{4}$/.test(yearRaw.trim()) ? Number(yearRaw) : null;
  const count = (prefix: string) => Object.keys(files).filter((k) => k.toLowerCase().startsWith(prefix)).length;

  return {
    name: str(ui?.name) ?? car?.INFO?.SCREEN_NAME ?? null,
    brand: str(ui?.brand),
    carClass: str(ui?.class),
    country: str(ui?.country),
    year,
    author: str(ui?.author),
    description: plainDescription(str(ui?.description)),
    tags: Array.isArray(ui?.tags) ? ui.tags.filter((t): t is string => typeof t === 'string') : [],
    massKg: iniNumber(car, 'BASIC', 'TOTALMASS'),
    maxFuelL: iniNumber(car, 'FUEL', 'MAX_FUEL'),
    wheelbase: iniNumber(susp, 'BASIC', 'WHEELBASE'),
    frontWeight: iniNumber(susp, 'BASIC', 'CG_LOCATION'),
    trackFront: iniNumber(susp, 'FRONT', 'TRACK'),
    trackRear: iniNumber(susp, 'REAR', 'TRACK'),
    suspensionFront: suspType('FRONT'),
    suspensionRear: suspType('REAR'),
    tyresFront: tyre(tyres, 'FRONT'),
    tyresRear: tyre(tyres, 'REAR'),
    engine: {
      limiter,
      idle: iniNumber(engine, 'ENGINE_DATA', 'MINIMUM'),
      torqueCurve,
      peakTorque,
      peakPower,
      turbo: Object.keys(engine ?? {}).some((s) => s.startsWith('TURBO_')),
    },
    drivetrain: {
      layout: drive?.TRACTION?.TYPE ?? null,
      gears,
      reverse: iniNumber(drive, 'GEARS', 'GEAR_R'),
      finalDrive: iniNumber(drive, 'GEARS', 'FINAL'),
      diffPower: iniNumber(drive, 'DIFFERENTIAL', 'POWER'),
      diffCoast: iniNumber(drive, 'DIFFERENTIAL', 'COAST'),
    },
    brakes: { maxTorque: iniNumber(brakes, 'DATA', 'MAX_TORQUE'), frontShare: iniNumber(brakes, 'DATA', 'FRONT_SHARE') },
    steering: { lock: iniNumber(car, 'CONTROLS', 'STEER_LOCK'), ratio: iniNumber(car, 'CONTROLS', 'STEER_RATIO') },
    fileCount: { data: count('data/'), extension: count('extension/'), ui: count('ui/') },
  };
}
