import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('loads every committed fixture', () => {
    const text = readFileSync(join(FIXTURES, 'v1-empty.jbforge'), 'utf8');
    const { project } = parseProject(text);
    expect(project.meta.slug).toBe('fixture_car');
    expect(project.formatVersion).toBe(CURRENT_PROJECT_VERSION);
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
