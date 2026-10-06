import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier, proposeParts } from '../../src/shared/taxonomy/classify';
// @ts-expect-error: a plain .mjs dev script
import { typesBlock } from '../../scripts/dev/blender-addon-types.mjs';

const addon = readFileSync(resolve(__dirname, '../../tools/blender/jbeam_forge_blender.py'), 'utf8');
const classifier = new Classifier(TaxonomyFileSchema.parse(shipped).entries);

describe('the Blender add-on', () => {
  it('knows every part type the app does (run scripts/dev/blender-addon-types.mjs after changing the taxonomy)', () => {
    expect(/# BEGIN TYPES[\s\S]*?# END TYPES/.exec(addon)?.[0]).toBe((typesBlock as (e: unknown) => string)(shipped.entries));
  });

  it('names meshes the way the app reads them: type, position, variant, and pieces of one part', () => {
    const names = ['demo_door_FL', 'demo_door_FL2', 'demo_bumper_F_race', 'demo_headlight_R', 'demo_hood'];
    const { parts } = proposeParts(
      names.map((name) => ({ key: `s:${name}`, name })),
      classifier,
    );
    const door = parts.find((p) => p.taxonomyId === 'door');
    expect(door?.position).toBe('FL');
    expect(door?.meshKeys.sort()).toEqual(['s:demo_door_FL', 's:demo_door_FL2']);
    expect(parts.find((p) => p.taxonomyId === 'headlight')?.position).toBe('R');
    expect(parts.some((p) => p.taxonomyId === 'hood')).toBe(true);
  });
});
