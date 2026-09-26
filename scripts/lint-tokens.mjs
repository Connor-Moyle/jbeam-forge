#!/usr/bin/env node
/**
 * Design-token enforcement (SPEC §3.8, §4.17): no hardcoded colours, sizes,
 * radii, spacing, durations or easings anywhere in the renderer except
 * src/renderer/ui/tokens.css.
 *
 * Escape hatch: a line containing `token-lint-ignore: <reason>` is skipped.
 * The reason is mandatory.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_FILES = new Set(['src/renderer/ui/tokens.css']);

const CSS_RULES = [
  { id: 'hex-colour', re: /#[0-9a-fA-F]{3,8}\b/g },
  { id: 'colour-function', re: /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/g },
  { id: 'named-colour', re: /:\s*[^;]*\b(?:white|black|red|green|blue|gray|grey|yellow|orange|purple)\b/g },
  { id: 'length', re: /(?<![\w-])-?(?:\d*\.)?\d+(?:px|rem|em|pt|vh|vw|vmin|vmax|ch)\b/g },
  { id: 'duration', re: /(?<![\w-])(?:\d*\.)?\d+m?s\b/g },
  { id: 'easing', re: /cubic-bezier\(|steps\(/g },
  { id: 'font-weight', re: /font-weight\s*:\s*\d/g },
  { id: 'line-height', re: /line-height\s*:\s*[\d.]/g },
  { id: 'z-index', re: /z-index\s*:\s*-?\d{2,}/g },
  { id: 'opacity', re: /(?<![\w-])opacity\s*:\s*0?\.\d/g },
];

const TS_RULES = [
  { id: 'hex-colour', re: /['"`]#[0-9a-fA-F]{3,8}\b/g },
  { id: 'hex-literal-colour', re: /\b0x[0-9a-fA-F]{6}\b/g },
  { id: 'colour-function', re: /['"`][^'"`]*\b(?:rgba?|hsla?)\(/g },
  { id: 'length-string', re: /['"`][^'"`\n]*(?<![\w-])-?(?:\d*\.)?\d+(?:px|rem|em)\b/g },
  { id: 'duration-string', re: /['"`][^'"`\n]*(?<![\w-])(?:\d*\.)?\d+ms\b/g },
  {
    id: 'numeric-style',
    re: /\b(?:width|height|min[A-Z]\w*|max[A-Z]\w*|padding\w*|margin\w*|gap|top|left|right|bottom|inset|fontSize|lineHeight|fontWeight|borderRadius|borderWidth|zIndex|opacity)\s*:\s*-?[1-9]/g,
  },
];

/** Blank out comments while preserving line structure. */
function stripComments(text, isCss) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (!isCss) out = out.replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  return out;
}

/**
 * @param {string} text
 * @param {string} file repo-relative, forward slashes
 * @returns {{ file: string, line: number, rule: string, match: string }[]}
 */
export function findTokenViolations(text, file) {
  if (ALLOWED_FILES.has(file)) return [];
  const isCss = file.endsWith('.css');
  const rules = isCss ? CSS_RULES : TS_RULES;
  const rawLines = text.split(/\r?\n/);
  const lines = stripComments(text, isCss).split(/\r?\n/);
  const found = [];
  lines.forEach((line, i) => {
    if (/token-lint-ignore:\s*[A-Za-z]/.test(rawLines[i] ?? '')) return;
    for (const rule of rules) {
      for (const m of line.matchAll(rule.re)) {
        // Literal zero values ("0", "0px", "0ms") are always fine.
        if (/^-?0+(?:\.0+)?[a-z]*$/i.test(m[0])) continue;
        // Full-viewport extents are layout, not design values.
        if (/^100v[hw]$/.test(m[0])) continue;
        found.push({ file, line: i + 1, rule: rule.id, match: m[0].trim() });
      }
    }
  });
  return found;
}

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(css|tsx?)$/.test(entry) && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

function main() {
  const root = join(fileURLToPath(import.meta.url), '..', '..');
  const files = walk(join(root, 'src', 'renderer'), []);
  const violations = files.flatMap((f) => {
    const rel = relative(root, f).split(sep).join('/');
    return findTokenViolations(readFileSync(f, 'utf8'), rel);
  });
  if (violations.length) {
    for (const v of violations) console.error(`${v.file}:${v.line}  [${v.rule}]  ${v.match}`);
    console.error(`\ntoken-lint: ${violations.length} hardcoded value(s). Use tokens from src/renderer/ui/tokens.css.`);
    process.exit(1);
  }
  console.log(`token-lint: ${files.length} files clean`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
