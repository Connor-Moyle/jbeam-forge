import { CompressedTexture, Group, Mesh, type Material, type Texture } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { BEAMNG_TO_VIEW_ROTATION_X } from '@shared/coords';
import { withMeshNames } from '@shared/parts/meshNames';
import { slugify } from '@shared/text';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useUiStore } from '@renderer/app/stores/ui';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import type { ImportedMesh } from '@renderer/import/normalize';
import { collectMaterials } from './materials';
import { materialFor } from '@renderer/materials/runtime';
import { slotsOf } from '@renderer/materials/seed';
import { writeDae } from './dae';

/**
 * Export the imported model back out with its new mesh names, so it can go
 * back into Blender (or anywhere) the way it's organised here: every mesh named
 * after its part, grouped under that part. Ignored meshes are left out.
 */

const logger = rlog('model-export');

export type ModelFormat = 'glb' | 'dae';

function exportedMeshes(): { meshes: (ImportedMesh & { group: string })[]; slug: string } | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const ignored = new Set(doc.ignoredMeshes);
  const partName = new Map(doc.parts.map((p) => [p.id, p.displayName]));
  const all = Object.values(useSceneStore.getState().sources).flatMap((s) => s.meshes);
  const defs = new Map(doc.materials.map((d) => [d.id, d]));
  const meshes = withMeshNames(doc, all.filter((m) => !ignored.has(m.key))).map((m) => {
    const partId = doc.assignments[m.key];
    // Project materials (with any edits) where the mesh has them.
    const imported = Array.isArray(m.material) ? m.material : [m.material];
    const ids = slotsOf(doc, m.key);
    const mats = ids?.length ? ids.map((id, i) => (defs.get(id) ? materialFor(defs.get(id)!) : (imported[i] ?? imported[0]!))) : imported;
    return { ...m, material: mats.length === 1 ? mats[0]! : mats, group: partId ? (partName.get(partId) ?? 'Unassigned') : 'Unassigned' };
  });
  return { meshes, slug: doc.meta.slug };
}

/** glTF can't carry GPU-compressed (DDS) textures: those slots are dropped, colours and factors stay. */
function exportableMaterial(material: Material, cache: Map<Material, Material>): Material {
  const known = cache.get(material);
  if (known) return known;
  const slots = Object.entries(material).filter(([, v]) => v instanceof CompressedTexture);
  let out = material;
  if (slots.length) {
    out = material.clone();
    for (const [k] of slots) (out as unknown as Record<string, Texture | null>)[k] = null;
  }
  cache.set(material, out);
  return out;
}

export async function buildGlb(meshes: readonly (ImportedMesh & { group: string })[]): Promise<Uint8Array> {
  // Geometry is stored in BeamNG space (Z up); glTF is Y up, like the viewport.
  const root = new Group();
  root.name = 'model';
  root.rotation.x = BEAMNG_TO_VIEW_ROTATION_X;
  const groups = new Map<string, Group>();
  const materials = new Map<Material, Material>();
  for (const m of meshes) {
    let g = groups.get(m.group);
    if (!g) {
      g = new Group();
      g.name = slugify(m.group) || 'group';
      groups.set(m.group, g);
      root.add(g);
    }
    const material = Array.isArray(m.material) ? m.material.map((x) => exportableMaterial(x, materials)) : exportableMaterial(m.material, materials);
    const mesh = new Mesh(m.geometry, material);
    mesh.name = m.name;
    g.add(mesh);
  }
  const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false });
  if (!(result instanceof ArrayBuffer)) throw new Error('The glTF exporter returned JSON instead of a binary file');
  return new Uint8Array(result);
}

export function buildDae(meshes: readonly ImportedMesh[], slug: string, flipVFor: (sourceId: string) => boolean): string {
  const mats = collectMaterials(
    slug,
    meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])),
  );
  return writeDae(
    meshes.map((m) => ({ name: m.name, geometry: m.geometry, materials: (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => mats.names.get(mat)!), flipV: flipVFor(m.sourceId) })),
    mats.materials.map((m) => ({ name: m.name, color: m.baseColor })),
  );
}

/** Build the file and ask where to save it. */
export async function exportModel(format: ModelFormat): Promise<void> {
  const built = exportedMeshes();
  const status = useUiStore.getState().pushStatus;
  if (!built || !built.meshes.length) {
    status('Nothing to export: import a model first', 'warning');
    return;
  }
  try {
    const formatOf = new Map((projectStore.getState().doc?.sources ?? []).map((s) => [s.id, s.format]));
    const data = format === 'glb' ? await buildGlb(built.meshes) : buildDae(built.meshes, built.slug, (id) => formatOf.get(id) === 'gltf' || formatOf.get(id) === 'glb');
    const saved = await call('export:saveModel', { suggestedName: `${built.slug}.${format}`, format, data });
    if (saved) status(`Exported ${built.meshes.length} meshes to ${saved.path}`, 'success', 6000);
  } catch (err) {
    logger.error('model export failed:', err instanceof Error ? err.message : String(err));
    status(`Model export failed: ${err instanceof Error ? err.message : String(err)}`, 'danger', 8000);
  }
}
