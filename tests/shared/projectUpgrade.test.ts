import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseProject, serializeProject } from '../../src/shared/project/io';
import { MIGRATIONS } from '../../src/shared/project/migrations';
import { CURRENT_PROJECT_VERSION, ProjectSchema } from '../../src/shared/project/schema';

/**
 * Save files from every older version open in this one, with nothing lost.
 *
 * tests/fixtures/jbforge holds files as each version of the app wrote them
 * (never edited). When the project format changes: bump
 * CURRENT_PROJECT_VERSION, add a migration, add a fixture saved by the
 * version before, and record the new format with UPDATE_FORMAT_LOCK=1.
 */

const FIXTURES = join(__dirname, '..', 'fixtures', 'jbforge');
const LOCK = join(FIXTURES, 'format-lock.json');
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.jbforge'));
const raw = (f: string) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Record<string, unknown> & { formatVersion: number };
const len = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

describe('older save files', () => {
  it('there is an upgrade step from every older format to the next', () => {
    for (let v = 1; v < CURRENT_PROJECT_VERSION; v++) expect(MIGRATIONS.filter((m) => m.from === v), `v${v} → v${v + 1}`).toHaveLength(1);
    expect(MIGRATIONS.some((m) => m.from >= CURRENT_PROJECT_VERSION)).toBe(false);
  });

  it('a file saved by the previous format is kept as a fixture', () => {
    expect(fixtures.some((f) => raw(f).formatVersion === CURRENT_PROJECT_VERSION - 1)).toBe(true);
  });

  it.each(fixtures)('%s opens in this version with its work intact, and saves and opens again unchanged', (file) => {
    const before = raw(file);
    const { project, migratedFrom, applied } = parseProject(readFileSync(join(FIXTURES, file), 'utf8'));
    expect(project.formatVersion).toBe(CURRENT_PROJECT_VERSION);
    expect(migratedFrom).toBe(before.formatVersion === CURRENT_PROJECT_VERSION ? null : before.formatVersion);
    expect(applied).toHaveLength(CURRENT_PROJECT_VERSION - before.formatVersion);
    // The work in it survives the upgrade.
    const p = project as unknown as Record<string, unknown>;
    for (const key of ['sources', 'parts', 'assignments', 'meshNames', 'nodes', 'beams', 'tris', 'materials', 'materialSlots', 'hinges', 'props', 'triggers', 'axles', 'configs'])
      if (key in before) expect(len(p[key]), `${file}: ${key}`).toBe(len(before[key]));
    expect(project.meta.name).toBe((before.meta as { name: string }).name);
    // Saved by this version and opened again: identical.
    const text = serializeProject(project);
    const again = parseProject(text);
    expect(again.migratedFrom).toBeNull();
    expect(serializeProject(again.project)).toBe(text);
  });

  it('the project format only changes with a new format version (and an upgrade step)', () => {
    const shape = JSON.stringify(z.toJSONSchema(ProjectSchema, { unrepresentable: 'any' }));
    const hash = createHash('sha256').update(shape).digest('hex');
    const lock = (existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : {}) as Record<string, string>;
    if (process.env.UPDATE_FORMAT_LOCK) {
      lock[String(CURRENT_PROJECT_VERSION)] = hash;
      writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
    }
    expect(
      lock[String(CURRENT_PROJECT_VERSION)],
      `The project format changed without a new format version. Bump CURRENT_PROJECT_VERSION, add a migration and a fixture, then run the tests once with UPDATE_FORMAT_LOCK=1.`,
    ).toBe(hash);
  });
});
