/**
 * Is the mod ready to share? A checklist that ticks itself off from what the project and the game
 * say: structure, export checks, a clean spawn, opening parts, lights, configurations, previews,
 * the game's measured figures. Each item says what's left in plain words.
 */

export type ReadinessState = 'done' | 'todo' | 'unknown';

export interface ReadinessItem {
  id: 'structure' | 'export' | 'spawns' | 'drives' | 'opens' | 'lights' | 'configs' | 'previews' | 'measured';
  label: string;
  state: ReadinessState;
  detail: string;
}

export interface ReadinessInput {
  /** Parts that should have nodes of their own but have none yet (display names). */
  ungenerated: string[];
  exportErrors: number;
  exportWarnings: number;
  /** What the game's log said about the car, or null when there's no log to read. */
  game: { found: boolean; errors: number; noController: boolean; unstable: boolean } | null;
  /** Doors, hoods and the like, and how many have a hinge. */
  openable: { total: number; hinged: number };
  lights: number;
  configs: number;
  /** Configurations with a picture for the vehicle selector (the default counts). */
  previews: { with: number; of: number };
  measured: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function readiness(i: ReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  items.push(
    i.ungenerated.length
      ? { id: 'structure', label: 'Every part has its structure', state: 'todo', detail: `Not generated yet: ${i.ungenerated.slice(0, 4).join(', ')}${i.ungenerated.length > 4 ? ` and ${i.ungenerated.length - 4} more` : ''}.` }
      : { id: 'structure', label: 'Every part has its structure', state: 'done', detail: 'Nodes and beams for every part that needs them.' },
  );
  items.push(
    i.exportErrors
      ? { id: 'export', label: 'Export checks pass', state: 'todo', detail: `${plural(i.exportErrors, 'thing')} to fix before it can be exported (Export lists them).` }
      : { id: 'export', label: 'Export checks pass', state: 'done', detail: i.exportWarnings ? `No errors; ${plural(i.exportWarnings, 'warning')} worth a look.` : 'No errors or warnings.' },
  );
  if (!i.game || !i.game.found) {
    const why = i.game ? 'The game’s log has no spawn of this car yet: install it and spawn it.' : 'No game log to read: set the BeamNG user folder in Settings, then spawn the car.';
    items.push({ id: 'spawns', label: 'Spawns in the game without errors', state: 'unknown', detail: why });
    items.push({ id: 'drives', label: 'Drives (it has a working controller)', state: 'unknown', detail: why });
  } else {
    items.push(
      i.game.errors || i.game.unstable
        ? { id: 'spawns', label: 'Spawns in the game without errors', state: 'todo', detail: i.game.unstable ? 'It came apart when it spawned: What the game said shows why.' : `${plural(i.game.errors, 'problem')} in the game’s log: What the game said lists them.` }
        : { id: 'spawns', label: 'Spawns in the game without errors', state: 'done', detail: 'The last spawn was clean.' },
    );
    items.push(i.game.noController ? { id: 'drives', label: 'Drives (it has a working controller)', state: 'todo', detail: 'The game found no drive controller: fit an engine, or check the Engine workspace.' } : { id: 'drives', label: 'Drives (it has a working controller)', state: 'done', detail: 'The game found its controller.' });
  }
  items.push(
    i.openable.total === 0
      ? { id: 'opens', label: 'Doors, hood and trunk open', state: 'done', detail: 'No opening parts.' }
      : i.openable.hinged < i.openable.total
        ? { id: 'opens', label: 'Doors, hood and trunk open', state: 'todo', detail: `${i.openable.total - i.openable.hinged} of ${i.openable.total} opening parts have no hinge yet (Hinge all does them in one go).` }
        : { id: 'opens', label: 'Doors, hood and trunk open', state: 'done', detail: `All ${i.openable.total} have hinges.` },
  );
  items.push(i.lights ? { id: 'lights', label: 'Lights work', state: 'done', detail: `${plural(i.lights, 'light')}.` } : { id: 'lights', label: 'Lights work', state: 'todo', detail: 'No headlights or tail lights yet: mark the lamp meshes as lights.' });
  items.push(i.configs ? { id: 'configs', label: 'Configurations to pick from', state: 'done', detail: `The default and ${plural(i.configs, 'more')}.` } : { id: 'configs', label: 'Configurations to pick from', state: 'todo', detail: 'Only the default: the Configurations manager adds trims and versions.' });
  items.push(
    i.previews.with < i.previews.of
      ? { id: 'previews', label: 'Pictures for the vehicle selector', state: 'todo', detail: `${i.previews.of - i.previews.with} of ${i.previews.of} configurations have no picture (Settings → Export: pictures for every configuration).` }
      : { id: 'previews', label: 'Pictures for the vehicle selector', state: 'done', detail: 'Every configuration has one.' },
  );
  items.push(i.measured ? { id: 'measured', label: 'Performance figures', state: 'done', detail: 'Measured by the game; the next export writes them in.' } : { id: 'measured', label: 'Performance figures', state: 'unknown', detail: 'Measure it in the game (F10 → Measure) so the vehicle selector shows 0-100, top speed and braking.' });
  return items;
}
