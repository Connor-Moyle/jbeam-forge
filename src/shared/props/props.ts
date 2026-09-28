import { z } from 'zod';

/**
 * Animated parts (props): a mesh the game turns or slides by one of its
 * electrics values: the steering wheel by the steering angle, needles by
 * rpm, speed, fuel or temperature, pedals by throttle, brake and clutch.
 * Written as the part's jbeam `props` table:
 *   ["func","mesh","idRef:","idX:","idY:","baseRotation","rotation","translation","min","max","offset","multiplier"]
 * The value (clamped to min–max after × multiplier + offset) is the angle in
 * degrees about `rotation`, or the distance along `translation`. Both
 * vectors are in the frame of the three reference nodes (x: ref → idX,
 * y: ref → idY), which also carries the mesh with the car. The mesh turns
 * about its own origin, so it's exported with its origin at the pivot.
 */

const V3 = z.tuple([z.number(), z.number(), z.number()]);

export const PropSchema = z.object({
  id: z.string().min(1),
  /** The project mesh that moves. */
  meshKey: z.string().min(1),
  /** Electrics value driving it (steering, rpmTacho, wheelspeed, fuel, watertemp, throttle, brake, clutch, parkingbrake…). */
  func: z.string().min(1),
  /** Where it turns about (BeamNG space). */
  pivot: V3,
  /** Turns about this axis (BeamNG space; normalised on export); zero = it slides instead. */
  axis: V3,
  /** Slides along this (metres per unit), when it slides. */
  slide: V3,
  min: z.number(),
  max: z.number(),
  offset: z.number(),
  multiplier: z.number(),
});

export type Prop = z.infer<typeof PropSchema>;
type Vec = [number, number, number];

/** Ready-made animations: the game's electrics value and sensible numbers. */
export const PROP_KINDS: { id: string; label: string; func: string; hint: string; min: number; max: number; offset: number; multiplier: number; slides?: boolean }[] = [
  { id: 'steering', label: 'Steering wheel', func: 'steering', hint: 'Turns with the steering (degrees at the wheel)', min: -900, max: 900, offset: 0, multiplier: 1 },
  { id: 'tacho', label: 'Rev counter needle', func: 'rpmTacho', hint: '270° sweep up to 8000 rpm', min: 0, max: 270, offset: 0, multiplier: 270 / 8000 },
  { id: 'speedo', label: 'Speedometer needle', func: 'wheelspeed', hint: '270° sweep up to 260 km/h (the value is m/s)', min: 0, max: 270, offset: 0, multiplier: 270 / (260 / 3.6) },
  { id: 'fuel', label: 'Fuel needle', func: 'fuel', hint: '90° from empty to full', min: 0, max: 90, offset: 0, multiplier: 90 },
  { id: 'temp', label: 'Temperature needle', func: 'watertemp', hint: '90° from 50 °C to 130 °C', min: 0, max: 90, offset: -50 * (90 / 80), multiplier: 90 / 80 },
  { id: 'throttle', label: 'Throttle pedal', func: 'throttle', hint: 'Tips 18° when floored', min: 0, max: 18, offset: 0, multiplier: 18 },
  { id: 'brake', label: 'Brake pedal', func: 'brake', hint: 'Tips 18° under full braking', min: 0, max: 18, offset: 0, multiplier: 18 },
  { id: 'clutch', label: 'Clutch pedal', func: 'clutch', hint: 'Tips 20° when pressed', min: 0, max: 20, offset: 0, multiplier: 20 },
  { id: 'handbrake', label: 'Handbrake lever', func: 'parkingbrake', hint: 'Lifts 25° when pulled', min: 0, max: 25, offset: 0, multiplier: 25 },
  { id: 'custom', label: 'Something else', func: 'wheelspeed', hint: 'Any electrics value the game has', min: -360, max: 360, offset: 0, multiplier: 1 },
];

const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): Vec => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const unit = (a: readonly number[]): Vec => {
  const l = len(a) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

/**
 * Reference nodes for a prop near `pivot`: the nearest node, then the nodes
 * that best give a frame lined up with the car's X and Y (so the settings
 * read naturally), well apart and not in line.
 */
export function referenceNodes(nodes: readonly { id: string; pos: readonly number[] }[], pivot: readonly number[]): [string, string, string] | null {
  if (nodes.length < 3) return null;
  const byDist = [...nodes].sort((a, b) => len(sub(a.pos, pivot)) - len(sub(b.pos, pivot)));
  const ref = byDist[0]!;
  const pick = (dir: Vec, not: string[]) => {
    let best: (typeof nodes)[number] | null = null;
    let score = -Infinity;
    for (const n of nodes) {
      if (not.includes(n.id)) continue;
      const d = sub(n.pos, ref.pos);
      const l = len(d);
      if (l < 0.05) continue;
      const s = dot(d, dir) / l - l * 0.2; // lined up, and not far away
      if (s > score) {
        score = s;
        best = n;
      }
    }
    return best;
  };
  const x = pick([1, 0, 0], [ref.id]) ?? pick([-1, 0, 0], [ref.id]);
  if (!x) return null;
  const xd = unit(sub(x.pos, ref.pos));
  // Y: along +Y, and clearly not in line with ref → x.
  let y: (typeof nodes)[number] | null = null;
  let score = -Infinity;
  for (const n of nodes) {
    if (n.id === ref.id || n.id === x.id) continue;
    const d = sub(n.pos, ref.pos);
    const l = len(d);
    if (l < 0.05) continue;
    const off = len(cross(xd, d)) / l; // sin of the angle to ref → x
    if (off < 0.3) continue;
    const s = Math.abs(dot(d, [0, 1, 0]) / l) + off - l * 0.2;
    if (s > score) {
      score = s;
      y = n;
    }
  }
  return y ? [ref.id, x.id, y.id] : null;
}

/** A BeamNG-space vector in the reference nodes' frame (x: ref → idX, y: ref → idY orthogonalised, z: x × y). */
export function toNodeFrame(v: readonly number[], ref: readonly number[], xNode: readonly number[], yNode: readonly number[]): Vec {
  const ex = unit(sub(xNode, ref));
  const yRaw = sub(yNode, ref);
  const ey = unit(sub(yRaw, ex.map((c) => c * dot(yRaw, ex))));
  const ez = cross(ex, ey);
  const r = (n: number) => Math.round(n * 1e4) / 1e4 || 0;
  return [r(dot(v, ex)), r(dot(v, ey)), r(dot(v, ez))];
}

type Cell = string | number | Record<string, number>;

/** The props table row for a prop. */
export function propRow(p: Prop, mesh: string, refs: [string, string, string], pos: (id: string) => readonly number[]): Cell[] {
  const [a, b, c] = refs.map(pos) as [readonly number[], readonly number[], readonly number[]];
  const slides = len(p.axis) < 1e-9;
  const rot = slides ? [0, 0, 0] : toNodeFrame(unit(p.axis), a, b, c);
  const tr = slides ? toNodeFrame(p.slide, a, b, c) : [0, 0, 0];
  const xyz = (v: readonly number[]) => ({ x: v[0]!, y: v[1]!, z: v[2]! });
  return [p.func, mesh, ...refs, xyz([0, 0, 0]), xyz(rot), xyz(tr), p.min, p.max, p.offset, p.multiplier];
}

export const PROPS_HEADER = ['func', 'mesh', 'idRef:', 'idX:', 'idY:', 'baseRotation', 'rotation', 'translation', 'min', 'max', 'offset', 'multiplier'];

/** Where a prop sits at a value (for the in-app preview): degrees turned, or metres slid. */
export function propAmount(p: Pick<Prop, 'min' | 'max' | 'offset' | 'multiplier'>, value: number): number {
  return Math.min(p.max, Math.max(p.min, value * p.multiplier + p.offset));
}
