import { z } from 'zod';

/**
 * Interior cameras (the game's camerasInternal): where the driver's eyes
 * are (and other seats or a hood cam), each a node the game hangs off six
 * nearby body nodes so the view shakes and leans with the car.
 *   ["type","x","y","z","fov","id1:","id2:","id3:","id4:","id5:","id6:"]
 */

const V3 = z.tuple([z.number(), z.number(), z.number()]);

export const CameraSchema = z.object({
  id: z.string().min(1),
  /** The game's camera type: "driver" is the interior view; others ("passenger", "hood"…) as the game names them. */
  type: z.string().min(1),
  /** Eye position, BeamNG space. */
  pos: V3,
  /** Field of view, degrees. */
  fov: z.number().min(20).max(120),
});

export type InternalCamera = z.infer<typeof CameraSchema>;
type Vec = [number, number, number];

export const CAMERA_TYPES = ['driver', 'passenger', 'hood', 'dash'] as const;

/** The camera node's settings (from stock cars): light, never colliding, springy enough to feel the road. */
export const CAMERA_NODE_SETTINGS = { nodeWeight: 1.3, selfCollision: false, collision: false, beamSpring: 60000, beamDamp: 250, beamDeform: 1000000 } as const;

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** The six body nodes a camera hangs from: nearest first, spread around it (not all on one side). */
export function cameraAnchors(nodes: readonly { id: string; pos: readonly number[] }[], at: readonly number[]): string[] | null {
  if (nodes.length < 6) return null;
  const sorted = [...nodes].sort((a, b) => dist(a.pos, at) - dist(b.pos, at));
  const picked: typeof sorted = [];
  // One from each side first (left/right, front/back, up/down) so it's held from all round, then the nearest.
  const sides: ((p: readonly number[]) => boolean)[] = [(p) => p[0]! > at[0]!, (p) => p[0]! < at[0]!, (p) => p[1]! < at[1]!, (p) => p[1]! > at[1]!, (p) => p[2]! > at[2]!, (p) => p[2]! < at[2]!];
  for (const side of sides) {
    const n = sorted.find((x) => side(x.pos) && !picked.includes(x));
    if (n) picked.push(n);
  }
  for (const n of sorted) if (picked.length < 6 && !picked.includes(n)) picked.push(n);
  return picked.slice(0, 6).map((n) => n.id);
}

/**
 * Where the driver's eyes probably are, from the body's bounds: a little
 * behind the middle, at about two thirds of the height, on the driver's
 * side (BeamNG +X is left: left-hand drive sits at +X).
 */
export function guessDriverEye(bounds: { min: readonly number[]; max: readonly number[] }, rightHandDrive = false): Vec {
  const w = bounds.max[0]! - bounds.min[0]!;
  const cx = (bounds.min[0]! + bounds.max[0]!) / 2;
  const l = bounds.max[1]! - bounds.min[1]!;
  const h = bounds.max[2]! - bounds.min[2]!;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [r(cx + (rightHandDrive ? -1 : 1) * w * 0.2), r(bounds.min[1]! + l * 0.52), r(bounds.min[2]! + h * 0.72)];
}

type Cell = string | number | Record<string, number | boolean>;

/** The camerasInternal table for the cameras that could be hung (null when none). */
export function camerasInternalSection(cameras: readonly InternalCamera[], nodes: readonly { id: string; pos: readonly number[] }[]): (Cell[] | Record<string, number | boolean>)[] | null {
  const rows = cameras.flatMap((c) => {
    const ids = cameraAnchors(nodes, c.pos);
    return ids ? [[c.type, c.pos[0], c.pos[1], c.pos[2], c.fov, ...ids] as Cell[]] : [];
  });
  if (!rows.length) return null;
  return [['type', 'x', 'y', 'z', 'fov', 'id1:', 'id2:', 'id3:', 'id4:', 'id5:', 'id6:'], { ...CAMERA_NODE_SETTINGS }, ...rows];
}
