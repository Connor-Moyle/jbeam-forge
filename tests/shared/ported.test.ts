import { describe, expect, it } from 'vitest';
import { portedIssues, portedNotice, portedText, withPortedNotice } from '@shared/export/ported';
import { infoJson } from '@shared/export/files';
import { ProjectMetaSchema } from '@shared/project/schema';

const meta = { name: 'Old Coupe', slug: 'old_coupe', author: 'me', description: 'A coupe.', brand: 'X', type: 'Car', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' };

describe('ported mods', () => {
  it('asks for the game, ownership and a free mod', () => {
    expect(portedIssues(undefined)).toEqual([]);
    expect(portedIssues({ game: '', owned: false, free: false })).toHaveLength(3);
    expect(portedIssues({ game: 'Assetto Corsa', owned: true, free: false })[0]).toMatch(/free/);
    expect(portedIssues({ game: 'Assetto Corsa', owned: true, free: true })).toEqual([]);
  });

  it('credits the game in info.json once', () => {
    const p = { game: 'Assetto Corsa', credit: 'Kunos', owned: true, free: true };
    const info = infoJson({ meta: { ...meta, portedFrom: p } }, 'me');
    expect(info.Description).toBe(`A coupe.\n\n${portedNotice(p)}`);
    expect(withPortedNotice(info.Description as string, p)).toBe(info.Description);
    expect(portedNotice(p)).toMatch(/Ported from Assetto Corsa\. Original by Kunos\. Free mod, not for sale/);
  });

  it('writes a text file with the declaration', () => {
    const text = portedText({ game: 'BeamNG.drive', owned: true, free: true }, 'Old Coupe', 'me', new Date('2026-09-30T00:00:00Z'));
    expect(text).toContain('declared, when exporting on 2026-09-30, that they own BeamNG.drive');
  });

  it('is kept in the project', () => {
    expect(ProjectMetaSchema.parse({ ...meta, portedFrom: { game: 'Assetto Corsa', owned: true, free: false } }).portedFrom?.free).toBe(false);
  });
});
