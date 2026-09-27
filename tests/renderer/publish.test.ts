import { describe, expect, it } from 'vitest';
import { checkLine, parseTags, publishChecklist } from '../../src/renderer/export/publish';

const doc = {
  meta: { name: 'Sunburst', slug: 'sunburst', author: 'Connor', description: '', brand: '', type: 'Car', createdAt: '', modifiedAt: '' },
  configs: [{ id: 'c1', name: 'Race Spec', description: '', type: 'Race', parts: {}, vars: {} }],
};
const files = (paths: string[]) => paths.map((path) => ({ path, text: '' }));
const listing = { title: 'Sunburst', description: 'A small hatchback with a boxer four and a very eager rear end.', version: '1.0' };

describe('publishChecklist', () => {
  it('passes a complete mod', () => {
    const checks = publishChecklist(doc, { errors: [], warnings: [] }, { slug: 'sunburst', files: files(['vehicles/sunburst/default.jpg', 'vehicles/sunburst/race_spec.jpg']) }, listing);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map(checkLine)).toContain('✓ A preview picture for every configuration (2)');
  });

  it('flags missing previews, a short description and a bad version', () => {
    const checks = publishChecklist({ ...doc, meta: { ...doc.meta, author: ' ' } }, { errors: [], warnings: [] }, { slug: 'sunburst', files: files(['vehicles/sunburst/default.jpg']) }, { title: '', description: 'short', version: 'v1' });
    const bad = checks.filter((c) => !c.ok).map((c) => c.label);
    expect(bad).toEqual(['No preview picture for race_spec', 'No author set', 'No title', 'Description is short (under 40 characters)', 'Version should be numbers like 1.0']);
  });
});

describe('parseTags', () => {
  it('trims, lower-cases and drops repeats', () => {
    expect(parseTags(' Car, drift ,car,, JDM')).toEqual(['car', 'drift', 'jdm']);
  });
});
