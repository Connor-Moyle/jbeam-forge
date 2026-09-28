/** The rev preview's maths: which recorded samples play at an rpm, and a four-stroke's firing frequency. */

/** Weights of the two samples around `rpm` (by rpm), others 0: [index, weight][]. */
export function blendWeights(rpms: readonly number[], rpm: number): [number, number][] {
  if (!rpms.length) return [];
  const order = rpms.map((r, i) => [r, i] as const).sort((a, b) => a[0] - b[0]);
  if (rpm <= order[0]![0]) return [[order[0]![1], 1]];
  const last = order[order.length - 1]!;
  if (rpm >= last[0]) return [[last[1], 1]];
  for (let k = 0; k + 1 < order.length; k++) {
    const [a, ia] = order[k]!;
    const [b, ib] = order[k + 1]!;
    if (rpm >= a && rpm <= b) {
      const t = b > a ? (rpm - a) / (b - a) : 0;
      // Equal-power crossfade.
      return [
        [ia, Math.cos((t * Math.PI) / 2)],
        [ib, Math.sin((t * Math.PI) / 2)],
      ];
    }
  }
  return [];
}

/** Firing frequency (Hz) of a four-stroke engine. */
export const firingHz = (rpm: number, cylinders: number) => (rpm / 60) * (cylinders / 2);
