import { isJbeamObject, type JbeamObject, type JbeamValue } from '../jbeam/parse';

/**
 * What a stock engine or gearbox is, read from its jbeam: the devices in its
 * powertrain section, the engine's torque curve and limits, the gearbox's
 * ratios. Used to sort the workshops' catalogues and show spec sheets.
 */

/** Device types in a part's powertrain table (combustionEngine, manualGearbox…). */
export function powertrainDevices(part: JbeamObject): string[] {
  const t = part.powertrain;
  if (!Array.isArray(t) || !Array.isArray(t[0])) return [];
  const col = (t[0]).map(String).indexOf('type');
  return t.slice(1).flatMap((r) => (Array.isArray(r) && typeof r[col] === 'string' ? [r[col]] : []));
}

export const isEnginePart = (p: JbeamObject) => powertrainDevices(p).some((d) => d === 'combustionEngine' || d === 'electricMotor');
export const isGearboxPart = (p: JbeamObject) => powertrainDevices(p).some((d) => /gearbox$/i.test(d));

/** A part's display name (the game sometimes stores a per-language object). */
export function partTitle(part: JbeamObject, fallback: string): string {
  const info = isJbeamObject(part.information) ? part.information : null;
  const n = info?.name;
  // Untranslated keys ("ui.vehicleconfig.information.name.BRAND TCM 8.9L…"): keep the readable tail.
  if (typeof n === 'string' && n.trim()) return n.trim().replace(/^ui\.[\w.]+\.name\.(BRAND\s+)?/, '');
  if (isJbeamObject(n)) {
    const s = Object.values(n).find((v): v is string => typeof v === 'string' && !!v.trim());
    if (s) return s.trim();
  }
  return fallback;
}

export interface EngineSpecs {
  /** Inline-4, V8, Flat-6, Rotary, Electric… */
  layout: string;
  displacementL: number | null;
  fuel: 'petrol' | 'diesel' | 'electric';
  /** Turbo / supercharger somewhere in the set. */
  forcedInduction: 'turbo' | 'supercharger' | null;
  idleRPM: number | null;
  maxRPM: number | null;
  /** rpm → Nm (the base curve, before forced induction). */
  torqueCurve: [number, number][];
  peakTorque: { nm: number; rpm: number } | null;
  peakPower: { kw: number; rpm: number } | null;
}

const LAYOUTS: [RegExp, string][] = [
  [/\belectric|\bev\b|motor/i, 'Electric'],
  [/rotary|wankel/i, 'Rotary'],
  [/\b(?:flat|boxer|h|f)[- ]?(\d{1,2})\b/i, 'Flat-$1'],
  [/\bi(\d{1,2})\b|inline[- ]?(\d{1,2})/i, 'Inline-$1$2'],
  [/\bv(\d{1,2})\b/i, 'V$1'],
  [/\bw(\d{1,2})\b/i, 'W$1'],
  [/\b(single|1)[- ]?cyl/i, 'Single'],
];

export function engineLayout(text: string): string {
  for (const [re, label] of LAYOUTS) {
    const m = text.match(re);
    if (m) return label.replace('$1', m[1] ?? '').replace('$2', m[2] ?? '');
  }
  return 'Other';
}

function table(v: JbeamValue | undefined): [number, number][] {
  if (!Array.isArray(v)) return [];
  return v.slice(1).flatMap((r) => (Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' ? [[r[0], r[1]] as [number, number]] : []));
}

/** Specs of an engine set: its root part (with mainEngine) and every part fitted with it. */
export function engineSpecs(root: JbeamObject, parts: readonly JbeamObject[], title: string): EngineSpecs {
  const main = isJbeamObject(root.mainEngine) ? root.mainEngine : {};
  const num = (k: string) => (typeof main[k] === 'number' ? main[k] : null);
  const curve = table(main.torque);
  const maxRPM = num('maxRPM');
  let peakTorque: EngineSpecs['peakTorque'] = null;
  let peakPower: EngineSpecs['peakPower'] = null;
  for (const [rpm, nm] of curve) {
    if (maxRPM !== null && rpm > maxRPM) continue;
    if (!peakTorque || nm > peakTorque.nm) peakTorque = { nm, rpm };
    const kw = (nm * rpm * 2 * Math.PI) / 60000;
    if (!peakPower || kw > peakPower.kw) peakPower = { kw, rpm };
  }
  const devices = powertrainDevices(root);
  const energy = typeof main.requiredEnergyType === 'string' ? main.requiredEnergyType : '';
  const fuel = devices.includes('electricMotor') || /electric/i.test(energy) ? 'electric' : /diesel/i.test(energy) || /diesel/i.test(title) ? 'diesel' : 'petrol';
  let forced: EngineSpecs['forcedInduction'] = null;
  for (const p of parts) {
    const m = isJbeamObject(p.mainEngine) ? p.mainEngine : null;
    if (m && ('turbocharger' in m || isJbeamObject(p.turbocharger))) forced = 'turbo';
    else if (!forced && m && ('supercharger' in m || isJbeamObject(p.supercharger))) forced = 'supercharger';
  }
  const litres = title.match(/(\d+(?:\.\d+)?)\s*L\b/i);
  return {
    layout: fuel === 'electric' ? 'Electric' : engineLayout(title),
    displacementL: litres ? Number(litres[1]) : null,
    fuel,
    forcedInduction: forced,
    idleRPM: num('idleRPM'),
    maxRPM,
    torqueCurve: curve,
    peakTorque,
    peakPower,
  };
}

export interface GearboxSpecs {
  /** Manual, Automatic, Dual-clutch, Sequential, CVT. */
  kind: string;
  /** Forward gears (0 for a CVT). */
  gears: number;
  /** As in the jbeam: reverse first, then neutral (0), then forward. */
  ratios: number[];
}

const GEARBOX_KINDS: Record<string, string> = { manualGearbox: 'Manual', automaticGearbox: 'Automatic', dctGearbox: 'Dual-clutch', sequentialGearbox: 'Sequential', cvtGearbox: 'CVT' };

export function gearboxSpecs(root: JbeamObject): GearboxSpecs {
  const device = powertrainDevices(root).find((d) => /gearbox$/i.test(d)) ?? '';
  const box = isJbeamObject(root.gearbox) ? root.gearbox : {};
  const ratios = Array.isArray(box.gearRatios) ? box.gearRatios.filter((r): r is number => typeof r === 'number') : [];
  return { kind: GEARBOX_KINDS[device] ?? 'Other', gears: ratios.filter((r) => r > 0).length, ratios };
}
