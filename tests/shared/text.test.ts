import { describe, expect, it } from 'vitest';
import { relativeTime, slugify } from '../../src/shared/text';
import { SLUG_PATTERN } from '../../src/shared/project/schema';

describe('slugify', () => {
  it.each([
    ['Hirochi Sunburst', 'hirochi_sunburst'],
    ['  My Car -- GT (2026)!  ', 'my_car_gt_2026'],
    ['Crème Brûlée 2', 'creme_brulee_2'],
    ['___', ''],
    ['ALLCAPS', 'allcaps'],
  ])('%s → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('always produces something SLUG_PATTERN accepts (or empty)', () => {
    for (const name of ['a b', 'x--y', '1st', 'über-car', 'test']) {
      const s = slugify(name);
      expect(s === '' || SLUG_PATTERN.test(s)).toBe(true);
    }
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  it.each([
    ['2026-09-26T11:59:40Z', 'just now'],
    ['2026-09-26T11:55:00Z', '5 minutes ago'],
    ['2026-09-26T09:00:00Z', '3 hours ago'],
    ['2026-09-25T12:00:00Z', 'yesterday'],
    ['2026-09-12T12:00:00Z', '2 weeks ago'],
    ['2025-09-26T12:00:00Z', 'last year'],
    ['not a date', ''],
  ])('%s → %s', (iso, text) => {
    expect(relativeTime(iso, now)).toBe(text);
  });
});
