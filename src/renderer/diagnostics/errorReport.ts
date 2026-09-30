import { recentRendererErrors } from './globalHandlers';

/**
 * A short error report someone can paste into a message: what broke, where,
 * the few functions that led to it, and the last problems before it. Stack
 * frames lose their long file URLs; nothing is longer than a line.
 */

const MAX_FRAMES = 8;
const MAX_COMPONENTS = 6;
const MAX_LINE = 240;

const clip = (s: string, n = MAX_LINE) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "at compactGeometry (file:///C:/…/assets/index-BA39.js:1234:56)" → "compactGeometry (index-BA39.js:1234)". */
export function stackFrames(stack: string | undefined, max = MAX_FRAMES): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    const m = /^at (?:async )?(.*?) ?\(?([^()\s]+?):(\d+):\d+\)?$/.exec(line);
    if (!m) {
      out.push(clip(line.slice(3), 120));
    } else {
      const fn = m[1] || '(anonymous)';
      const file = m[2]!.split(/[\\/]/).pop()!.replace(/\?.*$/, '');
      if (/^(react-dom|chunk-|scheduler)/.test(file) && out.length) continue; // React's own frames say nothing
      out.push(`${fn} (${file}:${m[3]})`);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** The innermost React components ("in MaterialsPanel", …) as one line. */
export function componentPath(componentStack: string | null | undefined, max = MAX_COMPONENTS): string {
  if (!componentStack) return '';
  const names = componentStack
    .split('\n')
    .map((l) => /^\s*(?:at|in) ([A-Za-z0-9_$.]+)/.exec(l)?.[1])
    .filter((n): n is string => !!n && /^[A-Z]/.test(n));
  return names.slice(0, max).join(' < ');
}

export interface ErrorReportInput {
  where: string;
  error: unknown;
  componentStack?: string | null;
}

export function errorReport({ where, error, componentStack }: ErrorReportInput): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const lines = [`Where: ${where}`, `Error: ${clip(e.message || String(e))}`];
  const frames = stackFrames(e.stack);
  if (frames.length) lines.push('At:', ...frames.map((f) => `  ${f}`));
  const comps = componentPath(componentStack);
  if (comps) lines.push(`In: ${comps}`);
  const earlier = recentRendererErrors()
    .slice(-5)
    .map((l) => `  ${clip(l.split('\n')[0]!, 200)}`);
  if (earlier.length) lines.push('Recent problems:', ...earlier);
  return lines.join('\n');
}
