/**
 * Display units (Settings → Units). The game's files are always metric;
 * these only change what the builders show.
 */

export type SpeedUnit = 'kmh' | 'mph';
export type PowerUnit = 'kw' | 'hp' | 'ps';
export type TorqueUnit = 'nm' | 'lbft';

const KW_TO = { kw: 1, hp: 1.341022, ps: 1.359622 } as const;
const NM_TO = { nm: 1, lbft: 0.737562 } as const;
const KMH_TO = { kmh: 1, mph: 0.621371 } as const;

export const powerIn = (kw: number, u: PowerUnit) => kw * KW_TO[u];
export const torqueIn = (nm: number, u: TorqueUnit) => nm * NM_TO[u];
export const speedIn = (kmh: number, u: SpeedUnit) => kmh * KMH_TO[u];
/** Back to the game's units: a typed figure in kW and Nm. */
export const powerFrom = (v: number, u: PowerUnit) => v / KW_TO[u];
export const torqueFrom = (v: number, u: TorqueUnit) => v / NM_TO[u];

export const POWER_LABEL: Record<PowerUnit, string> = { kw: 'kW', hp: 'hp', ps: 'PS' };
export const TORQUE_LABEL: Record<TorqueUnit, string> = { nm: 'Nm', lbft: 'lb·ft' };
export const SPEED_LABEL: Record<SpeedUnit, string> = { kmh: 'km/h', mph: 'mph' };

export interface Units {
  power: PowerUnit;
  torque: TorqueUnit;
  speed: SpeedUnit;
}

/** "250 hp", "350 lb·ft", "180 mph". */
export function formatUnits(u: Units) {
  return {
    power: (kw: number) => `${Math.round(powerIn(kw, u.power))} ${POWER_LABEL[u.power]}`,
    torque: (nm: number) => `${Math.round(torqueIn(nm, u.torque))} ${TORQUE_LABEL[u.torque]}`,
    speed: (kmh: number) => `${Math.round(speedIn(kmh, u.speed))} ${SPEED_LABEL[u.speed]}`,
    powerValue: (kw: number) => Math.round(powerIn(kw, u.power)),
    torqueValue: (nm: number) => Math.round(torqueIn(nm, u.torque)),
    powerLabel: POWER_LABEL[u.power],
    torqueLabel: TORQUE_LABEL[u.torque],
    powerFrom: (v: number) => powerFrom(v, u.power),
    torqueFrom: (v: number) => torqueFrom(v, u.torque),
  };
}
