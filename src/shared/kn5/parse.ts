/**
 * Assetto Corsa .kn5 reader. A kn5 holds a car's (or track object's) textures,
 * materials and a node tree of meshes in one little-endian binary file:
 *
 *   "sc6969" · version:i32 [· extra:i32 when version > 5]
 *   textures:  count · { active:i32 · name · size:i32 · bytes (DDS/PNG) }
 *   materials: count · { name · shader · blend:u8 · alphaTested:u8 · depthMode:i32
 *                        · props { name · a:f32 · b:f32×2 · c:f32×3 · d:f32×4 }
 *                        · samplers { name · slot:i32 · texture } }
 *   node (recursive): kind:i32 · name · children:i32 · active:u8 · body · children…
 *
 * Strings are i32 length + UTF-8. Matrices are 16 floats, row-major with the
 * translation in the last row: the same memory order three.js reads with
 * Matrix4.fromArray. UVs have v = 0 at the top (DirectX), like glTF.
 */

export interface Kn5Texture {
  name: string;
  /** View into the file bytes (not copied). */
  data: Uint8Array;
}

export interface Kn5Property {
  a: number;
  b: [number, number];
  c: [number, number, number];
  d: [number, number, number, number];
}

export interface Kn5Material {
  name: string;
  shader: string;
  /** 0 opaque, 1 alpha blend, 2 alpha to coverage. */
  blendMode: number;
  alphaTested: boolean;
  depthMode: number;
  props: Record<string, Kn5Property>;
  /** Sampler name (txDiffuse, txNormal, txMaps, txDetail…) → texture name. */
  samplers: Record<string, string>;
}

interface Kn5NodeBase {
  name: string;
  active: boolean;
  children: Kn5Node[];
}

export interface Kn5Group extends Kn5NodeBase {
  kind: 'group';
  matrix: number[];
}

export interface Kn5Mesh extends Kn5NodeBase {
  kind: 'mesh';
  skinned: boolean;
  visible: boolean;
  transparent: boolean;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  material: number;
  lodIn: number;
  lodOut: number;
}

export type Kn5Node = Kn5Group | Kn5Mesh;

export interface Kn5File {
  version: number;
  textures: Kn5Texture[];
  materials: Kn5Material[];
  root: Kn5Node;
}

const MAGIC = 'sc6969';
const NODE_GROUP = 1;
const NODE_MESH = 2;
const NODE_SKINNED = 3;

class Reader {
  private readonly view: DataView;
  private readonly utf8 = new TextDecoder('utf-8');
  pos = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.byteLength) throw new Error(`kn5 ends early (wanted ${n} bytes at ${this.pos} of ${this.bytes.byteLength})`);
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  count(what: string, max: number): number {
    const n = this.i32();
    if (n < 0 || n > max) throw new Error(`kn5 has an impossible ${what} count (${n})`);
    return n;
  }

  str(): string {
    const n = this.count('string length', 65_536);
    this.need(n);
    const s = this.utf8.decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }

  bytesView(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
}

export function isKn5(bytes: Uint8Array): boolean {
  return bytes.byteLength > 10 && String.fromCharCode(...bytes.subarray(0, 6)) === MAGIC;
}

/** Parse a kn5. `withTextures: false` skips over the texture data (only names are kept, data is empty). */
export function parseKn5(bytes: Uint8Array, opts: { withTextures?: boolean } = {}): Kn5File {
  if (!isKn5(bytes)) throw new Error('Not a kn5 file (missing the sc6969 header)');
  const r = new Reader(bytes);
  r.skip(6);
  const version = r.i32();
  if (version > 5) r.i32();

  const textures: Kn5Texture[] = [];
  const textureCount = r.count('texture', 100_000);
  for (let i = 0; i < textureCount; i++) {
    r.i32(); // active
    const name = r.str();
    const size = r.count('texture size', bytes.byteLength);
    if (opts.withTextures === false) {
      r.skip(size);
      textures.push({ name, data: new Uint8Array(0) });
    } else textures.push({ name, data: r.bytesView(size) });
  }

  const materials: Kn5Material[] = [];
  const materialCount = r.count('material', 100_000);
  for (let i = 0; i < materialCount; i++) {
    const name = r.str();
    const shader = r.str();
    const blendMode = r.u8();
    const alphaTested = r.u8() !== 0;
    const depthMode = version > 4 ? r.i32() : 0;
    const props: Record<string, Kn5Property> = {};
    const propCount = r.count('material property', 10_000);
    for (let p = 0; p < propCount; p++) {
      const key = r.str();
      props[key] = { a: r.f32(), b: [r.f32(), r.f32()], c: [r.f32(), r.f32(), r.f32()], d: [r.f32(), r.f32(), r.f32(), r.f32()] };
    }
    const samplers: Record<string, string> = {};
    const samplerCount = r.count('sampler', 10_000);
    for (let s = 0; s < samplerCount; s++) {
      const key = r.str();
      r.i32(); // slot
      samplers[key] = r.str();
    }
    materials.push({ name, shader, blendMode, alphaTested, depthMode, props, samplers });
  }

  const root = readNode(r, 0);
  return { version, textures, materials, root };
}

function readNode(r: Reader, depth: number): Kn5Node {
  if (depth > 256) throw new Error('kn5 node tree is too deep');
  const kind = r.i32();
  const name = r.str();
  const childCount = r.count('child node', 1_000_000);
  const active = r.u8() !== 0;
  let node: Kn5Node;
  if (kind === NODE_GROUP) {
    const matrix: number[] = [];
    for (let i = 0; i < 16; i++) matrix.push(r.f32());
    node = { kind: 'group', name, active, matrix, children: [] };
  } else if (kind === NODE_MESH || kind === NODE_SKINNED) {
    node = readMesh(r, name, active, kind === NODE_SKINNED);
  } else {
    throw new Error(`kn5 node "${name}" has an unknown type (${kind})`);
  }
  for (let i = 0; i < childCount; i++) node.children.push(readNode(r, depth + 1));
  return node;
}

function readMesh(r: Reader, name: string, active: boolean, skinned: boolean): Kn5Mesh {
  r.u8(); // casts shadows
  const visible = r.u8() !== 0;
  const transparent = r.u8() !== 0;
  if (skinned) {
    const bones = r.count('bone', 10_000);
    for (let i = 0; i < bones; i++) {
      r.str();
      r.skip(64);
    }
  }
  const vertexCount = r.count('vertex', 10_000_000);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v++) {
    positions[v * 3] = r.f32();
    positions[v * 3 + 1] = r.f32();
    positions[v * 3 + 2] = r.f32();
    normals[v * 3] = r.f32();
    normals[v * 3 + 1] = r.f32();
    normals[v * 3 + 2] = r.f32();
    uvs[v * 2] = r.f32();
    uvs[v * 2 + 1] = r.f32();
    r.skip(12); // tangent
    if (skinned) r.skip(32); // bone weights + bone indices
  }
  const indexCount = r.count('index', 30_000_000);
  const raw = r.bytesView(indexCount * 2);
  const indices = new Uint16Array(indexCount);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < indexCount; i++) indices[i] = view.getUint16(i * 2, true);
  const material = r.i32();
  r.i32(); // layer
  let lodIn = 0;
  let lodOut = 0;
  if (skinned) {
    r.skip(8);
  } else {
    lodIn = r.f32();
    lodOut = r.f32();
    r.skip(16); // bounding sphere
    r.u8(); // renderable
  }
  return { kind: 'mesh', name, active, skinned, visible, transparent, positions, normals, uvs, indices, material, lodIn, lodOut, children: [] };
}
