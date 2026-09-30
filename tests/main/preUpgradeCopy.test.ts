import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepPreUpgradeCopy } from '../../src/main/services/projectFiles';

describe('saving a project opened from an older version', () => {
  it('keeps the file as it was once (name.jbforge.v19.bak), never overwriting that copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jbf-upgrade-'));
    const path = join(dir, 'car.jbforge');
    writeFileSync(path, JSON.stringify({ format: 'jbforge', formatVersion: 19, first: true }));
    await keepPreUpgradeCopy(path, 20);
    expect(JSON.parse(readFileSync(`${path}.v19.bak`, 'utf8')).first).toBe(true);
    // A later save (the file on disk now at v19 again, say by hand) leaves the kept copy alone.
    writeFileSync(path, JSON.stringify({ format: 'jbforge', formatVersion: 19, first: false }));
    await keepPreUpgradeCopy(path, 20);
    expect(JSON.parse(readFileSync(`${path}.v19.bak`, 'utf8')).first).toBe(true);
  });

  it('keeps nothing for a project already at this version, or a new file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jbf-upgrade-'));
    const path = join(dir, 'car.jbforge');
    await keepPreUpgradeCopy(path, 20);
    writeFileSync(path, JSON.stringify({ format: 'jbforge', formatVersion: 20 }));
    await keepPreUpgradeCopy(path, 20);
    expect(existsSync(`${path}.v20.bak`)).toBe(false);
    expect(existsSync(`${path}.v19.bak`)).toBe(false);
  });
});
