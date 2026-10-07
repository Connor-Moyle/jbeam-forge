/**
 * Model writers for taking a car back out of JBeam Forge: Wavefront OBJ (with its .mtl), STL, PLY
 * and Autodesk FBX (binary 7.4). glTF and COLLADA have writers of their own; these cover what
 * other modelling programs, game engines, slicers and viewers read.
 *
 * Meshes come in BeamNG space (Z up, −Y forward, +X left, metres). OBJ and FBX are written Y up,
 * the way those files usually are (and FBX says so in its header); STL and PLY keep Z up, which is
 * what slicers and scan tools expect.
 */

export interface ModelMesh {
  name: string;
  /** The part it belongs to (an OBJ group, an FBX name prefix). */
  group: string;
  /** xyz per vertex, BeamNG space. */
  positions: ArrayLike<number>;
  /** xyz per vertex, or none (flat normals are worked out). */
  normals?: ArrayLike<number> | null;
  /** uv per vertex, v up (bottom-left origin), or none. */
  uvs?: ArrayLike<number> | null;
  /** Three per triangle. */
  indices: ArrayLike<number>;
  /** Which triangles have which material: runs of indices (start and count in `indices`) and an index into `materials`. */
  groups: readonly { start: number; count: number; material: number }[];
  /** Names of this mesh's materials (in `ModelScene.materials`). */
  materials: readonly string[];
}

export interface ModelMaterial {
  name: string;
  /** Linear RGBA, 0–1. */
  color: readonly [number, number, number, number];
}

export interface ModelScene {
  name: string;
  meshes: readonly ModelMesh[];
  materials: readonly ModelMaterial[];
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'unnamed';
const n6 = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(6)).toString() : '0');
/** BeamNG (Z up) → Y up: the same turn the viewport and glTF use. */
const yUp = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

function faceNormal(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3]! - p[a * 3]!;
  const uy = p[b * 3 + 1]! - p[a * 3 + 1]!;
  const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const vx = p[c * 3]! - p[a * 3]!;
  const vy = p[c * 3 + 1]! - p[a * 3 + 1]!;
  const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
  const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Each triangle's material index (the first material where no group covers it). */
function triangleMaterials(m: ModelMesh): Int32Array {
  const out = new Int32Array(Math.floor(m.indices.length / 3));
  for (const g of m.groups) for (let t = Math.floor(g.start / 3); t < Math.floor((g.start + g.count) / 3) && t < out.length; t++) out[t] = Math.max(0, Math.min(m.materials.length - 1, g.material));
  return out;
}

export function triangleCount(scene: ModelScene): number {
  return scene.meshes.reduce((s, m) => s + Math.floor(m.indices.length / 3), 0);
}

// ── OBJ ─────────────────────────────────────────────────────────────────────

/** Wavefront OBJ and its material library. One `o` per mesh, grouped by part, `usemtl` per material run. */
export function writeObj(scene: ModelScene, mtlFile: string): { obj: string; mtl: string } {
  const out: string[] = [`# ${scene.name}: exported by JBeam Forge`, `mtllib ${mtlFile}`];
  let v0 = 1;
  let vt0 = 1;
  let vn0 = 1;
  for (const m of scene.meshes) {
    const count = m.positions.length / 3;
    // The part as the group, then the mesh as the object: readers that keep one name keep the mesh's.
    out.push(`g ${safe(m.group)}`, `o ${safe(m.name)}`);
    for (let i = 0; i < count; i++) out.push(`v ${yUp(m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!).map(n6).join(' ')}`);
    const uv = m.uvs && m.uvs.length >= count * 2 ? m.uvs : null;
    if (uv) for (let i = 0; i < count; i++) out.push(`vt ${n6(uv[i * 2]!)} ${n6(uv[i * 2 + 1]!)}`);
    const nrm = m.normals && m.normals.length >= count * 3 ? m.normals : null;
    if (nrm) for (let i = 0; i < count; i++) out.push(`vn ${yUp(nrm[i * 3]!, nrm[i * 3 + 1]!, nrm[i * 3 + 2]!).map(n6).join(' ')}`);
    const mats = triangleMaterials(m);
    let current = -1;
    for (let t = 0; t < mats.length; t++) {
      if (mats[t] !== current) {
        current = mats[t]!;
        out.push(`usemtl ${safe(m.materials[current] ?? 'default')}`);
      }
      const corner = (k: number) => {
        const i = m.indices[t * 3 + k]!;
        return `${v0 + i}${uv || nrm ? `/${uv ? vt0 + i : ''}${nrm ? `/${vn0 + i}` : ''}` : ''}`;
      };
      out.push(`f ${corner(0)} ${corner(1)} ${corner(2)}`);
    }
    v0 += count;
    if (uv) vt0 += count;
    if (nrm) vn0 += count;
  }
  const mtl: string[] = [`# ${scene.name}: materials, exported by JBeam Forge`];
  for (const mat of scene.materials) mtl.push('', `newmtl ${safe(mat.name)}`, `Kd ${mat.color.slice(0, 3).map(n6).join(' ')}`, 'Ka 0 0 0', 'Ks 0.2 0.2 0.2', 'Ns 40', `d ${n6(mat.color[3])}`, 'illum 2');
  return { obj: `${out.join('\n')}\n`, mtl: `${mtl.join('\n')}\n` };
}

// ── STL ─────────────────────────────────────────────────────────────────────

/** Binary STL: every triangle of every mesh, Z up, in metres (STL has no units, names or materials). */
export function writeStl(scene: ModelScene): Uint8Array {
  const total = triangleCount(scene);
  const bytes = new Uint8Array(84 + total * 50);
  const view = new DataView(bytes.buffer);
  const header = `${scene.name} - JBeam Forge`.slice(0, 79);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i) & 0x7f;
  view.setUint32(80, total, true);
  let o = 84;
  for (const m of scene.meshes) {
    for (let t = 0; t + 2 < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      const n = faceNormal(m.positions, a, b, c);
      for (let k = 0; k < 3; k++) view.setFloat32(o + k * 4, n[k]!, true);
      for (const [j, v] of [a, b, c].entries()) for (let k = 0; k < 3; k++) view.setFloat32(o + 12 + j * 12 + k * 4, m.positions[v * 3 + k]!, true);
      o += 50;
    }
  }
  return bytes;
}

// ── PLY ─────────────────────────────────────────────────────────────────────

/** Binary PLY: one mesh of everything, Z up, with normals and each vertex coloured by its material. */
export function writePly(scene: ModelScene): Uint8Array {
  const colour = new Map(scene.materials.map((m) => [m.name, m.color]));
  let vertices = 0;
  for (const m of scene.meshes) vertices += m.positions.length / 3;
  const faces = triangleCount(scene);
  const header = `ply\nformat binary_little_endian 1.0\ncomment ${scene.name} - JBeam Forge\nelement vertex ${vertices}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${faces}\nproperty list uchar int vertex_indices\nend_header\n`;
  const bytes = new Uint8Array(header.length + vertices * 27 + faces * 13);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i) & 0x7f;
  const view = new DataView(bytes.buffer);
  let o = header.length;
  const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255)));
  for (const m of scene.meshes) {
    const count = m.positions.length / 3;
    // A vertex takes the colour of the first material that uses it.
    const mats = triangleMaterials(m);
    const vertexMaterial = new Int32Array(count).fill(-1);
    for (let t = 0; t < mats.length; t++) for (let k = 0; k < 3; k++) if (vertexMaterial[m.indices[t * 3 + k]!] === -1) vertexMaterial[m.indices[t * 3 + k]!] = mats[t]!;
    const flat = new Float32Array(count * 3);
    if (!m.normals || m.normals.length < count * 3)
      for (let t = 0; t + 2 < m.indices.length; t += 3) {
        const n = faceNormal(m.positions, m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!);
        for (let k = 0; k < 3; k++) flat.set(n, m.indices[t + k]! * 3);
      }
    const nrm = m.normals && m.normals.length >= count * 3 ? m.normals : flat;
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) view.setFloat32(o + k * 4, m.positions[i * 3 + k]!, true);
      for (let k = 0; k < 3; k++) view.setFloat32(o + 12 + k * 4, nrm[i * 3 + k]!, true);
      const c = colour.get(m.materials[Math.max(0, vertexMaterial[i]!)] ?? '') ?? [0.6, 0.6, 0.6, 1];
      bytes[o + 24] = to8(c[0]);
      bytes[o + 25] = to8(c[1]);
      bytes[o + 26] = to8(c[2]);
      o += 27;
    }
  }
  let base = 0;
  for (const m of scene.meshes) {
    for (let t = 0; t + 2 < m.indices.length; t += 3) {
      bytes[o] = 3;
      for (let k = 0; k < 3; k++) view.setInt32(o + 1 + k * 4, base + m.indices[t + k]!, true);
      o += 13;
    }
    base += m.positions.length / 3;
  }
  return bytes;
}

// ── FBX (binary 7.4) ────────────────────────────────────────────────────────

type FbxValue = { t: 'I' | 'L' | 'D' | 'C'; v: number } | { t: 'S'; v: string } | { t: 'd'; v: Float64Array } | { t: 'i'; v: Int32Array };
interface FbxNode {
  name: string;
  props: FbxValue[];
  children: FbxNode[];
}

const I = (v: number): FbxValue => ({ t: 'I', v });
const L = (v: number): FbxValue => ({ t: 'L', v });
const D = (v: number): FbxValue => ({ t: 'D', v });
const S = (v: string): FbxValue => ({ t: 'S', v });
const node = (name: string, props: FbxValue[] = [], children: FbxNode[] = []): FbxNode => ({ name, props, children });
/** A Properties70 entry: name, type, label, flags, then its values. */
const P = (name: string, type: string, label: string, flags: string, ...values: FbxValue[]): FbxNode => node('P', [S(name), S(type), S(label), S(flags), ...values]);

class Bytes {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void {
    this.room(1);
    this.buf[this.length++] = v;
  }
  u32(v: number): void {
    this.room(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
  }
  setU32(at: number, v: number): void {
    this.view.setUint32(at, v, true);
  }
  i32(v: number): void {
    this.room(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }
  i64(v: number): void {
    this.room(8);
    this.view.setBigInt64(this.length, BigInt(Math.trunc(v)), true);
    this.length += 8;
  }
  f64(v: number): void {
    this.room(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
  }
  text(s: string): void {
    this.room(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.length++] = s.charCodeAt(i) & 0xff;
  }
  zeros(n: number): void {
    this.room(n);
    this.length += n;
  }
  raw(b: ArrayLike<number>): void {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function writeFbxNode(out: Bytes, n: FbxNode): void {
  const start = out.length;
  out.u32(0); // end offset, filled in below
  out.u32(n.props.length);
  out.u32(0); // property list length, filled in below
  out.u8(n.name.length);
  out.text(n.name);
  const propsAt = out.length;
  for (const p of n.props) {
    out.text(p.t);
    if (p.t === 'I') out.i32(p.v);
    else if (p.t === 'L') out.i64(p.v);
    else if (p.t === 'D') out.f64(p.v);
    else if (p.t === 'C') out.u8(p.v ? 1 : 0);
    else if (p.t === 'S') {
      out.u32(p.v.length);
      out.text(p.v);
    } else if (p.t === 'd') {
      // An array: its length, 0 for "not compressed", its size in bytes, then the values.
      out.u32(p.v.length);
      out.u32(0);
      out.u32(p.v.length * 8);
      for (const v of p.v) out.f64(v);
    } else if (p.t === 'i') {
      out.u32(p.v.length);
      out.u32(0);
      out.u32(p.v.length * 4);
      for (const v of p.v) out.i32(v);
    }
  }
  out.setU32(start + 8, out.length - propsAt);
  if (n.children.length) {
    for (const c of n.children) writeFbxNode(out, c);
    out.zeros(13); // a nested list ends with an empty record
  }
  out.setU32(start, out.length);
}

/** Split vertices as FBX wants them: one normal and one UV per polygon corner. */
function fbxGeometry(id: number, m: ModelMesh): FbxNode {
  const count = m.positions.length / 3;
  const vertices = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) vertices.set(yUp(m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!), i * 3);
  const tris = Math.floor(m.indices.length / 3);
  const polygon = new Int32Array(tris * 3);
  const normals = new Float64Array(tris * 9);
  const hasNormals = !!m.normals && m.normals.length >= count * 3;
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [m.indices[t * 3]!, m.indices[t * 3 + 1]!, m.indices[t * 3 + 2]!];
    polygon[t * 3] = a;
    polygon[t * 3 + 1] = b;
    polygon[t * 3 + 2] = -c - 1; // the last corner of a polygon is written negative, less one
    const flat = hasNormals ? null : faceNormal(m.positions, a, b, c);
    for (const [k, v] of [a, b, c].entries()) normals.set(flat ? yUp(...flat) : yUp(m.normals![v * 3]!, m.normals![v * 3 + 1]!, m.normals![v * 3 + 2]!), t * 9 + k * 3);
  }
  const layers: FbxNode[] = [node('LayerElement', [], [node('Type', [S('LayerElementNormal')]), node('TypedIndex', [I(0)])])];
  const children: FbxNode[] = [
    node('Vertices', [{ t: 'd', v: vertices }]),
    node('PolygonVertexIndex', [{ t: 'i', v: polygon }]),
    node('GeometryVersion', [I(124)]),
    node('LayerElementNormal', [I(0)], [node('Version', [I(101)]), node('Name', [S('')]), node('MappingInformationType', [S('ByPolygonVertex')]), node('ReferenceInformationType', [S('Direct')]), node('Normals', [{ t: 'd', v: normals }])]),
  ];
  if (m.uvs && m.uvs.length >= count * 2) {
    const uv = new Float64Array(count * 2);
    for (let i = 0; i < count * 2; i++) uv[i] = m.uvs[i]!;
    const uvIndex = new Int32Array(tris * 3);
    for (let i = 0; i < tris * 3; i++) uvIndex[i] = m.indices[i]!;
    children.push(node('LayerElementUV', [I(0)], [node('Version', [I(101)]), node('Name', [S('UVMap')]), node('MappingInformationType', [S('ByPolygonVertex')]), node('ReferenceInformationType', [S('IndexToDirect')]), node('UV', [{ t: 'd', v: uv }]), node('UVIndex', [{ t: 'i', v: uvIndex }])]));
    layers.push(node('LayerElement', [], [node('Type', [S('LayerElementUV')]), node('TypedIndex', [I(0)])]));
  }
  const mats = triangleMaterials(m);
  const one = mats.every((x) => x === mats[0]);
  children.push(
    node('LayerElementMaterial', [I(0)], [node('Version', [I(101)]), node('Name', [S('')]), node('MappingInformationType', [S(one ? 'AllSame' : 'ByPolygon')]), node('ReferenceInformationType', [S('IndexToDirect')]), node('Materials', [{ t: 'i', v: one ? Int32Array.of(mats[0] ?? 0) : mats }])]),
  );
  layers.push(node('LayerElement', [], [node('Type', [S('LayerElementMaterial')]), node('TypedIndex', [I(0)])]));
  children.push(node('Layer', [I(0)], [node('Version', [I(100)]), ...layers]));
  return node('Geometry', [L(id), S(`${safe(m.name)}\x00\x01Geometry`), S('Mesh')], children);
}

/**
 * Autodesk FBX, binary, version 7.4: what Blender, Maya, 3ds Max, Unity and Unreal read. Every mesh
 * is a model of its own (named part.mesh) with its normals, UVs and materials; Y up, in metres.
 */
export function writeFbx(scene: ModelScene, now = new Date()): Uint8Array {
  let next = 1_000_000;
  const id = () => next++;
  const objects: FbxNode[] = [];
  const links: FbxNode[] = [];
  const materialIds = new Map<string, number>();
  for (const mat of scene.materials) {
    const mid = id();
    materialIds.set(mat.name, mid);
    objects.push(
      node('Material', [L(mid), S(`${safe(mat.name)}\x00\x01Material`), S('')], [
        node('Version', [I(102)]),
        node('ShadingModel', [S('phong')]),
        node('MultiLayer', [I(0)]),
        node('Properties70', [], [P('DiffuseColor', 'Color', '', 'A', D(mat.color[0]), D(mat.color[1]), D(mat.color[2])), P('Opacity', 'Number', '', 'A', D(mat.color[3])), P('Shininess', 'Number', '', 'A', D(20))]),
      ]),
    );
  }
  let models = 0;
  for (const m of scene.meshes) {
    if (m.indices.length < 3) continue;
    const gid = id();
    const mid = id();
    models++;
    objects.push(fbxGeometry(gid, m));
    // Named part.mesh; a mesh not yet in a part keeps its own name alone.
    const label = m.group && m.group !== 'Unassigned' ? `${safe(m.group)}.${safe(m.name)}` : safe(m.name);
    objects.push(node('Model', [L(mid), S(`${label}\x00\x01Model`), S('Mesh')], [node('Version', [I(232)]), node('Properties70', [], [P('DefaultAttributeIndex', 'int', 'Integer', '', I(0))]), node('Shading', [{ t: 'C', v: 1 }]), node('Culling', [S('CullingOff')])]));
    links.push(node('C', [S('OO'), L(mid), L(0)]), node('C', [S('OO'), L(gid), L(mid)]));
    // In the order the mesh numbers them: that is what its material indices count in.
    for (const name of m.materials) if (materialIds.has(name)) links.push(node('C', [S('OO'), L(materialIds.get(name)!), L(mid)]));
  }
  const stamp = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()];
  const definition = (type: string, count: number) => node('ObjectType', [S(type)], [node('Count', [I(count)])]);
  const top: FbxNode[] = [
    node('FBXHeaderExtension', [], [
      node('FBXHeaderVersion', [I(1003)]),
      node('FBXVersion', [I(7400)]),
      node('CreationTimeStamp', [], [node('Version', [I(1000)]), node('Year', [I(stamp[0]!)]), node('Month', [I(stamp[1]!)]), node('Day', [I(stamp[2]!)]), node('Hour', [I(stamp[3]!)]), node('Minute', [I(stamp[4]!)]), node('Second', [I(stamp[5]!)]), node('Millisecond', [I(0)])]),
      node('Creator', [S('JBeam Forge')]),
    ]),
    node('GlobalSettings', [], [
      node('Version', [I(1000)]),
      node('Properties70', [], [
        P('UpAxis', 'int', 'Integer', '', I(1)),
        P('UpAxisSign', 'int', 'Integer', '', I(1)),
        P('FrontAxis', 'int', 'Integer', '', I(2)),
        P('FrontAxisSign', 'int', 'Integer', '', I(1)),
        P('CoordAxis', 'int', 'Integer', '', I(0)),
        P('CoordAxisSign', 'int', 'Integer', '', I(1)),
        // A unit is a metre (FBX counts in centimetres).
        P('UnitScaleFactor', 'double', 'Number', '', D(100)),
        P('OriginalUnitScaleFactor', 'double', 'Number', '', D(100)),
      ]),
    ]),
    node('Documents', [], [node('Count', [I(1)]), node('Document', [L(id()), S('Scene'), S('Scene')], [node('RootNode', [L(0)])])]),
    node('References'),
    node('Definitions', [], [node('Version', [I(100)]), node('Count', [I(3)]), definition('Geometry', models), definition('Model', models), definition('Material', scene.materials.length)]),
    node('Objects', [], objects),
    node('Connections', [], links),
  ];
  const out = new Bytes();
  out.text('Kaydara FBX Binary  ');
  out.raw([0x00, 0x1a, 0x00]);
  out.u32(7400);
  for (const n of top) writeFbxNode(out, n);
  out.zeros(13);
  // The footer every reader skips over: an id, padding to 16 bytes, the version again and a closing mark.
  out.raw([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]);
  out.zeros(4);
  out.zeros((16 - (out.length % 16)) % 16);
  out.u32(7400);
  out.zeros(120);
  out.raw([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);
  return out.done();
}
