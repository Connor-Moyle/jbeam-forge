import { Color, DoubleSide, SRGBColorSpace, Texture, type Material } from 'three';
import { defaultLayer, defaultMaterial, type MaterialDef, type TextureSlot } from '@shared/materials/schema';
import type { Project } from '@shared/project/schema';
import { projectStore } from '@renderer/app/stores/project';
import type { ImportedMesh } from '@renderer/import/normalize';

/**
 * Auto-import: every material of a newly loaded model becomes a project
 * material (with its texture files), and every mesh is pointed at them. Runs
 * once per model; materials the project already has are left as edited.
 */

const SLOT_FROM_THREE: [string, TextureSlot][] = [
  ['map', 'baseColorMap'],
  ['normalMap', 'normalMap'],
  ['metalnessMap', 'metallicMap'],
  ['roughnessMap', 'roughnessMap'],
  ['aoMap', 'ambientOcclusionMap'],
  ['emissiveMap', 'emissiveMap'],
  ['alphaMap', 'opacityMap'],
];

type ThreeProps = Record<string, unknown> & { color?: Color; emissive?: Color; opacity: number; transparent: boolean; metalness?: number; roughness?: number; shininess?: number; alphaTest: number };

/** A project material from an imported three.js material. */
export function defFromThree(material: Material, id: string, name: string, sourceId: string): MaterialDef {
  const m = material as unknown as ThreeProps;
  const srgb = { r: 1, g: 1, b: 1 };
  (m.color instanceof Color ? m.color : new Color(1, 1, 1)).getRGB(srgb, SRGBColorSpace);
  const maps: Partial<Record<TextureSlot, string>> = {};
  for (const [prop, slot] of SLOT_FROM_THREE) {
    const tex = m[prop];
    const path = tex instanceof Texture ? (tex.userData.sourcePath as string | undefined) : undefined;
    if (path) maps[slot] = path;
  }
  const emissive = m.emissive instanceof Color ? m.emissive : null;
  const glowing = !!emissive && (emissive.r > 0.01 || emissive.g > 0.01 || emissive.b > 0.01);
  // Phong (COLLADA/OBJ/FBX) has no roughness: derive it from shininess.
  const roughness = typeof m.roughness === 'number' ? m.roughness : typeof m.shininess === 'number' ? Math.max(0.05, Math.min(1, 1 - m.shininess / 100)) : 0.5;
  const opacity = m.opacity ?? 1;
  // Some loaders (kn5) blend by the base texture's alpha instead of an opacity value.
  const translucent = (m.transparent && (opacity < 1 || material.userData.alphaFromTexture === true)) || !!maps.opacityMap;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return defaultMaterial(id, name, {
    origin: { sourceId, name: material.name || name },
    layers: [
      defaultLayer({
        baseColor: [clamp(srgb.r), clamp(srgb.g), clamp(srgb.b), 1],
        metallic: clamp(typeof m.metalness === 'number' ? m.metalness : 0),
        roughness: clamp(roughness),
        opacity: clamp(opacity),
        emissive: glowing ? [clamp(emissive.r), clamp(emissive.g), clamp(emissive.b)] : [0, 0, 0],
        emissiveIntensity: glowing ? 10 : 0,
        maps,
      }),
    ],
    translucent,
    blend: translucent ? 'PreMulAlpha' : 'None',
    alphaTest: m.alphaTest > 0,
    alphaRef: Math.round(Math.min(1, m.alphaTest) * 255),
    doubleSided: material.side === DoubleSide,
    castShadows: !translucent,
  });
}

function materialsOf(mesh: ImportedMesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** The materials and mesh slots a model would add to the project (nothing for ones it already has). */
export function planSeed(doc: Pick<Project, 'materials' | 'materialSlots'>, sourceId: string, meshes: readonly ImportedMesh[]): { materials: MaterialDef[]; slots: Record<string, string[]> } {
  const byOrigin = new Map(doc.materials.filter((d) => d.origin?.sourceId === sourceId).map((d) => [d.origin!.name, d.id]));
  const takenNames = new Set(doc.materials.map((d) => d.name.toLowerCase()));
  const fresh = new Map<Material, MaterialDef>();
  const idFor = (material: Material): string => {
    const originName = material.name || 'material';
    const known = byOrigin.get(originName);
    if (known) return known;
    const existing = fresh.get(material);
    if (existing) return existing.id;
    let name = originName.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'material';
    const base = name;
    for (let i = 2; takenNames.has(name.toLowerCase()); i++) name = `${base}_${i}`;
    takenNames.add(name.toLowerCase());
    const def = defFromThree(material, `mat_${crypto.randomUUID().slice(0, 8)}`, name, sourceId);
    fresh.set(material, def);
    byOrigin.set(originName, def.id);
    return def.id;
  };
  const slots: Record<string, string[]> = {};
  for (const mesh of meshes) if (!doc.materialSlots[mesh.key]) slots[mesh.key] = materialsOf(mesh).map(idFor);
  return { materials: [...fresh.values()], slots };
}

/**
 * For a model that was already in the project (opened from disk): add any
 * materials or mesh slots it's missing, as one undo step, only if needed.
 */
export function seedMaterials(sourceId: string, meshes: readonly ImportedMesh[]): void {
  const doc = projectStore.getState().doc;
  if (!doc) return;
  const plan = planSeed(doc, sourceId, meshes);
  if (!plan.materials.length && !Object.keys(plan.slots).length) return;
  projectStore.getState().execute({
    label: `Import ${plan.materials.length} material${plan.materials.length === 1 ? '' : 's'}`,
    apply: (d) => {
      d.materials.push(...plan.materials);
      Object.assign(d.materialSlots, plan.slots);
    },
  });
}

/** Material ids of a mesh; split pieces use their base mesh's. */
export function slotsOf(doc: { materialSlots: Readonly<Record<string, readonly string[]>> }, meshKey: string): readonly string[] | undefined {
  const own = doc.materialSlots[meshKey];
  if (own) return own;
  const slash = meshKey.indexOf('/');
  return slash > 0 ? slotsOf(doc, meshKey.slice(0, slash)) : undefined;
}
