import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshModel } from '@shared/project/schema';
import { modelFits, shapeOf, weld, type Shape, type Topology } from '@shared/mesh/meshModel';
import type { ImportedMesh } from '@renderer/import/normalize';

/**
 * Modelling (fork): the meshes with their in-app reshaping applied, before
 * their move/turn/resize (meshEdits) so a reshaped mesh can still be moved
 * as a whole. Every mesh remembers the geometry it came in with
 * (`userData.modelBase`), which the viewport welds into points to edit.
 */

/** Each corner's position (three per triangle), indexed or not. */
export function cornerPositions(g: BufferGeometry): Float32Array {
  const pos = g.getAttribute('position');
  if (!pos) return new Float32Array(0);
  const index = g.index;
  const n = index ? index.count : pos.count;
  const out = new Float32Array(n * 3);
  for (let c = 0; c < n; c++) {
    const v = index ? index.getX(c) : c;
    out[c * 3] = pos.getX(v);
    out[c * 3 + 1] = pos.getY(v);
    out[c * 3 + 2] = pos.getZ(v);
  }
  return out;
}

const topoCache = new WeakMap<BufferGeometry, { version: number; topo: Topology }>();

/** The geometry's corners welded into points (worked out once per geometry, again if it is moved in place). */
export function topologyOf(g: BufferGeometry): Topology {
  const pos = g.getAttribute('position') as BufferAttribute | undefined;
  const version = pos?.version ?? 0;
  let t = topoCache.get(g);
  if (!t || t.version !== version) {
    t = { version, topo: weld(cornerPositions(g)) };
    topoCache.set(g, t);
  }
  return t.topo;
}

/** New geometry: `base` reshaped to `shape`. Attributes of added triangles come from the triangle they copy. */
export function buildShaped(base: BufferGeometry, shape: Shape, model: MeshModel): BufferGeometry {
  const src = base.index ? base.toNonIndexed() : base;
  const corners = shape.triCount * 3;
  const out = new BufferGeometry();
  // Corners of each output triangle in the source's attribute arrays (added triangles borrow their neighbour's).
  const from = new Int32Array(corners);
  for (let t = 0; t < shape.triCount; t++) {
    const like = t < shape.baseTris ? t : Math.min(model.added[t - shape.baseTris]?.like ?? 0, shape.baseTris - 1);
    for (let k = 0; k < 3; k++) {
      // A turned triangle's corners 1 and 2 swap, with everything they carry.
      const kk = t < shape.baseTris && shape.flipped[t] && k > 0 ? 3 - k : k;
      from[t * 3 + k] = Math.max(0, like) * 3 + (t < shape.baseTris ? kk : 0);
    }
  }
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (name === 'position' || name === 'normal') continue;
    const size = attr.itemSize;
    const arr = new Float32Array(corners * size);
    for (let c = 0; c < corners; c++) for (let k = 0; k < size; k++) arr[c * size + k] = attr.getComponent(from[c]!, k);
    out.setAttribute(name, new BufferAttribute(arr, size, attr.normalized));
  }
  const pos = new Float32Array(corners * 3);
  for (let t = 0; t < shape.triCount; t++) {
    for (let k = 0; k < 3; k++) {
      // Deleted triangles collapse onto their first corner: nothing to draw, numbers unchanged.
      const p = shape.corners[t * 3 + (shape.removed[t] ? 0 : k)]!;
      pos[(t * 3 + k) * 3] = shape.points[p * 3]!;
      pos[(t * 3 + k) * 3 + 1] = shape.points[p * 3 + 1]!;
      pos[(t * 3 + k) * 3 + 2] = shape.points[p * 3 + 2]!;
    }
  }
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(normalsFor(src, shape, model), 3));
  // Material groups: the file's, then one per run of added triangles by material.
  const groups = src.groups.length ? src.groups : [{ start: 0, count: shape.baseTris * 3, materialIndex: 0 }];
  for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex);
  const materialOf = (t: number) => groups.find((g) => t * 3 >= g.start && t * 3 < g.start + g.count)?.materialIndex ?? 0;
  for (let t = shape.baseTris; t < shape.triCount; t++) {
    const mat = materialOf(model.added[t - shape.baseTris]?.like ?? 0);
    const last = out.groups[out.groups.length - 1];
    if (last && last.materialIndex === mat && last.start + last.count === t * 3) last.count += 3;
    else out.addGroup(t * 3, 3, mat);
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Normals: the file's where nothing changed; smooth (averaged over the
 * faces round each point) on triangles that were reshaped, turned or added.
 */
function normalsFor(src: BufferGeometry, shape: Shape, model: MeshModel): Float32Array {
  const corners = shape.triCount * 3;
  const out = new Float32Array(corners * 3);
  const had = src.getAttribute('normal');
  const touchedPoint = new Uint8Array(shape.points.length / 3);
  for (const k of Object.keys(model.moved)) touchedPoint[Number(k)] = 1;
  for (let p = model.base.points; p < touchedPoint.length; p++) touchedPoint[p] = 1;
  const rewired = new Set(Object.keys(model.rewire).map((c) => Math.floor(Number(c) / 3)));
  const touched = (t: number) => t >= shape.baseTris || shape.flipped[t] === 1 || rewired.has(t) || touchedPoint[shape.corners[t * 3]!] === 1 || touchedPoint[shape.corners[t * 3 + 1]!] === 1 || touchedPoint[shape.corners[t * 3 + 2]!] === 1;
  // Smooth normals per point, from every live face.
  const pn = new Float32Array(shape.points.length);
  const face = (t: number): [number, number, number] => {
    const [a, b, c] = [shape.corners[t * 3]!, shape.corners[t * 3 + 1]!, shape.corners[t * 3 + 2]!];
    const ux = shape.points[b * 3]! - shape.points[a * 3]!;
    const uy = shape.points[b * 3 + 1]! - shape.points[a * 3 + 1]!;
    const uz = shape.points[b * 3 + 2]! - shape.points[a * 3 + 2]!;
    const vx = shape.points[c * 3]! - shape.points[a * 3]!;
    const vy = shape.points[c * 3 + 1]! - shape.points[a * 3 + 1]!;
    const vz = shape.points[c * 3 + 2]! - shape.points[a * 3 + 2]!;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  for (let t = 0; t < shape.triCount; t++) {
    if (shape.removed[t]) continue;
    const n = face(t);
    for (let k = 0; k < 3; k++) {
      const p = shape.corners[t * 3 + k]!;
      pn[p * 3] = pn[p * 3]! + n[0];
      pn[p * 3 + 1] = pn[p * 3 + 1]! + n[1];
      pn[p * 3 + 2] = pn[p * 3 + 2]! + n[2];
    }
  }
  for (let t = 0; t < shape.triCount; t++) {
    const fresh = touched(t) || !had;
    const n = face(t);
    const fl = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k++) {
      const c = t * 3 + k;
      if (!fresh && had) {
        // Untouched: the file's own normal for this corner.
        out[c * 3] = had.getX(c);
        out[c * 3 + 1] = had.getY(c);
        out[c * 3 + 2] = had.getZ(c);
        continue;
      }
      const p = shape.corners[c]!;
      let x = pn[p * 3]!;
      let y = pn[p * 3 + 1]!;
      let z = pn[p * 3 + 2]!;
      const l = Math.hypot(x, y, z);
      // A sharp corner (the smooth normal far from the face's) keeps the face's own.
      if (!l || (x * n[0] + y * n[1] + z * n[2]) / (l * fl) < 0.6) {
        x = n[0];
        y = n[1];
        z = n[2];
      }
      const ll = Math.hypot(x, y, z) || 1;
      out[c * 3] = x / ll;
      out[c * 3 + 1] = y / ll;
      out[c * 3 + 2] = z / ll;
    }
  }
  return out;
}

/** Problems: meshes whose file changed under their edits (the edits are left off). */
export function applyMeshModels(meshes: readonly ImportedMesh[], models: Readonly<Record<string, MeshModel>>, problems: string[] = []): ImportedMesh[] {
  return meshes.map((m) => {
    const model = models[m.key];
    if (!model) return withBase(m, m.geometry);
    const topo = topologyOf(m.geometry);
    if (!modelFits(topo, model)) {
      problems.push(m.name);
      return withBase(m, m.geometry);
    }
    const geometry = buildShaped(m.geometry, shapeOf(topo, model), model);
    const out = withBase({ ...m, geometry, triangles: Math.floor(geometry.getAttribute('position').count / 3) }, m.geometry);
    return out;
  });
}

function withBase(m: ImportedMesh, base: BufferGeometry): ImportedMesh {
  if (m.geometry.userData.modelBase === base) return m;
  m.geometry.userData = { ...m.geometry.userData, modelBase: base };
  return m;
}
