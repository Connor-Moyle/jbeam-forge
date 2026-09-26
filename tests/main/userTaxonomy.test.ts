import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UserTaxonomyService, serializeUserTaxonomy } from '../../src/main/services/userTaxonomy';
import type { TaxonomyEntry } from '../../src/shared/taxonomy/schema';
import type { Logger } from '../../src/shared/logger';

const silent: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

const custom: TaxonomyEntry = {
  id: 'ducktail',
  label: 'Ducktail',
  category: 'Aero',
  subcategory: 'Wings',
  positionAxis: 'none',
  slotType: 'ducktail',
  parent: 'trunk',
  defaultMass: 2,
  nodePrefix: 'dkt',
  beamPreset: 'panel_plastic',
  openable: false,
  nameHints: ['duck tail'],
};

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-tax-'));
  file = join(dir, 'user-taxonomy.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('UserTaxonomyService', () => {
  it('starts empty and round-trips saved entries', async () => {
    const svc = new UserTaxonomyService(file, silent);
    expect(await svc.load()).toEqual([]);
    await svc.save([custom]);
    expect(await readFile(file, 'utf8')).toBe(serializeUserTaxonomy([custom]));
    expect(await new UserTaxonomyService(file, silent).load()).toEqual([custom]);
  });

  it('serializes deterministically (snapshot)', () => {
    expect(serializeUserTaxonomy([custom])).toMatchSnapshot();
  });

  it('rejects entries that would break the merged taxonomy and writes nothing', async () => {
    const svc = new UserTaxonomyService(file, silent);
    await expect(svc.save([{ ...custom, parent: 'ghost' }])).rejects.toThrow(/parent "ghost" does not exist/);
    await expect(svc.save([{ ...custom, nodePrefix: 'hl' }])).rejects.toThrow(/nodePrefix "hl" already used/);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
    expect(svc.get()).toEqual([]);
  });

  it('backs up an invalid file instead of loading it', async () => {
    await writeFile(file, '{ "version": 1, "entries": [ { "id": 1 } ] }');
    expect(await new UserTaxonomyService(file, silent).load()).toEqual([]);
    expect((await readdir(dir)).some((f) => f.startsWith('user-taxonomy.json.invalid-'))).toBe(true);
  });
});
