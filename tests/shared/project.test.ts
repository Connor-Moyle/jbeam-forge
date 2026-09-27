import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ProjectLoadError,
  createEmptyProject,
  parseProject,
  serializeProject,
} from '../../src/shared/project/io';
import { runMigrations, type Migration } from '../../src/shared/project/migrations';
import { CURRENT_PROJECT_VERSION } from '../../src/shared/project/schema';

const FIXTURES = join(__dirname, '..', 'fixtures', 'jbforge');
const NOW = new Date('2026-01-02T03:04:05.000Z');

function empty() {
  return createEmptyProject({ name: 'Test Car', slug: 'test_car', author: 'Fatkiwi' }, '0.1.0', NOW);
}

function expectLoadError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectLoadError);
    expect((err as ProjectLoadError).code).toBe(code);
    return;
  }
  throw new Error(`expected ProjectLoadError ${code}`);
}

describe('.jbforge io', () => {
  it('serializes an empty project deterministically (snapshot)', () => {
    expect(serializeProject(empty())).toMatchSnapshot();
  });

  it('round-trips serialize → parse → serialize byte-identically', () => {
    const text = serializeProject(empty());
    const { project, migratedFrom, applied } = parseProject(text);
    expect(migratedFrom).toBeNull();
    expect(applied).toEqual([]);
    expect(serializeProject(project)).toBe(text);
  });

  it('serialization key order follows the schema, not insertion order', () => {
    const p = empty();
    const shuffled = Object.fromEntries(Object.entries(p).reverse()) as typeof p;
    expect(serializeProject(shuffled)).toBe(serializeProject(p));
  });

  it('loads every committed fixture at the current version', () => {
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith('.jbforge'))) {
      const { project } = parseProject(readFileSync(join(FIXTURES, file), 'utf8'));
      expect(project.formatVersion, file).toBe(CURRENT_PROJECT_VERSION);
    }
  });

  it('migrates the v2 fixture to v15, adding textureDirs to every source', () => {
    const { project, migratedFrom, applied } = parseProject(readFileSync(join(FIXTURES, 'v2-assigned.jbforge'), 'utf8'));
    expect(migratedFrom).toBe(2);
    expect(applied).toEqual([expect.stringMatching(/^v2→v3: /), expect.stringMatching(/^v3→v4: /), expect.stringMatching(/^v4→v5: /), expect.stringMatching(/^v5→v6: /), expect.stringMatching(/^v6→v7: /), expect.stringMatching(/^v7→v8: /), expect.stringMatching(/^v8→v9: /), expect.stringMatching(/^v9→v10: /), expect.stringMatching(/^v10→v11: /), expect.stringMatching(/^v11→v12: /), expect.stringMatching(/^v12→v13: /), expect.stringMatching(/^v13→v14: /), expect.stringMatching(/^v14→v15: /)]);
    expect(project.sources.map((s) => s.textureDirs)).toEqual([[]]);
  });

  it('migrates v3 to v4: typed prices stay, the old 0 default becomes automatic', () => {
    const v3 = JSON.parse(readFileSync(join(FIXTURES, 'v3-textures.jbforge'), 'utf8')) as { parts: { price: number }[] };
    v3.parts[1]!.price = 0;
    const { project, applied } = parseProject(JSON.stringify(v3));
    expect(applied).toEqual([expect.stringMatching(/^v3→v4: /), expect.stringMatching(/^v4→v5: /), expect.stringMatching(/^v5→v6: /), expect.stringMatching(/^v6→v7: /), expect.stringMatching(/^v7→v8: /), expect.stringMatching(/^v8→v9: /), expect.stringMatching(/^v9→v10: /), expect.stringMatching(/^v10→v11: /), expect.stringMatching(/^v11→v12: /), expect.stringMatching(/^v12→v13: /), expect.stringMatching(/^v13→v14: /), expect.stringMatching(/^v14→v15: /)]);
    expect(project.parts.map((p) => p.price)).toEqual([1000, null]);
  });

  it('migrates the v1 fixture through to v15 with empty Phase 3 sections', () => {
    const { project, migratedFrom, applied } = parseProject(readFileSync(join(FIXTURES, 'v1-empty.jbforge'), 'utf8'));
    expect(migratedFrom).toBe(1);
    expect(applied).toEqual([expect.stringMatching(/^v1→v2: /), expect.stringMatching(/^v2→v3: /), expect.stringMatching(/^v3→v4: /), expect.stringMatching(/^v4→v5: /), expect.stringMatching(/^v5→v6: /), expect.stringMatching(/^v6→v7: /), expect.stringMatching(/^v7→v8: /), expect.stringMatching(/^v8→v9: /), expect.stringMatching(/^v9→v10: /), expect.stringMatching(/^v10→v11: /), expect.stringMatching(/^v11→v12: /), expect.stringMatching(/^v12→v13: /), expect.stringMatching(/^v13→v14: /), expect.stringMatching(/^v14→v15: /)]);
    expect(project.meta.slug).toBe('fixture_car');
    expect(project).toMatchObject({ sources: [], splits: [], parts: [], assignments: {}, ignoredMeshes: [], customTaxonomy: [] });
  });

  it('refuses to migrate a v1 file with unexpected Phase 3 data', () => {
    const v1 = JSON.parse(readFileSync(join(FIXTURES, 'v1-empty.jbforge'), 'utf8')) as Record<string, unknown>;
    expectLoadError(() => parseProject(JSON.stringify({ ...v1, sources: ['mystery'] })), 'MIGRATION_FAILED');
  });

  it('loads the populated v2 fixture with typed sections', () => {
    const { project } = parseProject(readFileSync(join(FIXTURES, 'v2-assigned.jbforge'), 'utf8'));
    expect(project.sources[0]!.import).toEqual({ scale: 1, upAxis: '+z', forwardAxis: '-y' });
    expect(project.parts.map((p) => p.taxonomyId)).toEqual(['main_body', 'hood']);
    expect(project.assignments['split:split_1']).toBe('part_hood');
  });

  it('rejects invalid v2 content (bad axis, negative price)', () => {
    const v2 = JSON.parse(readFileSync(join(FIXTURES, 'v2-assigned.jbforge'), 'utf8')) as { sources: { import: { upAxis: string } }[]; parts: { price: number }[] };
    v2.sources[0]!.import.upAxis = 'up';
    expectLoadError(() => parseProject(JSON.stringify(v2)), 'INVALID_SCHEMA');
    v2.sources[0]!.import.upAxis = '+z';
    v2.parts[0]!.price = -1;
    expectLoadError(() => parseProject(JSON.stringify(v2)), 'INVALID_SCHEMA');
  });

  it('rejects invalid JSON', () => {
    expectLoadError(() => parseProject('{ nope'), 'INVALID_JSON');
  });

  it('rejects non-objects and foreign JSON', () => {
    expectLoadError(() => parseProject('[]'), 'NOT_A_PROJECT');
    expectLoadError(() => parseProject('{"name":"x"}'), 'NOT_A_PROJECT');
    expectLoadError(() => parseProject('{"format":"jbforge","formatVersion":"1"}'), 'NOT_A_PROJECT');
  });

  it('rejects projects from a newer app version', () => {
    const doc = { ...empty(), formatVersion: CURRENT_PROJECT_VERSION + 1 };
    expectLoadError(() => parseProject(JSON.stringify(doc)), 'FUTURE_VERSION');
  });

  it('rejects schema violations with a path', () => {
    const doc = { ...empty(), meta: { ...empty().meta, slug: 'Bad Slug' } };
    try {
      parseProject(JSON.stringify(doc));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ProjectLoadError).code).toBe('INVALID_SCHEMA');
      expect((err as Error).message).toContain('meta.slug');
    }
  });

  it('rejects a missing required section', () => {
    const { nodes: _nodes, ...rest } = empty();
    expectLoadError(() => parseProject(JSON.stringify(rest)), 'INVALID_SCHEMA');
  });
});

describe('.jbforge migrations', () => {
  // A fake v0 → v1 → v2 chain exercising the framework independently of the real registry.
  const registry: Migration[] = [
    { from: 0, describe: 'rename title → name', migrate: ({ title, ...d }) => ({ ...d, name: title, formatVersion: 1 }) },
    { from: 1, describe: 'add tags', migrate: (d) => ({ ...d, tags: [], formatVersion: 2 }) },
  ];
  const V2 = z.object({ format: z.literal('jbforge'), formatVersion: z.literal(2), name: z.string(), tags: z.array(z.string()) });

  it('applies every step in order', () => {
    const text = JSON.stringify({ format: 'jbforge', formatVersion: 0, title: 'Old' });
    const res = parseProject(text, { migrations: registry, currentVersion: 2, schema: V2 });
    expect(res.project).toEqual({ format: 'jbforge', formatVersion: 2, name: 'Old', tags: [] });
    expect(res.migratedFrom).toBe(0);
    expect(res.applied).toHaveLength(2);
  });

  it('starts from the version on disk', () => {
    const text = JSON.stringify({ format: 'jbforge', formatVersion: 1, name: 'Mid' });
    const res = parseProject(text, { migrations: registry, currentVersion: 2, schema: V2 });
    expect(res.applied).toEqual(['v1→v2: add tags']);
  });

  it('does not mutate the input document', () => {
    const doc = { format: 'jbforge', formatVersion: 0, title: 'Old' };
    const copy = structuredClone(doc);
    runMigrations(doc, 0, 2, registry);
    expect(doc).toEqual(copy);
  });

  it('fails clearly when a step is missing', () => {
    const text = JSON.stringify({ format: 'jbforge', formatVersion: 0, title: 'x' });
    expectLoadError(
      () => parseProject(text, { migrations: [registry[1]!], currentVersion: 2, schema: V2 }),
      'MIGRATION_MISSING',
    );
  });

  it('fails clearly when a step throws or forgets to bump formatVersion', () => {
    const text = JSON.stringify({ format: 'jbforge', formatVersion: 1, name: 'x' });
    const throwing: Migration[] = [{ from: 1, describe: 'boom', migrate: () => { throw new Error('boom'); } }];
    expectLoadError(() => parseProject(text, { migrations: throwing, currentVersion: 2, schema: V2 }), 'MIGRATION_FAILED');
    const lazy: Migration[] = [{ from: 1, describe: 'noop', migrate: (d) => ({ ...d }) }];
    expectLoadError(() => parseProject(text, { migrations: lazy, currentVersion: 2, schema: V2 }), 'MIGRATION_FAILED');
  });
});
