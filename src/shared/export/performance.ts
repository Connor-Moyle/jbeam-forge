/**
 * The figures the game's own performance tests write into a configuration's info file (its
 * dynamicVehicleData extension: what the vehicle selector shows for the game's cars). JBeam Forge's
 * in-game "Measure" runs those tests; the game saves the results in the user folder
 * (vehicles/<car>/info_<config>.json), and the next export folds them into the mod's own files so
 * they go wherever the mod goes.
 */

export const PERFORMANCE_KEYS = [
  'Weight',
  'Power',
  'Torque',
  'PowerPeakRPM',
  'TorquePeakRPM',
  'Weight/Power',
  'Propulsion',
  'Induction Type',
  'Fuel Type',
  'Transmission',
  'Drivetrain',
  'Top Speed',
  '0-100 km/h',
  '0-200 km/h',
  '0-300 km/h',
  '100-200 km/h',
  '0-60 mph',
  '0-100 mph',
  '0-200 mph',
  '60-100 mph',
  '100-0 km/h',
  '60-0 mph',
  'Braking G',
  'Off-Road Score',
] as const;

/** The measured figures in an info file the game wrote (anything else in it is left out). */
export function measuredFigures(info: unknown): Record<string, unknown> {
  if (!info || typeof info !== 'object') return {};
  const src = info as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PERFORMANCE_KEYS) if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  return out;
}

/** A configuration's info file with the measured figures over what export guessed. */
export function withMeasured(infoText: string, figures: Record<string, unknown>): string {
  if (!Object.keys(figures).length) return infoText;
  const info = JSON.parse(infoText) as Record<string, unknown>;
  return `${JSON.stringify({ ...info, ...figures }, null, 2)}\n`;
}
