import { Mesh, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget, type Material, type Texture } from 'three';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import type { BakedMesh } from './normalize';
import { loadTextureFile } from './textures';

/**
 * Assetto Corsa multi-map materials mix two textures: where the diffuse alpha
 * is low, its colour is multiplied by the detail texture (that's where a
 * Kunos car's paint colour lives). Neither the viewport nor BeamNG materials
 * mix textures like that, so the pair is baked on the GPU into one PNG next to
 * the kn5's extracted textures, and the material uses that instead.
 */

const logger = rlog('import');
const MAX_SIZE = 4096;

const fragment = /* glsl */ `
uniform sampler2D map;
uniform sampler2D detail;
uniform float uvScale;
varying vec2 vUv;
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec4 base = texture2D(map, vUv);
  vec3 tint = texture2D(detail, vUv * uvScale).rgb;
  gl_FragColor = vec4(toSrgb(base.rgb * mix(tint, vec3(1.0), base.a)), 1.0);
}`;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

let bakeRenderer: WebGLRenderer | null = null;

function renderer(): WebGLRenderer {
  bakeRenderer ??= new WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  return bakeRenderer;
}

function sizeOf(tex: Texture): [number, number] {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const w = Math.min(MAX_SIZE, img?.width ?? 1024);
  const h = Math.min(MAX_SIZE, img?.height ?? 1024);
  return [w, h];
}

async function bakePair(map: Texture, detail: Texture, uvScale: number): Promise<Uint8Array> {
  const [w, h] = sizeOf(map);
  const target = new WebGLRenderTarget(w, h);
  const material = new ShaderMaterial({ uniforms: { map: { value: map }, detail: { value: detail }, uvScale: { value: uvScale } }, vertexShader: vertex, fragmentShader: fragment });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  const scene = new Scene();
  scene.add(quad);
  const r = renderer();
  try {
    r.setRenderTarget(target);
    r.render(scene, new OrthographicCamera());
    const pixels = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    // Rows come back v = 0 first, which is the image's first row for these (flipY = false) UVs.
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), w, h), 0, 0);
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    r.setRenderTarget(null);
    target.dispose();
    material.dispose();
    quad.geometry.dispose();
  }
}

const safe = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');

/** Bake every multi-map material of an imported kn5 (materials are shared, so each pair is baked once). */
export async function bakeAcDetail(meshes: readonly BakedMesh[], kn5Path: string): Promise<number> {
  const materials = new Set<Material>();
  for (const m of meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
  const done = new Map<string, Texture>();
  let baked = 0;
  for (const mat of materials) {
    const info = mat.userData.acDetail as { uvScale: number } | undefined;
    if (!info || !(mat instanceof MeshStandardMaterial)) continue;
    const { map, emissiveMap: detail } = mat;
    mat.emissiveMap = null;
    delete mat.userData.acDetail;
    const mapPath = map?.userData.sourcePath as string | undefined;
    const detailPath = detail?.userData.sourcePath as string | undefined;
    if (!map || !detail || !mapPath || !detailPath) continue;
    const name = `${safe(mapPath.split(/[\\/]/).pop()!)}__${safe(detailPath.split(/[\\/]/).pop()!)}${info.uvScale === 1 ? '' : `_x${info.uvScale}`}.png`;
    try {
      let tex = done.get(name);
      if (!tex) {
        const png = await bakePair(map, detail, info.uvScale);
        const path = await call('kn5:saveBaked', { kn5Path, name, bytes: png });
        const loaded = await loadTextureFile(path, png, true, false);
        if ('error' in loaded) throw new Error(loaded.error);
        loaded.userData.sourceRef = name;
        tex = loaded;
        done.set(name, tex);
        baked++;
      }
      mat.map = tex;
      mat.needsUpdate = true;
    } catch (err) {
      logger.warn(`could not bake ${name}:`, err instanceof Error ? err.message : String(err));
    }
  }
  return baked;
}
