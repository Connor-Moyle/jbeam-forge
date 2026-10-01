import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KEYMAP } from '@shared/keymap';
import { DEFAULT_SETTINGS } from '@shared/settings-schema';

/** Every keybind is handled somewhere, and every setting does something outside the Settings window. */
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
};
walk(join(__dirname, '..', '..', 'src'));
const source = (skip: RegExp) =>
  files
    .filter((f) => !skip.test(f.replace(/\\/g, '/')))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

describe('wiring', () => {
  it('every keybind in the keymap has a handler', () => {
    const code = source(/shared\/keymap\.ts$/);
    const missing = KEYMAP.filter((k) => !new RegExp(`['"\`]${k.id}['"\`]`).test(code)).map((k) => k.id);
    expect(missing).toEqual([]);
  });

  it('every setting is used outside the Settings window', () => {
    const code = source(/settings-schema\.ts$|SettingsModal\.tsx$/);
    const unused = Object.keys(DEFAULT_SETTINGS).filter((k) => !new RegExp(`\\b${k}\\b`).test(code));
    expect(unused).toEqual([]);
  });

  it('no placeholder buttons (empty handlers, “coming soon”)', () => {
    const code = source(/\.test\./);
    expect(code.match(/onClick=\{\(\) => \{\s*\}\}/g) ?? []).toEqual([]);
    expect(code.match(/coming soon|not implemented yet/gi) ?? []).toEqual([]);
  });
});
