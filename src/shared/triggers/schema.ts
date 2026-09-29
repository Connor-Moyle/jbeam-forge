import { z } from 'zod';

/**
 * Triggers (fork): boxes on the car the player clicks in the game (a door
 * handle, a light switch, the hood release). Each runs a game input action
 * when clicked. Exported as the part's triggers2 rows, placed in the frame
 * of three of that part's nodes so they move with it.
 */

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const TRIGGER_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export const TriggerSchema = z.object({
  id: z.string().regex(TRIGGER_ID),
  /** The part whose nodes carry it (it moves with them). */
  partId: z.string().min(1),
  /** Centre, BeamNG space (m). */
  pos: Vec3,
  /** Width, depth, height (m). */
  size: Vec3,
  /** Turn about X, Y, Z (degrees). */
  rotation: Vec3,
  /** The input action a click runs (door_FL, toggle_headlights, one of the car's scripts…). */
  action: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
});

export type Trigger = z.infer<typeof TriggerSchema>;

/** Game input actions a trigger can run, grouped for the picker. Doors and scripts add their own. */
export const GAME_ACTIONS: readonly { value: string; label: string; group: string }[] = [
  { value: 'toggle_headlights', label: 'Headlights', group: 'Lights' },
  { value: 'toggle_left_signal', label: 'Left indicator', group: 'Lights' },
  { value: 'toggle_right_signal', label: 'Right indicator', group: 'Lights' },
  { value: 'toggle_hazard_signal', label: 'Hazard lights', group: 'Lights' },
  { value: 'toggle_lightbar_signal', label: 'Light bar', group: 'Lights' },
  { value: 'horn', label: 'Horn', group: 'Controls' },
  { value: 'door_FL', label: 'Front left door', group: 'Opening' },
  { value: 'door_FR', label: 'Front right door', group: 'Opening' },
  { value: 'door_RL', label: 'Rear left door', group: 'Opening' },
  { value: 'door_RR', label: 'Rear right door', group: 'Opening' },
  { value: 'hoodRelease', label: 'Hood release', group: 'Opening' },
  { value: 'trunk', label: 'Trunk', group: 'Opening' },
  { value: 'tailgate', label: 'Tailgate', group: 'Opening' },
  { value: 'fuelDoor', label: 'Fuel door', group: 'Opening' },
];

/** Box sizes for the common kinds of trigger (m). */
export const TRIGGER_PRESETS: readonly { id: string; label: string; size: [number, number, number] }[] = [
  { id: 'handle', label: 'Door handle', size: [0.16, 0.03, 0.05] },
  { id: 'button', label: 'Button', size: [0.03, 0.02, 0.03] },
  { id: 'switch', label: 'Switch or stalk', size: [0.06, 0.04, 0.03] },
  { id: 'lever', label: 'Lever or release', size: [0.1, 0.05, 0.06] },
  { id: 'panel', label: 'Large panel', size: [0.3, 0.05, 0.2] },
];

/** A free trigger id from a base ("handle" → handle, handle2…). */
export function uniqueTriggerId(existing: readonly { id: string }[], base: string): string {
  const stem = base.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '') || 'trigger';
  const taken = new Set(existing.map((t) => t.id));
  if (!taken.has(stem)) return stem;
  for (let i = 2; ; i++) if (!taken.has(`${stem}${i}`)) return `${stem}${i}`;
}

/** The same trigger on the other side of the car (X mirrored; L/R, FL/FR in the name and action swapped). */
export function mirrorTrigger(t: Trigger, existing: readonly { id: string }[]): Trigger {
  const swap = (s: string) => s.replace(/(FL|FR|RL|RR|_L|_R|L$|R$)/g, (m) => ({ FL: 'FR', FR: 'FL', RL: 'RR', RR: 'RL', _L: '_R', _R: '_L', L: 'R', R: 'L' })[m] ?? m);
  return { ...t, id: uniqueTriggerId(existing, swap(t.id)), pos: [-t.pos[0], t.pos[1], t.pos[2]], rotation: [t.rotation[0], -t.rotation[1], -t.rotation[2]], action: swap(t.action) };
}

/** The eight corners of a trigger box, BeamNG space (rotation X, then Y, then Z, degrees). */
export function triggerCorners(t: Pick<Trigger, 'pos' | 'size' | 'rotation'>): [number, number, number][] {
  const r = t.rotation.map((d) => (d * Math.PI) / 180);
  const rot = (p: [number, number, number]): [number, number, number] => {
    let [x, y, z] = p;
    [y, z] = [y * Math.cos(r[0]!) - z * Math.sin(r[0]!), y * Math.sin(r[0]!) + z * Math.cos(r[0]!)];
    [x, z] = [x * Math.cos(r[1]!) + z * Math.sin(r[1]!), -x * Math.sin(r[1]!) + z * Math.cos(r[1]!)];
    [x, y] = [x * Math.cos(r[2]!) - y * Math.sin(r[2]!), x * Math.sin(r[2]!) + y * Math.cos(r[2]!)];
    return [x, y, z];
  };
  const out: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const c = rot([((i & 1 ? 1 : -1) * t.size[0]) / 2, ((i & 2 ? 1 : -1) * t.size[1]) / 2, ((i & 4 ? 1 : -1) * t.size[2]) / 2]);
    out.push([t.pos[0] + c[0], t.pos[1] + c[1], t.pos[2] + c[2]]);
  }
  return out;
}
