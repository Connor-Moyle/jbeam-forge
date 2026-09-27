import type { StructNode } from '../project/schema';

/**
 * Mass and balance of the generated structure: centre of gravity and how the
 * weight splits front/rear and left/right. Until suspension exists (Phase 10)
 * there are no axles, so front/rear is measured about the middle of the
 * structure's length; once axles exist this becomes the real axle split.
 */
export interface Balance {
  massKg: number;
  /** BeamNG space: +X left, +Y rear, +Z up. */
  cog: [number, number, number];
  /** Share of mass ahead of the reference point, 0–1. */
  front: number;
  /** Share of mass on the left (+X), 0–1. */
  left: number;
  /** The Y the front/rear split is measured about. */
  splitY: number;
}

export function massBalance(nodes: readonly Pick<StructNode, 'pos' | 'weight'>[], splitY?: number): Balance | null {
  let mass = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const c: [number, number, number] = [0, 0, 0];
  for (const n of nodes) {
    mass += n.weight;
    for (let i = 0; i < 3; i++) c[i]! += n.pos[i]! * n.weight;
    minY = Math.min(minY, n.pos[1]);
    maxY = Math.max(maxY, n.pos[1]);
  }
  if (mass <= 0) return null;
  const y0 = splitY ?? (minY + maxY) / 2;
  let front = 0;
  let left = 0;
  for (const n of nodes) {
    if (n.pos[1] < y0) front += n.weight; // BeamNG's front is −Y
    else if (n.pos[1] === y0) front += n.weight / 2;
    if (n.pos[0] > 0) left += n.weight;
    else if (n.pos[0] === 0) left += n.weight / 2;
  }
  return { massKg: mass, cog: [c[0] / mass, c[1] / mass, c[2] / mass], front: front / mass, left: left / mass, splitY: y0 };
}
