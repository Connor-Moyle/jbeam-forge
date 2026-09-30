import { Box3, Matrix4, Vector3, type BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { create } from 'zustand';
import type { Project } from '@shared/project/schema';
import { dropCurve } from '@shared/sim/rideCheck';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { useSceneStore } from '@renderer/app/stores/scene';
import type { ImportedMesh } from '@renderer/import/normalize';
import { fittedSourceIds } from '@renderer/scene/placeFitted';

/**
 * The quick suspension check (fork): the body comes down onto its wheels
 * (a drop, or posed by hand) and the gaps that matter are measured: each
 * wheel to the body at full compression, and the lowest part to the ground.
 */

/** Meshes that go up and down with a wheel: the tyre, rim, hub, brakes and knuckle. */
const WHEEL_NAMES = /tyre|tire|wheel|rim|hub|brake|caliper|rotor|disc|drum|knuckle|spindle|upright/i;
const WHEEL_KINDS = new Set(['Wheels', 'Brakes']);
const WHEEL_PARTS = new Set(['hub', 'knuckle']);
/** Suspension pieces bolted to the body at one end: neither side of the measurement. */
const LINK_NAMES = /arm|link|strut|shock|spring|coil|damper|sway|stab|anti.?roll|tie.?rod|rack|subframe|crossmember|axle|halfshaft|driveshaft|cv/i;
const LINK_KINDS = new Set(['Suspension', 'Steering', 'Driveline']);

export interface Corner {
  name: string;
  /** Wheel centre (BeamNG space). */
  at: [number, number];
  wheelKeys: string[];
}

export interface RideSplit {
  corners: Corner[];
  /** Everything that sits on the springs and is measured against the wheels. */
  bodyKeys: string[];
  /** Suspension links: move with the body, not measured. */
  linkKeys: string[];
}

type Lookup = (taxonomyId: string) => { subcategory?: string } | undefined;

function kindOf(doc: Pick<Project, 'parts' | 'assignments'>, key: string, lookup: Lookup): { sub: string | null; id: string | null } {
  const partId = doc.assignments[key];
  const part = partId ? doc.parts.find((p) => p.id === partId) : undefined;
  const entry = part ? lookup(part.taxonomyId) : undefined;
  return { sub: entry?.subcategory ?? null, id: part?.taxonomyId ?? null };
}

/** Which meshes are wheels (by corner), body, or links. */
export function splitForRide(doc: Pick<Project, 'parts' | 'assignments' | 'axles' | 'ignoredMeshes' | 'powertrain'>, meshes: readonly ImportedMesh[], lookup: Lookup = (id) => currentTaxonomy().entry(id)): RideSplit {
  const fitted = fittedSourceIds(doc);
  const suspensionSources = new Set(doc.axles.map((a) => a.fitted?.sourceId).filter((x): x is string => !!x));
  const wheels: ImportedMesh[] = [];
  const body: string[] = [];
  const links: string[] = [];
  const ignored = new Set(doc.ignoredMeshes);
  for (const m of meshes) {
    if (ignored.has(m.key)) continue;
    const { sub, id } = kindOf(doc, m.key, lookup);
    const fromSuspension = suspensionSources.has(m.sourceId);
    if ((sub && WHEEL_KINDS.has(sub)) || (id && WHEEL_PARTS.has(id)) || ((fromSuspension || !sub) && WHEEL_NAMES.test(m.name) && !/steering.?wheel|spare/i.test(m.name))) wheels.push(m);
    else if (fromSuspension || (sub && LINK_KINDS.has(sub)) || (fitted.has(m.sourceId) && LINK_NAMES.test(m.name))) links.push(m.key);
    else body.push(m.key);
  }
  // Corners: the axles' wheel centres, else the wheel meshes' own spread (front/rear, left/right).
  const centre = (m: ImportedMesh) => {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    return m.geometry.boundingBox!.getCenter(new Vector3());
  };
  let spots: { name: string; at: [number, number] }[] = doc.axles.flatMap((a) => [1, -1].map((side) => ({ name: `${a.name} ${side > 0 ? 'left' : 'right'}`, at: [(side * a.track) / 2, a.y] as [number, number] })));
  if (!spots.length && wheels.length) {
    const ys = wheels.map((m) => centre(m).y);
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    spots = (['front', 'rear'] as const).flatMap((end) => ([1, -1] as const).map((side) => ({ name: `${end === 'front' ? 'Front' : 'Rear'} ${side > 0 ? 'left' : 'right'}`, at: [side, end === 'front' ? mid - 1 : mid + 1] as [number, number] })));
  }
  const corners: Corner[] = spots.map((s) => ({ ...s, wheelKeys: [] }));
  for (const m of wheels) {
    const c = centre(m);
    let best: Corner | undefined;
    let bestD = Infinity;
    for (const k of corners) {
      // Side first (sign of x), then along the car.
      const d = Math.abs(c.y - k.at[1]) + (Math.sign(c.x) === Math.sign(k.at[0]) ? 0 : 100);
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    best?.wheelKeys.push(m.key);
  }
  return { corners: corners.filter((c) => c.wheelKeys.length), bodyKeys: body, linkKeys: links };
}

const bvhs = new WeakMap<BufferGeometry, MeshBVH>();
function bvhOf(g: BufferGeometry): MeshBVH {
  let b = bvhs.get(g);
  if (!b) {
    b = new MeshBVH(g);
    bvhs.set(g, b);
    (g as BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = b;
  }
  return b;
}

export interface Gap {
  corner: string;
  /** Closest distance (m) at full compression; 0 means they touch or overlap. */
  distance: number;
  /** The same as modelled (no compression): 0 means the wheel already sits in the body. */
  atRest: number;
  /** The body mesh it's closest to. */
  meshKey: string | null;
}

export interface RideReport {
  travel: number;
  gaps: Gap[];
  /** Lowest point of the body above the ground: modelled, and at full compression (m). */
  ground: { atRest: number; atBump: number; meshKey: string | null };
}

/** Measure the gaps with the body `travel` metres further down onto its wheels. */
export function measureRide(split: RideSplit, meshes: ReadonlyMap<string, ImportedMesh>, travel: number, searchRadius = 0.25): RideReport {
  const box = (k: string) => {
    const g = meshes.get(k)!.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!;
  };
  // The body moved down by `travel`, expressed in the wheel meshes' space.
  const down = new Matrix4().makeTranslation(0, 0, -travel);
  const gaps: Gap[] = [];
  for (const c of split.corners) {
    const wheelBox = new Box3();
    for (const k of c.wheelKeys) wheelBox.union(box(k));
    const reach = wheelBox.clone().expandByScalar(searchRadius);
    let best: Gap = { corner: c.name, distance: Infinity, atRest: Infinity, meshKey: null };
    for (const b of split.bodyKeys) {
      const bb = box(b).clone().translate(new Vector3(0, 0, -travel));
      if (!bb.intersectsBox(reach)) continue;
      const bodyGeom = meshes.get(b)!.geometry;
      bvhOf(bodyGeom);
      for (const w of c.wheelKeys) {
        const t1 = { point: new Vector3(), distance: Infinity, faceIndex: 0 };
        const t2 = { point: new Vector3(), distance: Infinity, faceIndex: 0 };
        bvhOf(meshes.get(w)!.geometry).closestPointToGeometry(bodyGeom, down, t1, t2, 0, best.distance);
        if (t1.distance < best.distance) best = { ...best, distance: t1.distance, meshKey: b };
      }
    }
    // As modelled, against the same body mesh.
    if (best.meshKey) {
      const bodyGeom = meshes.get(best.meshKey)!.geometry;
      for (const w of c.wheelKeys) {
        const t1 = { point: new Vector3(), distance: Infinity, faceIndex: 0 };
        const t2 = { point: new Vector3(), distance: Infinity, faceIndex: 0 };
        bvhOf(meshes.get(w)!.geometry).closestPointToGeometry(bodyGeom, new Matrix4(), t1, t2, 0, best.atRest);
        best.atRest = Math.min(best.atRest, t1.distance);
      }
    }
    gaps.push(best);
  }
  // The ground: where the tyres stand (their lowest point).
  let groundZ = Infinity;
  for (const c of split.corners) for (const k of c.wheelKeys) groundZ = Math.min(groundZ, box(k).min.z);
  let low = Infinity;
  let lowKey: string | null = null;
  for (const b of split.bodyKeys) {
    const z = box(b).min.z;
    if (z < low) {
      low = z;
      lowKey = b;
    }
  }
  const atRest = Number.isFinite(groundZ) && Number.isFinite(low) ? low - groundZ : NaN;
  return { travel, gaps, ground: { atRest, atBump: atRest - travel, meshKey: lowKey } };
}

interface RideState {
  /** Body offset (m, − down) and wheel offset (m, + up) the viewport shows; null: as modelled. */
  pose: { body: number; wheels: number } | null;
  split: RideSplit | null;
  travel: number;
  report: RideReport | null;
  playing: boolean;
  set: (p: Partial<Omit<RideState, 'set'>>) => void;
}

export const useRideCheck = create<RideState>()((set) => ({
  pose: null,
  split: null,
  travel: 0.1,
  report: null,
  playing: false,
  set: (p) => set(p),
}));

function allMeshes(): Map<string, ImportedMesh> {
  const out = new Map<string, ImportedMesh>();
  for (const s of Object.values(useSceneStore.getState().sources)) for (const m of s.meshes) out.set(m.key, m);
  return out;
}

/** Sort the car's meshes and measure at full compression. */
export function runRideCheck(doc: Project, travel: number): RideReport | null {
  const meshes = allMeshes();
  const split = splitForRide(doc, [...meshes.values()]);
  if (!split.corners.length) {
    useRideCheck.getState().set({ split, report: null });
    return null;
  }
  const report = measureRide(split, meshes, travel);
  useRideCheck.getState().set({ split, report, travel });
  return report;
}

/** Pose the body `compression` metres down onto its wheels (by hand, the slider). */
export function poseRide(compression: number | null): void {
  useRideCheck.getState().set({ pose: compression === null ? null : { body: -compression, wheels: 0 } });
}

let raf = 0;
/** Play the drop in the viewport. */
export function playDrop(travel: number): void {
  cancelAnimationFrame(raf);
  const frames = dropCurve({ height: 0.25, travel, seconds: 3 });
  const start = performance.now();
  useRideCheck.getState().set({ playing: true });
  const step = () => {
    const t = (performance.now() - start) / 1000;
    const f = frames[Math.min(frames.length - 1, Math.floor(t * 60))]!;
    // Everything falls with the wheels; the body also moves by the compression.
    useRideCheck.getState().set({ pose: { body: f.wheels - f.compression, wheels: f.wheels } });
    if (t * 60 < frames.length - 1) raf = requestAnimationFrame(step);
    else useRideCheck.getState().set({ playing: false, pose: null });
  };
  raf = requestAnimationFrame(step);
}

export function stopRide(): void {
  cancelAnimationFrame(raf);
  useRideCheck.getState().set({ playing: false, pose: null });
}
