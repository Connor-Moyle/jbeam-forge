/**
 * Everything JBeam Forge ships or builds on that someone else made: models,
 * textures and the open-source software. Shown in Help → Credits, and the
 * source of assets/demo-car/CREDITS.txt. Add an entry whenever a model,
 * texture or library from someone else comes into the app.
 */

export interface Credit {
  /** What it is in the app. */
  what: string;
  title: string;
  author: string;
  authorUrl?: string;
  /** Where it came from. */
  source?: string;
  licence: string;
  licenceUrl?: string;
  /** What was changed, for licences that ask (CC BY). */
  changes?: string;
  /** Model files that carry it (end of the path): a mod made from one ships the credit. */
  files?: string[];
}

export const ASSET_CREDITS: Credit[] = [
  {
    what: 'The tutorial’s practice car (BMW E30)',
    title: '1982 BMW 3 Series E30',
    author: 'zairiq-zairiq-123-pixar-cars-bfdi',
    authorUrl: 'https://sketchfab.com/zairiq-zairiq-123-pixar-cars-bfdi',
    source: 'https://sketchfab.com/3d-models/1982-bmw-3-series-e30-8d8b44242a52400aae216f7e05b92b36',
    licence: 'Creative Commons Attribution 4.0 (CC BY 4.0)',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    files: ['tutorial/demo_car.obj'],
    changes: 'Smoothed with subdivision; split into separate parts (wings, doors, bonnet, boot lid, bumpers, side skirts, spoiler, glass, lights, mirrors, wheels, tyres, calipers, seats, dashboard, steering wheel); the driver figure removed; an engine bay, engine, radiator and battery added. Its textures are included unchanged.',
  },
];

/** Open-source software the app is built with. */
export const SOFTWARE_CREDITS: Credit[] = [
  { what: 'App framework', title: 'Electron', author: 'OpenJS Foundation and Electron contributors', source: 'https://www.electronjs.org', licence: 'MIT' },
  { what: '3D view', title: 'three.js', author: 'mrdoob and three.js authors', source: 'https://threejs.org', licence: 'MIT' },
  { what: 'Fast picking and painting', title: 'three-mesh-bvh', author: 'Garrett Johnson', source: 'https://github.com/gkjohnson/three-mesh-bvh', licence: 'MIT' },
  { what: 'Interface', title: 'React', author: 'Meta Platforms, Inc. and affiliates', source: 'https://react.dev', licence: 'MIT' },
  { what: 'Docking panels', title: 'Dockview', author: 'mathuo', source: 'https://dockview.dev', licence: 'MIT' },
  { what: 'State', title: 'Zustand and Immer', author: 'Paul Henschel; Michel Weststrate', source: 'https://github.com/pmndrs/zustand', licence: 'MIT' },
  { what: 'File checks', title: 'Zod', author: 'Colin McDonnell', source: 'https://zod.dev', licence: 'MIT' },
  { what: 'Icons', title: 'Lucide', author: 'Lucide contributors', source: 'https://lucide.dev', licence: 'ISC' },
  { what: 'Zip files', title: 'fflate', author: 'Arjun Barrett', source: 'https://github.com/101arrowz/fflate', licence: 'MIT' },
];

/** One credit as a line of plain text (CC BY's "title by author, licence, source, changes"). */
export function creditLine(c: Credit): string {
  return [`${c.what}: "${c.title}" by ${c.author}`, c.source ? `from ${c.source}` : null, `licensed under ${c.licence}${c.licenceUrl ? ` (${c.licenceUrl})` : ''}`, c.changes ? `Changes: ${c.changes}` : null].filter(Boolean).join(', ');
}

/** Credits a mod made from these model files must carry (CC BY asks for it wherever the model goes). */
export function creditsForSources(paths: readonly string[]): Credit[] {
  const norm = paths.map((p) => p.replace(/\\/g, '/').toLowerCase());
  return ASSET_CREDITS.filter((c) => c.files?.some((f) => norm.some((p) => p.endsWith(f))));
}

/** credits.txt for a mod. */
export function creditsText(credits: readonly Credit[], modName: string): string {
  return `${modName}\n\nThis mod uses work by others:\n\n${credits.map((c) => `- ${creditLine(c)}`).join('\n')}\n`;
}
