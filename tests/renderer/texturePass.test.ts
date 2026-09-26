import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, CompressedTexture, MeshStandardMaterial, Texture } from 'three';
import { applyTextures, ALL_CAPS } from '../../src/renderer/import/textures';
import { bypassColladaTga, REF_MARKER, refFromPlaceholder } from '../../src/renderer/import/loaders';
import { disposeImported } from '../../src/renderer/import/dispose';
import { mipByteSize } from '../../src/renderer/import/dds';

function placeholder(ref: string, flipY = true): Texture {
  const t = new Texture({ src: `data:image/png;base64,AAAA${REF_MARKER}${encodeURIComponent(ref)}` } as unknown as HTMLImageElement);
  t.flipY = flipY;
  return t;
}

/** Minimal valid DX10 BC7 DDS (one 4×4 mip). */
function bc7Dds(): Uint8Array {
  const bytes = new Uint8Array(148 + mipByteSize('bc7', 4, 4));
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x20534444, true);
  v.setUint32(12, 4, true);
  v.setUint32(16, 4, true);
  v.setUint32(80, 0x4, true);
  v.setUint32(84, 0x30315844, true); // 'DX10'
  v.setUint32(128, 99, true); // BC7_UNORM_SRGB
  v.setUint32(132, 3, true);
  v.setUint32(140, 1, true);
  return bytes;
}

const io = (files: Record<string, Uint8Array | null>) => ({
  resolve: (refs: string[]) => Promise.resolve({ resolved: Object.fromEntries(refs.map((r) => [r, files[r] ? `C:/t/${r}` : null])), truncated: false }),
  read: (p: string) => Promise.resolve(files[p.replace('C:/t/', '')]!),
});

describe('texture pass', () => {
  it('uploads BC7 DDS and flips V for loaders that expect flipped images (COLLADA)', async () => {
    const mat = new MeshStandardMaterial({ map: placeholder('body.dds', true) });
    const report = await applyTextures([mat], io({ 'body.dds': bc7Dds() }));
    expect(report).toMatchObject({ loaded: 1, missing: [], unsupported: [] });
    expect(mat.map).toBeInstanceOf(CompressedTexture);
    expect(mat.map!.repeat.y).toBe(-1);
    expect(mat.map!.offset.y).toBe(1);
  });

  it('does not flip V for glTF-style slots (flipY false)', async () => {
    const mat = new MeshStandardMaterial({ map: placeholder('body.dds', false) });
    await applyTextures([mat], io({ 'body.dds': bc7Dds() }));
    expect(mat.map!.repeat.y).toBe(1);
    expect(mat.map!.offset.y).toBe(0);
  });

  it('reports BC7 as unsupported when the GPU lacks it, and clears the slot', async () => {
    const mat = new MeshStandardMaterial({ map: placeholder('body.dds') });
    const report = await applyTextures([mat], io({ 'body.dds': bc7Dds() }), { ...ALL_CAPS, bc7: false });
    expect(report.unsupported).toEqual([{ ref: 'body.dds', reason: expect.stringMatching(/BC7/) }]);
    expect(mat.map).toBeNull();
  });

  it('reports missing references and clears their slots (no black placeholder)', async () => {
    const mat = new MeshStandardMaterial({ map: placeholder('gone.png'), normalMap: placeholder('gone.png') });
    const report = await applyTextures([mat], io({}));
    expect(report.missing).toEqual(['gone.png']);
    expect(mat.map).toBeNull();
    expect(mat.normalMap).toBeNull();
  });
});

describe('COLLADA TGA bypass', () => {
  it('suffixes .tga image references and strips the suffix when read back', () => {
    const dae = '<image id="a"><init_from>textures/paint.TGA</init_from></image><newparam><init_from>a</init_from></newparam>';
    const out = bypassColladaTga(dae);
    expect(out).toContain('<init_from>textures/paint.TGA.jbf-img</init_from>');
    expect(out).toContain('<init_from>a</init_from>'); // effect references untouched
    expect(refFromPlaceholder(`data:x${REF_MARKER}${encodeURIComponent('textures/paint.TGA.jbf-img')}`)).toBe('textures/paint.TGA');
  });
});

describe('disposeImported', () => {
  it('frees geometry, materials and their textures', () => {
    const geometry = new BufferGeometry();
    const map = new Texture();
    const material = new MeshStandardMaterial({ map });
    const spies = [vi.spyOn(geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(map, 'dispose')];
    disposeImported([{ key: 's:a', sourceId: 's', name: 'a', geometry, material, triangles: 0 }]);
    for (const s of spies) expect(s).toHaveBeenCalledOnce();
  });
});
