import type { PositionAxis } from './schema';

/**
 * What a position string means on its axis ("R" is rear on fr, right on lr),
 * and whether a child position fits under a parent's.
 */
export interface Placement {
  fore: string | null;
  side: string | null;
}

export function placement(axis: PositionAxis | undefined, position: string | null): Placement {
  if (!position || !axis || axis === 'none') return { fore: null, side: null };
  if (axis === 'fr') return { fore: position, side: null };
  if (axis === 'lr') return { fore: null, side: position };
  return { fore: position[0] ?? null, side: position[1] ?? null };
}

/** 0 = contradicts; higher = more dimensions agree. A position-less parent fits anything. */
export function positionCompat(child: Placement, parent: Placement): number {
  if (parent.fore && child.fore && parent.fore !== child.fore) return 0;
  if (parent.side && child.side && parent.side !== child.side) return 0;
  const front = !child.fore && parent.fore === 'F' ? 0.1 : 0; // mirrors, fog lights: front unless told otherwise
  return 1 + front + (parent.fore && parent.fore === child.fore ? 1 : 0) + (parent.side && parent.side === child.side ? 1 : 0);
}
