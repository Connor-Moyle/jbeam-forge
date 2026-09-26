/**
 * Stable fallback values for Zustand selectors and props (SPEC §3.5).
 *
 * A selector like `(s) => s.items[id] ?? []` allocates a fresh array on every
 * snapshot, which makes useSyncExternalStore see a "change" each render and
 * loop forever. Always fall back to these module-level constants instead.
 */
export const EMPTY_ARR: readonly never[] = Object.freeze([]);
export const EMPTY_OBJ: Readonly<Record<string, never>> = Object.freeze({});

export function emptyArr<T>(): readonly T[] {
  return EMPTY_ARR;
}
