import { z } from 'zod';

/**
 * Mods ported from another game (fork). Bringing a car over from a game is
 * only fair when the modder owns that game, says where the car came from
 * and gives the mod away: the project records all three, the export stops
 * until they're ticked, and the mod carries the credit in its description
 * and a ported_from.txt beside its files.
 */

export const PortedFromSchema = z.object({
  /** The game the model and data came from ("Assetto Corsa"). */
  game: z.string().max(120),
  /** Who made the original (a studio, a modder), if known. */
  credit: z.string().max(200).optional(),
  /** The modder owns a copy of the game. */
  owned: z.boolean(),
  /** The mod is free: not sold, not behind a paywall. */
  free: z.boolean(),
});
export type PortedFrom = z.infer<typeof PortedFromSchema>;

/** Games the importers know, for the declaration's list. */
export const KNOWN_GAMES = ['Assetto Corsa', 'BeamNG.drive', 'Car Mechanic Simulator 2021', 'Street Legal Racing: Redline', 'Project CARS', 'Project CARS 2'] as const;

/** What's missing before a ported mod may be exported (empty when it's fine or not ported). */
export function portedIssues(p: PortedFrom | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (!p.game.trim()) out.push('Say which game this mod was ported from (Mod settings → Ported from).');
  if (!p.owned) out.push(`Confirm you own ${p.game.trim() || 'the game'} the model comes from (Mod settings → Ported from).`);
  if (!p.free) out.push('A ported mod must be free: confirm it won’t be sold or put behind a paywall (Mod settings → Ported from).');
  return out;
}

/** The credit line for the description and the mod's text file. */
export function portedNotice(p: PortedFrom): string {
  const credit = p.credit?.trim() ? ` Original by ${p.credit.trim()}.` : '';
  return `Ported from ${p.game.trim()}.${credit} Free mod, not for sale; the original belongs to its makers.`;
}

/** Description with the credit appended once. */
export function withPortedNotice(description: string, p: PortedFrom | undefined): string {
  if (!p) return description;
  const notice = portedNotice(p);
  return description.includes(notice) ? description : `${description.trim()}${description.trim() ? '\n\n' : ''}${notice}`;
}

/** ported_from.txt: the credit, the declaration, when it was made. */
export function portedText(p: PortedFrom, modName: string, author: string, date = new Date()): string {
  return [
    `${modName}`,
    '',
    portedNotice(p),
    '',
    `The author (${author || 'unknown'}) declared, when exporting on ${date.toISOString().slice(0, 10)}, that they own ${p.game.trim()} and that this mod is given away free.`,
    'Please keep this file with the mod.',
    '',
  ].join('\n');
}
