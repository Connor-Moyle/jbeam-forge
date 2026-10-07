import { principalAxes } from './shapes';

type V3 = readonly [number, number, number];

/** How well a point's mounts must hold it along the way they hold it least (1 = one beam straight along it). */
export const HELD = 0.3;
/** A mount added to hold a point the weak way points at least this much along it. */
const ALONG = 0.45;

const towards = (from: V3, to: V3): [number, number, number] => {
  const d: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** The way beams from `at` to `mounts` hold it least, and how well they hold it that way (0 = not at all). */
export function weakestWay(at: V3, mounts: readonly { pos: V3 }[]): { way: [number, number, number]; hold: number } {
  // The directions of the mounts, each way, as a cloud about the point: its thinnest axis is the way it isn't held.
  const cloud: number[] = [];
  for (const m of mounts) {
    const u = towards(at, m.pos);
    cloud.push(u[0], u[1], u[2], -u[0], -u[1], -u[2]);
  }
  const way = principalAxes(cloud).axes[2]!;
  let hold = 0;
  for (let k = 0; k < cloud.length; k += 6) hold += (cloud[k]! * way[0] + cloud[k + 1]! * way[1] + cloud[k + 2]! * way[2]) ** 2;
  return { way: [way[0], way[1], way[2]], hold };
}

/**
 * What to tie a point to so it is held every way: the nearest `links` of `nearestFirst`, and up to
 * three more that stand out of their plane. Held is judged by angle, not distance: a bonnet catch's
 * nearest body nodes were half a metre off and all in one upright plane with it, so one of them
 * 40 mm out of that plane held nothing, and the catch sat 48 mm from where it belonged.
 */
export function mountsHolding<T extends { pos: V3 }>(at: V3, nearestFirst: readonly T[], links: number, atLeast = 0): T[] {
  const picked = nearestFirst.slice(0, links);
  if (picked.length < 3) return picked;
  const rest = nearestFirst.slice(links);
  for (let round = 0; round < 3 && rest.length; round++) {
    const { way, hold } = weakestWay(at, picked);
    const enough = hold >= HELD;
    if (enough && picked.length >= atLeast) break;
    let best = -1;
    let bestScore = 0;
    rest.forEach((r, i) => {
      const u = towards(at, r.pos);
      const along = Math.abs(u[0] * way[0] + u[1] * way[1] + u[2] * way[2]);
      const far = Math.hypot(r.pos[0] - at[0], r.pos[1] - at[1], r.pos[2] - at[2]);
      const score = along / Math.sqrt(far || 1e-3);
      // One asked for by number alone takes the best there is; one asked for to hold must point the weak way.
      if ((enough || along >= ALONG) && score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best < 0) break;
    picked.push(rest.splice(best, 1)[0]!);
  }
  return picked;
}
