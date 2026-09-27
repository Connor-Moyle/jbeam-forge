import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, SRGBColorSpace, Texture, type Material } from 'three';
import { create } from 'zustand';
import type { MaterialDef, MaterialLayer, TextureSlot } from '@shared/materials/schema';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import type { ImportedMesh } from '@renderer/import/normalize';
import { loadTextureFile } from '@renderer/import/textures';

/**
 * Turns project materials into what the viewport draws. Textures are cached
 * by file path: ones an import already decoded are reused as-is (their UV
 * orientation is already right), others are read and decoded on demand.
 */

const logger = rlog('materials');

const COLOR_SLOTS = new Set<TextureSlot>(['baseColorMap', 'emissiveMap']);
const textures = new Map<string, Texture | null>(); // null = failed or loading
const loading = new Set<string>();

/** Bumped whenever a texture finishes loading, so views rebuild materials. */
export const useTextureVersion = create<{ version: number; bump: () => void }>()((set) => ({ version: 0, bump: () => set((s) => ({ version: s.version + 1 })) }));

/** Remember the textures an import decoded, keyed by their file. */
export function registerImportedTextures(meshes: readonly ImportedMesh[]): void {
  for (const mesh of meshes) {
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(mat)) {
        const path = value instanceof Texture ? (value.userData.sourcePath as string | undefined) : undefined;
        if (path && !textures.get(path)) textures.set(path, value as Texture);
      }
    }
  }
}

const pending = new Map<string, Promise<void>>();

function texture(path: string, slot: TextureSlot): Texture | null {
  const known = textures.get(path);
  if (known !== undefined) return known;
  if (!loading.has(path)) {
    loading.add(path);
    const job = (async () => {
      try {
        const bytes = await call('import:readFile', { path });
        const tex = await loadTextureFile(path, bytes, COLOR_SLOTS.has(slot), true);
        if ('error' in tex) {
          logger.warn(`texture ${path}: ${tex.error}`);
          textures.set(path, null);
        } else textures.set(path, tex);
      } catch (err) {
        logger.warn(`texture ${path}:`, err instanceof Error ? err.message : String(err));
        textures.set(path, null);
      } finally {
        loading.delete(path);
        pending.delete(path);
        useTextureVersion.getState().bump();
      }
    })();
    pending.set(path, job);
  }
  return null;
}

/** Resolves once every texture the material uses has loaded (or failed): for previews that render once. */
export async function texturesReady(def: MaterialDef): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const layer of def.layers) {
    for (const [slot, path] of Object.entries(layer.maps) as [TextureSlot, string][]) {
      if (path.startsWith('/vehicles/')) continue;
      texture(path, slot);
      const job = pending.get(path);
      if (job) jobs.push(job);
    }
  }
  await Promise.all(jobs);
}

/** The layer the viewport shows: the one carrying the base colour texture, else the first. */
export function previewLayer(def: MaterialDef): MaterialLayer {
  return def.layers.find((l) => l.maps.baseColorMap) ?? def.layers[0]!;
}

function srgb(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, SRGBColorSpace);
}

/** A three.js material that looks like the project material (approximately: BeamNG's renderer differs). */
export function buildMaterial(def: MaterialDef): Material {
  const layer = previewLayer(def);
  const top = def.layers[0]!;
  const map = (slot: TextureSlot) => {
    const path = layer.maps[slot] ?? (def.paint ? top.maps[slot] : undefined);
    return path && !path.startsWith('/vehicles/') ? texture(path, slot) : null;
  };
  const [r, g, b, a] = def.paint ? top.baseColor : layer.baseColor;
  const clearCoat = def.paint ? top.clearCoat : layer.clearCoat;
  const m = new MeshPhysicalMaterial({
    name: def.name,
    color: srgb(r, g, b),
    metalness: layer.metallic,
    roughness: layer.roughness,
    clearcoat: clearCoat,
    clearcoatRoughness: def.paint ? top.clearCoatRoughness : layer.clearCoatRoughness,
    emissive: layer.emissiveIntensity > 0 ? srgb(...layer.emissive) : new Color(0, 0, 0),
    emissiveIntensity: layer.emissiveIntensity > 0 ? Math.min(4, 0.5 + Math.log10(1 + layer.emissiveIntensity)) : 1,
    opacity: layer.opacity * a,
    transparent: def.translucent || layer.opacity * a < 1,
    alphaTest: def.alphaTest ? def.alphaRef / 255 : 0,
    side: def.doubleSided ? DoubleSide : FrontSide,
    depthWrite: !def.translucent || def.translucentZWrite,
  });
  // Paint shows the paint colour over the base texture's shading.
  if (!def.paint) m.map = map('baseColorMap');
  m.normalMap = map('normalMap');
  m.normalScale.setScalar(layer.normalStrength);
  m.metalnessMap = map('metallicMap');
  m.roughnessMap = map('roughnessMap');
  m.aoMap = map('ambientOcclusionMap');
  m.emissiveMap = map('emissiveMap');
  m.alphaMap = map('opacityMap');
  m.userData.materialId = def.id;
  return m;
}

/** Built materials, rebuilt only when their definition (or a texture) changes. */
const built = new Map<string, { def: MaterialDef; version: number; material: Material }>();

export function materialFor(def: MaterialDef): Material {
  const version = useTextureVersion.getState().version;
  const hit = built.get(def.id);
  if (hit && hit.def === def && hit.version === version) return hit.material;
  hit?.material.dispose();
  const material = buildMaterial(def);
  built.set(def.id, { def, version, material });
  return material;
}
