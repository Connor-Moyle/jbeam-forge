/**
 * Typed access to design tokens from TS. CSS remains the source of truth
 * (tokens.css); use `cssVar()` for inline styles and `resolveToken()` where a
 * concrete value is needed (three.js materials, canvas drawing).
 */
export type ColorToken =
  | 'bg-0'
  | 'bg-1'
  | 'bg-2'
  | 'bg-3'
  | 'bg-4'
  | 'border-0'
  | 'border-1'
  | 'border-2'
  | 'text-0'
  | 'text-1'
  | 'text-2'
  | 'accent'
  | 'accent-hover'
  | 'success'
  | 'warning'
  | 'danger'
  | 'grid-major'
  | 'grid-minor'
  | 'mesh-default'
  | 'viewport-sky'
  | 'viewport-ground'
  | 'viewport-key'
  | 'viewport-bg-black'
  | 'viewport-bg-grey'
  | 'viewport-bg-light'
  | 'preview-studio-top'
  | 'preview-studio-bottom'
  | 'preview-light'
  | 'preview-dark'
  | 'preview-checker-a'
  | 'preview-checker-b'
  | 'preview-sky-top'
  | 'preview-sky-bottom'
  | 'cat-body'
  | 'cat-panel'
  | 'cat-mechanical'
  | 'cat-glass'
  | 'cat-interior'
  | 'cat-light'
  | 'cat-misc';

export type SpaceToken = 'space-0' | 'space-half' | `space-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type SizeToken = 'size-tree-indent' | 'size-icon' | 'size-icon-sm' | 'size-icon-lg' | 'size-control';
export type Token = ColorToken | SpaceToken | SizeToken;

export function cssVar(name: Token): string {
  return `var(--${name})`;
}

const cache = new Map<string, string>();

/** Forget cached values (the theme changed). */
export function clearTokenCache(): void {
  cache.clear();
}

/** Read a token's computed value from :root. Cached until the theme changes (clearTokenCache). */
export function resolveToken(name: Token | NumericToken): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  if (value) cache.set(name, value);
  return value;
}

export type NumericToken = 'space-1' | 'space-2' | 'size-side-panel' | 'size-side-panel-wide' | 'size-icon' | 'size-icon-sm' | 'size-icon-lg' | 'size-control' | 'delay-tooltip' | 'dur-fast' | 'dur-base' | 'dur-slow';

/**
 * A token's numeric value (px or ms) for APIs that need numbers, e.g.
 * lucide's `size` or Radix's `delayDuration`. Falls back to a neutral value
 * when no stylesheet is present (jsdom tests).
 */
export function numericToken(name: NumericToken): number {
  const n = Number.parseFloat(resolveToken(name));
  return Number.isFinite(n) ? n : NO_STYLESHEET_FALLBACK[name];
}

export function iconSize(name: 'size-icon' | 'size-icon-sm' | 'size-icon-lg' = 'size-icon'): number {
  return numericToken(name);
}

const NO_STYLESHEET_FALLBACK: Record<NumericToken, number> = {
  'space-1': 4,
  'space-2': 8,
  'size-side-panel': 280,
  'size-side-panel-wide': 340,
  'size-icon': 16,
  'size-icon-sm': 14,
  'size-icon-lg': 28,
  'size-control': 28,
  'delay-tooltip': 0,
  'dur-fast': 0,
  'dur-base': 0,
  'dur-slow': 0,
};
