import { Color, SRGBColorSpace, Vector3, type MeshPhysicalMaterial, type Texture } from 'three';
import { resolvePaints } from '@shared/paints/paints';
import type { Paint, Project } from '@shared/project/schema';

/**
 * How paint looks in the viewport, the way the game does it: each point of a
 * paint material takes the three paint slots mixed by its colour palette mask
 * (red = slot 1, green = 2, blue = 3): colour, metallic, roughness and clear
 * coat per slot. A livery (the second layer's colour texture) goes on top by
 * its alpha. The slots' uniforms are shared by every paint material, so
 * changing a paint recolours the car without rebuilding anything.
 */

const slot = () => ({ color: new Color(0.7, 0.7, 0.7), pbr: new Vector3(0, 0.4, 1), coat: 0.04 });

export const paintUniforms = {
  paintColor: { value: [slot().color, slot().color, slot().color] },
  /** metallic, roughness, clear coat */
  paintPbr: { value: [slot().pbr, slot().pbr, slot().pbr] },
  paintCoatRough: { value: [0.04, 0.04, 0.04] },
};

/** Whether the project has paints: without any, paint materials show their own colour as before. */
let active = false;
export const paintPreviewActive = () => active;

export function setPreviewPaints(slots: readonly [Paint, Paint, Paint] | null): void {
  active = !!slots;
  if (!slots) return;
  slots.forEach((p, i) => {
    paintUniforms.paintColor.value[i]!.setRGB(p.color[0], p.color[1], p.color[2], SRGBColorSpace);
    paintUniforms.paintPbr.value[i]!.set(p.metallic, p.roughness, p.clearcoat);
    paintUniforms.paintCoatRough.value[i] = Math.max(0.0089, p.clearcoatRoughness);
  });
}

/** Follow the project: the previewed configuration's paints, else the factory defaults. */
export function syncPreviewPaints(doc: Pick<Project, 'paints' | 'configs'> | null, previewConfigId: string | null): void {
  if (!doc) return setPreviewPaints(null);
  const config = previewConfigId ? (doc.configs.find((c) => c.id === previewConfigId) ?? null) : null;
  setPreviewPaints(resolvePaints(doc, config));
}

const PARS = /* glsl */ `
uniform vec3 paintColor[3];
uniform vec3 paintPbr[3];
uniform float paintCoatRough[3];
uniform sampler2D paintMask;
uniform bool paintHasMask;
uniform sampler2D paintLivery;
uniform bool paintHasLivery;
`;

const MAP = /* glsl */ `
vec3 paintW = paintHasMask ? texture2D(paintMask, vUv).rgb : vec3(1.0, 0.0, 0.0);
float paintSum = paintW.r + paintW.g + paintW.b;
paintW = paintSum > 0.001 ? paintW / paintSum : vec3(1.0, 0.0, 0.0);
diffuseColor.rgb = paintColor[0] * paintW.r + paintColor[1] * paintW.g + paintColor[2] * paintW.b;
float paintLiveryA = 0.0;
if (paintHasLivery) {
  vec4 liveryTexel = texture2D(paintLivery, vUv);
  paintLiveryA = liveryTexel.a;
  diffuseColor.rgb = mix(diffuseColor.rgb, liveryTexel.rgb, liveryTexel.a);
}
`;

const pick = (c: 'x' | 'y' | 'z') => `dot(paintW, vec3(paintPbr[0].${c}, paintPbr[1].${c}, paintPbr[2].${c}))`;

/**
 * Make a physical material draw like a BeamNG paint material. `mask` is the
 * colour palette mask (null: all slot 1), `livery` the second layer's colour.
 */
export function applyPaintShader(m: MeshPhysicalMaterial, mask: Texture | null, livery: Texture | null): void {
  m.defines = { ...(m.defines ?? {}), USE_UV: '' };
  // Clear coat on so the shader has it; the per-slot amount comes from the uniforms.
  m.clearcoat = 1;
  const own = { paintMask: { value: mask }, paintHasMask: { value: !!mask }, paintLivery: { value: livery }, paintHasLivery: { value: !!livery } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, paintUniforms, own);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${MAP}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(${pick('y')}, roughnessFactor, paintLiveryA);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = mix(${pick('x')}, metalnessFactor, paintLiveryA);`)
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = ${pick('z')};\nmaterial.clearcoatRoughness = clamp(dot(paintW, vec3(paintCoatRough[0], paintCoatRough[1], paintCoatRough[2])), 0.0089, 1.0);\n#endif`,
      );
  };
  m.customProgramCacheKey = () => `paint:${!!mask}:${!!livery}`;
  m.userData.paint = own;
}
