import { describe, expect, it } from 'vitest';
import shipped from '../../src/shared/taxonomy/taxonomy.json';
import fixture from '../fixtures/classify/sunburst2-expected.json';
import { TaxonomyFileSchema } from '../../src/shared/taxonomy/schema';
import { Classifier, proposeParts, resolvePosition } from '../../src/shared/taxonomy/classify';
import { commonPrefix, editDistance, rawTokens, segment, tokenize } from '../../src/shared/taxonomy/tokenize';

const classifier = new Classifier(TaxonomyFileSchema.parse(shipped).entries);
const tok = (name: string, prefix: string | null = null) => tokenize(name, classifier.vocab, classifier.fuzzyVocab, prefix);

describe('rawTokens', () => {
  it('splits separators, camelCase and free-standing numbers', () => {
    expect(rawTokens('Driveline_Axel_Boot_Inner_Rear')).toEqual(['driveline', 'axel', 'boot', 'inner', 'rear']);
    expect(rawTokens('doorGlass-FL.001')).toEqual(['door', 'glass', 'fl']); // Blender duplicate suffix dropped
    expect(rawTokens('lettering_18')).toEqual(['lettering', '18']);
  });

  it('drops piece numbers glued to a word', () => {
    expect(rawTokens('engine_pulley3')).toEqual(['engine', 'pulley']);
    expect(rawTokens('lowerarm_R2')).toEqual(['lowerarm', 'r']);
  });
});

describe('editDistance / segment', () => {
  it('counts transpositions as one edit', () => {
    expect(editDistance('flare', 'falre')).toBe(1);
    expect(editDistance('flare', 'flair')).toBe(2);
  });

  it('splits compounds into known words, allowing one typo in long segments', () => {
    const vocab = new Set(['lower', 'arm', 'door', 'glass', 'flare']);
    expect(segment('lowerarm', vocab, ['lower', 'glass', 'flare'])).toEqual(['lower', 'arm']);
    expect(segment('doorfalre', vocab, ['lower', 'glass', 'flare'])).toEqual(['door', 'flare']);
    expect(segment('xyzzy', vocab, [])).toBeNull();
  });
});

describe('tokenize', () => {
  it('strips the vehicle prefix and separates positions, variants and part words', () => {
    const t = tok('sunburst2_doorpanel_raceing_FR', 'sunburst2');
    expect(t.words).toEqual(['door', 'card']);
    expect(t.corner).toBe('FR');
    expect(t.variant).toEqual(['racing']);
    expect(t.unknown).toEqual([]);
  });

  it('keeps a bare "r" ambiguous and reads spelled-out positions', () => {
    expect(tok('bumper_R')).toMatchObject({ ambiguousR: true, fore: null, side: null });
    expect(tok('Driveline_Axel_Boot_Inner_Rear')).toMatchObject({ fore: 'R', words: expect.arrayContaining(['axle']) as unknown });
    expect(tok('mirror_left')).toMatchObject({ side: 'L' });
  });

  it('expands misspellings found in compounds', () => {
    expect(tok('transmission_mountbraket').words).toEqual(['transmission', 'mount']);
    expect(tok('fenderfalre_b_L').words).toEqual(['fender', 'flare']);
  });

  it('finds the shared prefix only with a clear majority', () => {
    expect(commonPrefix(['car_a', 'car_b', 'car_c', 'x_d'])).toBe('car');
    expect(commonPrefix(['a_x', 'b_x', 'c_x'])).toBeNull();
  });
});

describe('resolvePosition', () => {
  const t = (name: string) => tok(name);
  it('resolves "R" by axis: rear on fr, right on lr', () => {
    expect(resolvePosition('fr', t('bumper_R'))).toBe('R');
    expect(resolvePosition('lr', t('headlight_R'))).toBe('R');
    expect(resolvePosition('fr', t('bumper_F'))).toBe('F');
  });

  it('combines fore and side for corners, including an ambiguous R', () => {
    expect(resolvePosition('corner', t('door_FL'))).toBe('FL');
    expect(resolvePosition('corner', t('flare_rear_left'))).toBe('RL');
    expect(resolvePosition('corner', t('bumper_R_flare_L'))).toBe('RL');
    expect(resolvePosition('corner', t('hub_R'))).toBeNull(); // both rear hubs in one mesh
  });

  it('projects corners onto single axes', () => {
    expect(resolvePosition('lr', t('tierod_FL'))).toBe('L');
    expect(resolvePosition('fr', t('halfshaft_RR'))).toBe('R');
    expect(resolvePosition('none', t('hood_F'))).toBeNull();
  });
});

describe('Classifier', () => {
  it('classifies real-world names from SPEC §4.3', () => {
    expect(classifier.classify('Driveline_Axel_Boot_Inner_Rear')).toMatchObject({ taxonomyId: 'halfshaft', tokens: { fore: 'R' } }); // the CV boot sits on the halfshaft
    expect(classifier.classify('door_FL').taxonomyId).toBe('door');
  });

  it('prefers the head noun and counts ancestor context as explained', () => {
    const c = classifier.classify('bumper_custom_splitter_F');
    expect(c.taxonomyId).toBe('splitter');
    expect(c.confidence).toBe(1);
  });

  it('leaves names it cannot explain unassigned', () => {
    expect(classifier.classify('qwerty_zxcv').taxonomyId).toBeNull();
    expect(classifier.classify('').taxonomyId).toBeNull();
  });

  it('agrees with ≥ 95% of the hand-labelled Sunburst names (kind + position)', () => {
    const rows = fixture.expected as [string, string, string | null][];
    const agree = rows.filter(([name, id, pos]) => {
      const c = classifier.classify(name, fixture.prefix);
      return c.taxonomyId === id && c.position === pos;
    }).length;
    expect(agree / rows.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe('proposeParts', () => {
  const names = ['car_door_FL', 'car_door_FR', 'car_doorglass_FL', 'car_doorglass_FR', 'car_door_sheet_FL', 'car_body_main', 'car_bumper_F', 'car_bumper_R', 'car_bumper_race_F', 'car_foglight_L', 'car_qwerty'];
  const proposal = proposeParts(
    names.map((n) => ({ key: n, name: n })),
    classifier,
  );
  const partOf = (name: string) => proposal.parts.find((p) => p.id === proposal.assignments[name]);

  it('groups meshes of the same kind + position + variant into one part', () => {
    expect(partOf('car_door_FL')).toBe(partOf('car_door_sheet_FL'));
    expect(partOf('car_door_FL')).not.toBe(partOf('car_door_FR'));
    expect(proposal.unassigned).toEqual(['car_qwerty']);
  });

  it('links variants to the unsuffixed base part', () => {
    expect(partOf('car_bumper_race_F')?.variantOf).toBe(partOf('car_bumper_F')?.id);
    expect(partOf('car_bumper_F')?.variantOf).toBeNull();
  });

  it('resolves parents by taxonomy and position, reading "R" per axis', () => {
    expect(partOf('car_doorglass_FR')?.parentPartId).toBe(partOf('car_door_FR')?.id);
    expect(partOf('car_door_FL')?.parentPartId).toBe(partOf('car_body_main')?.id);
    // foglight_L (side) must not attach to bumper_R because "R" there is rear, not right: front wins the tie
    expect(partOf('car_foglight_L')?.parentPartId).toBe(partOf('car_bumper_F')?.id);
  });
});
