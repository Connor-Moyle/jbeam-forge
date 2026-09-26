import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../../src/shared/fuzzy';

describe('fuzzy', () => {
  it('ranks exact > prefix > word prefix > substring > subsequence', () => {
    const s = (q: string, t: string) => fuzzyScore(q, t);
    expect(s('door', 'door')).toBeGreaterThan(s('door', 'door glass'));
    expect(s('door', 'door glass')).toBeGreaterThan(s('glass', 'door glass'));
    expect(s('glass', 'door glass')).toBeGreaterThan(s('lass', 'door glass'));
    expect(s('lass', 'door glass')).toBeGreaterThan(s('dgl', 'door glass'));
    expect(s('dgl', 'door glass')).toBeGreaterThan(0);
    expect(s('xyz', 'door glass')).toBe(0);
  });

  it('requires every term to match and keeps order stable on ties', () => {
    const items = ['Door', 'Door glass', 'Rear window', 'Door card'];
    expect(fuzzyFilter(items, 'door gl', (x) => [x])).toEqual(['Door glass']);
    expect(fuzzyFilter(items, '', (x) => [x])).toEqual(items);
    expect(fuzzyFilter(items, 'door', (x) => [x])).toEqual(['Door', 'Door glass', 'Door card']);
  });
});
