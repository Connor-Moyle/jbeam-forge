import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error -- plain .mjs script without type declarations
import { findTokenViolations } from '../../scripts/lint-tokens.mjs';
import { WINDOW_BACKGROUND } from '../../src/shared/window-chrome';

type Violation = { rule: string; match: string; line: number };
const lint = (text: string, file: string) => (findTokenViolations as (t: string, f: string) => Violation[])(text, file);
const rules = (text: string, file = 'src/renderer/x.module.css') => lint(text, file).map((v) => v.rule);

describe('token lint — CSS', () => {
  it('passes token-only CSS', () => {
    expect(rules('.a { padding: var(--space-2); color: var(--text-0); border: var(--border-width) solid var(--border-1); }')).toEqual([]);
  });

  it('allows literal zero and percentages', () => {
    expect(rules('.a { margin: 0; inset: 0px; width: 100%; transition-delay: 0ms; }')).toEqual([]);
    expect(rules('.a { max-width: calc(100vw - var(--space-8)); height: 100vh; }')).toEqual([]);
    expect(rules('.a { height: 50vh; }')).toEqual(['length']);
  });

  it.each([
    ['.a { color: #fff; }', 'hex-colour'],
    ['.a { background: rgba(0,0,0,.5); }', 'colour-function'],
    ['.a { color: white; }', 'named-colour'],
    ['.a { padding: 6px; }', 'length'],
    ['.a { font-size: 0.8rem; }', 'length'],
    ['.a { transition: opacity 150ms; }', 'duration'],
    ['.a { transition-timing-function: cubic-bezier(0,0,1,1); }', 'easing'],
    ['.a { font-weight: 600; }', 'font-weight'],
    ['.a { line-height: 1.4; }', 'line-height'],
    ['.a { z-index: 999; }', 'z-index'],
    ['.a { opacity: 0.5; }', 'opacity'],
  ])('flags %s', (css, rule) => {
    expect(rules(css)).toContain(rule);
  });

  it('ignores comments', () => {
    expect(rules('/* was #fff and 12px */ .a { color: var(--text-0); }')).toEqual([]);
  });

  it('honours token-lint-ignore only with a reason', () => {
    expect(rules('.a { width: 3px; } /* token-lint-ignore: hairline */')).toEqual([]);
    expect(rules('.a { width: 3px; } /* token-lint-ignore: */')).toEqual(['length']);
  });

  it('exempts tokens.css', () => {
    expect(lint('--x: #fff;', 'src/renderer/ui/tokens.css')).toEqual([]);
  });
});

describe('token lint — TS/TSX', () => {
  const ts = (text: string) => rules(text, 'src/renderer/x.tsx');

  it.each([
    ["const c = '#4f8ef7';", 'hex-colour'],
    ['new Color(0x4f8ef7);', 'hex-literal-colour'],
    ["style={{ padding: '6px' }}", 'length-string'],
    ["const d = '120ms';", 'duration-string'],
    ['style={{ paddingLeft: 14 }}', 'numeric-style'],
    ["const b = 'rgba(0,0,0,0.3)';", 'colour-function'],
  ])('flags %s', (src, rule) => {
    expect(ts(src)).toContain(rule);
  });

  it('allows token references and zero', () => {
    expect(ts('style={{ paddingLeft: `calc(var(--size-tree-indent) * ${depth})`, margin: 0 }}')).toEqual([]);
  });
});

describe('native window colour', () => {
  it('matches --bg-0 in tokens.css', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/ui/tokens.css'), 'utf8');
    const bg0 = css.match(/--bg-0:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(bg0?.toLowerCase()).toBe(WINDOW_BACKGROUND.toLowerCase());
  });
});
