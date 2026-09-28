import { CanvasTexture, Color, MeshBasicMaterial, MeshNormalMaterial, RepeatWrapping, ShaderMaterial, SRGBColorSpace, type Material, type MeshPhysicalMaterial, type Texture } from 'three';

/**
 * The viewport's channel views: one aspect of every material at a time, to
 * check textures and settings the way a material artist does: the flat base
 * colour, roughness, metallic and ambient occlusion as greys (their maps'
 * channels times the factors), the surface normals, and a UV checker that
 * shows how textures will stretch or tile.
 */

export type Channel = 'shaded' | 'basecolor' | 'roughness' | 'metallic' | 'ao' | 'normals' | 'uv';

export const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'shaded', label: 'Shaded' },
  { value: 'basecolor', label: 'Base colour' },
  { value: 'roughness', label: 'Roughness' },
  { value: 'metallic', label: 'Metallic' },
  { value: 'ao', label: 'Ambient occlusion' },
  { value: 'normals', label: 'Normals' },
  { value: 'uv', label: 'UV checker' },
];

const GREY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GREY_FRAG = /* glsl */ `
uniform sampler2D map;
uniform bool hasMap;
uniform float value;
uniform int channel;
varying vec2 vUv;
void main() {
  float v = value;
  if (hasMap) {
    vec4 t = texture2D(map, vUv);
    v *= channel == 0 ? t.r : channel == 1 ? t.g : t.b;
  }
  gl_FragColor = vec4(vec3(v), 1.0);
}`;

/** A grey view of one value: its factor times a map's channel (three.js packs roughness in green, metalness in blue, AO in red). */
function greyMaterial(value: number, map: Texture | null, channel: 0 | 1 | 2): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: GREY_VERT, fragmentShader: GREY_FRAG, uniforms: { map: { value: map }, hasMap: { value: !!map }, value: { value }, channel: { value: channel } } });
}

let normals: MeshNormalMaterial | null = null;
let checker: MeshBasicMaterial | null = null;

/** A numbered checker, 8 × 8 squares over the whole 0–1 texture space. */
function checkerTexture(): CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const n = 8;
  const cell = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Hue along u, lightness along v, so a mirrored or turned island is easy to spot.
      const light = (x + y) % 2 ? 62 : 38;
      g.fillStyle = `hsl(${Math.round((x / n) * 300)}, 55%, ${light - y * 2}%)`; // token-lint-ignore: texture pixels, not UI colour
      g.fillRect(x * cell, y * cell, cell, cell);
      g.fillStyle = CHECKER_TEXT;
      g.font = `bold ${Math.round(cell * 0.32)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${String.fromCharCode(65 + x)}${n - y}`, x * cell + cell / 2, y * cell + cell / 2);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const CHECKER_TEXT = '#ffffff'; // token-lint-ignore: texture pixels, not UI colour

const cache = new WeakMap<Material, Map<Channel, Material>>();

/** The view of a material in a channel (made once per material and channel). */
export function channelMaterial(src: Material, channel: Channel): Material {
  if (channel === 'shaded') return src;
  if (channel === 'normals') return (normals ??= new MeshNormalMaterial());
  if (channel === 'uv') return (checker ??= new MeshBasicMaterial({ map: checkerTexture() }));
  let per = cache.get(src);
  if (!per) {
    per = new Map();
    cache.set(src, per);
  }
  const have = per.get(channel);
  if (have) return have;
  const m = src as Partial<MeshPhysicalMaterial>;
  let out: Material;
  if (channel === 'basecolor') out = new MeshBasicMaterial({ color: m.color ? m.color.clone() : new Color(1, 1, 1), map: m.map ?? null, side: src.side });
  else if (channel === 'roughness') out = greyMaterial(m.roughness ?? 1, m.roughnessMap ?? null, 1);
  else if (channel === 'metallic') out = greyMaterial(m.metalness ?? 0, m.metalnessMap ?? null, 2);
  else out = greyMaterial(1, m.aoMap ?? null, 0);
  out.side = src.side;
  per.set(channel, out);
  return out;
}

/** The same for a mesh's material or materials. */
export function channelMaterials(src: Material | Material[], channel: Channel): Material | Material[] {
  return Array.isArray(src) ? src.map((m) => channelMaterial(m, channel)) : channelMaterial(src, channel);
}
