import { describe, expect, it } from 'vitest';
import { focusScope } from '../../src/renderer/parts/focus';

const part = (id: string, parentPartId: string | null) => ({ id, parentPartId }) as never;

describe('focus scope', () => {
  const doc = {
    parts: [part('body', null), part('door', 'body'), part('glass', 'door'), part('card', 'door'), part('hood', 'body')],
    assignments: { 'm:body': 'body', 'm:door': 'door', 'm:glass': 'glass', 'm:card': 'card', 'm:hood': 'hood' },
  };

  it('a door brings its glass and card along', () => {
    const s = focusScope(doc, 'door');
    expect(new Set(s.parts)).toEqual(new Set(['door', 'glass', 'card']));
    expect(new Set(s.meshKeys)).toEqual(new Set(['m:door', 'm:glass', 'm:card']));
  });

  it('a root part stands alone instead of taking the whole car', () => {
    expect(focusScope(doc, 'body')).toEqual({ parts: ['body'], meshKeys: ['m:body'] });
  });

  it('a leaf is just itself', () => {
    expect(focusScope(doc, 'hood').meshKeys).toEqual(['m:hood']);
  });
});
