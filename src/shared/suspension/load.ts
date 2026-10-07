/**
 * A suspension's springs are sized for the car it came from. Under a car much heavier it sits low,
 * rests on its bump stops and rubs the arches; under one much lighter it sits high and rides hard.
 * In testing the Covet's suspension (a 1,000 kg car) under a 1,400 kg body sat on the ground and
 * broke an arm and a wing at spawn.
 */
export const OVERLOADED = 1.25;
export const UNDERLOADED = 0.6;

export interface LoadCheck {
  /** This car's weight over the weight of the car the suspension came from. */
  ratio: number;
  state: 'over' | 'under' | 'fine';
}

export function suspensionLoad(carKg: number | null | undefined, donorKg: number | null | undefined): LoadCheck | null {
  if (!carKg || !donorKg || carKg <= 0 || donorKg <= 0) return null;
  const ratio = carKg / donorKg;
  return { ratio, state: ratio >= OVERLOADED ? 'over' : ratio <= UNDERLOADED ? 'under' : 'fine' };
}

/** What to tell the modder, or null when the weights suit each other (or aren't known). */
export function suspensionLoadWarning(set: { name: string; vehicleName: string; vehicleWeight?: number }, axle: string, carKg: number | null | undefined): string | null {
  const check = suspensionLoad(carKg, set.vehicleWeight);
  if (!check || check.state === 'fine') return null;
  const kg = (n: number) => `${Math.round(n / 10) * 10} kg`;
  const from = `${set.name} on the ${axle} axle was made for the ${set.vehicleName}, about ${kg(set.vehicleWeight!)}. This car is about ${kg(carKg!)}`;
  if (check.state === 'over')
    return `${from}, ${Math.round((check.ratio - 1) * 100)}% more: it will sit low and can rest on its bump stops or rub the arches. Choose stiffer or taller springs in the suspension's options and tuning, fit a suspension from a heavier car, or lighten the car.`;
  return `${from}, ${Math.round((1 - check.ratio) * 100)}% less: it will sit high and ride hard. Choose softer springs in the suspension's options and tuning, or fit a suspension from a lighter car.`;
}
