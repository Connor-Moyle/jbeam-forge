import { describe, expect, it } from 'vitest';
import { isKn5, parseKn5 } from '@shared/kn5/parse';

/** A tiny kn5 writer, just enough to build test files. */
class Writer {
  private parts: number[] = [];
  i32(v: number): this {
    const b = new DataView(new ArrayBuffer(4));
    b.setInt32(0, v, true);
    this.parts.push(...new Uint8Array(b.buffer));
    return this;
  }
  f32(...vs: number[]): this {
    for (const v of vs) {
      const b = new DataView(new ArrayBuffer(4));
      b.setFloat32(0, v, true);
      this.parts.push(...new Uint8Array(b.buffer));
    }
    return this;
  }
  u8(v: number): this {
    this.parts.push(v);
    return this;
  }
  u16(v: number): this {
    this.parts.push(v & 0xff, v >> 8);
    return this;
  }
  str(s: string): this {
    const b = new TextEncoder().encode(s);
    this.i32(b.length);
    this.parts.push(...b);
    return this;
  }
  raw(b: ArrayLike<number>): this {
    this.parts.push(...Array.from(b));
    return this;
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function sampleKn5(version = 6, skinned = false): Uint8Array {
  const w = new Writer().raw(new TextEncoder().encode('sc6969')).i32(version);
  if (version > 5) w.i32(0);
  // textures
  w.i32(1).i32(1).str('paint.dds').i32(4).raw([0x44, 0x44, 0x53, 0x20]);
  // materials
  w.i32(1).str('car_paint').str('ksPerPixelMultiMap').u8(1).u8(1);
  if (version > 4) w.i32(0);
  w.i32(2);
  w.str('ksSpecularEXP').f32(40, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  w.str('ksEmissive').f32(0, 0, 0, 2, 1, 0.5, 0, 0, 0, 0);
  w.i32(1).str('txDiffuse').i32(0).str('paint.dds');
  // root group with one mesh child
  w.i32(1).str('root').i32(1).u8(1).f32(...IDENTITY.slice(0, 12), 1, 2, 3, 1);
  w.i32(skinned ? 3 : 2).str('body').i32(0).u8(1);
  w.u8(1).u8(1).u8(0);
  if (skinned) w.i32(1).str('bone').f32(...IDENTITY);
  w.i32(3);
  for (let v = 0; v < 3; v++) {
    w.f32(v, v * 2, v * 3).f32(0, 1, 0).f32(v / 2, 1 - v / 2).f32(1, 0, 0);
    if (skinned) w.f32(1, 0, 0, 0, 0, 0, 0, 0);
  }
  w.i32(3).u16(0).u16(1).u16(2);
  w.i32(0).i32(0);
  if (skinned) w.raw(new Array(8).fill(0));
  else w.f32(0, 500).f32(0, 0, 0, 1).u8(1);
  return w.bytes();
}

describe('kn5 reader', () => {
  it('reads textures, materials and the node tree', () => {
    const kn5 = parseKn5(sampleKn5());
    expect(kn5.version).toBe(6);
    expect(kn5.textures).toHaveLength(1);
    expect(kn5.textures[0]!.name).toBe('paint.dds');
    expect(Array.from(kn5.textures[0]!.data)).toEqual([0x44, 0x44, 0x53, 0x20]);
    const m = kn5.materials[0]!;
    expect(m).toMatchObject({ name: 'car_paint', shader: 'ksPerPixelMultiMap', blendMode: 1, alphaTested: true, samplers: { txDiffuse: 'paint.dds' } });
    expect(m.props.ksSpecularEXP!.a).toBe(40);
    expect(m.props.ksEmissive!.c).toEqual([2, 1, 0.5]);
    const root = kn5.root;
    expect(root.kind).toBe('group');
    if (root.kind !== 'group') return;
    expect(root.matrix.slice(12)).toEqual([1, 2, 3, 1]);
    const body = root.children[0]!;
    expect(body.kind).toBe('mesh');
    if (body.kind !== 'mesh') return;
    expect(Array.from(body.positions)).toEqual([0, 0, 0, 1, 2, 3, 2, 4, 6]);
    expect(Array.from(body.uvs)).toEqual([0, 1, 0.5, 0.5, 1, 0]);
    expect(Array.from(body.indices)).toEqual([0, 1, 2]);
    expect(body).toMatchObject({ material: 0, visible: true, transparent: false, lodOut: 500, skinned: false });
  });

  it('reads version 5 files (no extra header field)', () => {
    expect(parseKn5(sampleKn5(5)).materials[0]!.name).toBe('car_paint');
  });

  it('reads skinned meshes, skipping bones and weights', () => {
    const body = parseKn5(sampleKn5(6, true)).root.children[0]!;
    expect(body.kind === 'mesh' && body.skinned).toBe(true);
    if (body.kind === 'mesh') expect(Array.from(body.positions.slice(3, 6))).toEqual([1, 2, 3]);
  });

  it('can skip texture data', () => {
    const kn5 = parseKn5(sampleKn5(), { withTextures: false });
    expect(kn5.textures[0]!.name).toBe('paint.dds');
    expect(kn5.textures[0]!.data.byteLength).toBe(0);
  });

  it('rejects files that are not kn5 or are cut short', () => {
    expect(isKn5(new TextEncoder().encode('glTF........'))).toBe(false);
    expect(() => parseKn5(new TextEncoder().encode('not a kn5 file'))).toThrow(/sc6969/);
    const full = sampleKn5();
    expect(() => parseKn5(full.subarray(0, full.length - 10))).toThrow(/ends early/);
  });
});
