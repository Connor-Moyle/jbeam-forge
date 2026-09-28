import { describe, expect, it } from 'vitest';
import { DataTexture, MeshNormalMaterial, MeshPhysicalMaterial, ShaderMaterial } from 'three';
import { channelMaterial, channelMaterials } from '../../src/renderer/panels/viewport/channels';

describe('viewport channel views', () => {
  const tex = new DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
  const src = new MeshPhysicalMaterial({ roughness: 0.4, metalness: 0.8, roughnessMap: tex });

  it('shows each channel as its factor times the map channel three.js reads', () => {
    const r = channelMaterial(src, 'roughness') as ShaderMaterial;
    expect(r.uniforms.value!.value).toBe(0.4);
    expect(r.uniforms.map!.value).toBe(tex);
    expect(r.uniforms.channel!.value).toBe(1); // green
    const m = channelMaterial(src, 'metallic') as ShaderMaterial;
    expect(m.uniforms.value!.value).toBe(0.8);
    expect(m.uniforms.hasMap!.value).toBe(false);
    expect(channelMaterial(src, 'normals')).toBeInstanceOf(MeshNormalMaterial);
  });

  it('keeps the shaded material, and makes each view once', () => {
    expect(channelMaterial(src, 'shaded')).toBe(src);
    expect(channelMaterial(src, 'roughness')).toBe(channelMaterial(src, 'roughness'));
    const arr = channelMaterials([src, src], 'basecolor') as unknown[];
    expect(arr).toHaveLength(2);
    expect(arr[0]).toBe(arr[1]);
  });
});
