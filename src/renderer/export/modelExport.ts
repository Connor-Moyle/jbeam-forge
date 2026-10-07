import { CompressedTexture, Group, Mesh, type Material, type Texture } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { BEAMNG_TO_VIEW_ROTATION_X } from '@shared/coords';
import { MODEL_FORMATS, type ModelFormat } from '@shared/export/modelFormatList';
import { triangleCount, writeFbx, writeObj, writePly, writeStl, type ModelMesh, type ModelScene } from '@shared/export/modelFormats';
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
 * Export the model back out with its new mesh names, so it can go into Blender (or anywhere) the
 * way it's organised here: every mesh named after its part, grouped under that part, with the
 * suspensions, engine and gearbox fitted from the game where they stand on the car. Ignored meshes
 * are left out.
 */

const logger = rlog('model-export');

export type { ModelFormat };

export interface ModelExportOptions {
  format: ModelFormat;
  /** The suspensions, engine and gearbox fitted from the game, as well as the car's own meshes. */
  gameParts: boolean;
  /** Meshes hidden in the viewport too. */
  hidden: boolean;
  /** Only what is selected. */
  selectionOnly: boolean;
}

export const DEFAULT_MODEL_EXPORT: ModelExportOptions = { format: 'glb', gameParts: true, hidden: true, selectionOnly: false };

type Exported = ImportedMesh & { group: string };

/** The sources that are parts fitted from the game. */
function gameSources(): Set<string> {
  const doc = projectStore.getState().doc;
  const pt = doc?.powertrain;
  return new Set([...(doc?.axles ?? []).flatMap((a) => (a.fitted ? [a.fitted.sourceId] : [])), ...(pt?.engine ? [pt.engine.sourceId] : []), ...(pt?.gearbox ? [pt.gearbox.sourceId] : []), ...(pt?.alternates ?? []).map((a) => a.sourceId)]);
}

/** What an export with these options takes: the meshes, and how many of them are the game's. */
export function exportedMeshes(options: Pick<ModelExportOptions, 'gameParts' | 'hidden' | 'selectionOnly'> = DEFAULT_MODEL_EXPORT): { meshes: Exported[]; slug: string; fromGame: number } | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const scene = useSceneStore.getState();
  const ignored = new Set(doc.ignoredMeshes);
  const game = gameSources();
  const selected = new Set(scene.selection);
  const partName = new Map(doc.parts.map((p) => [p.id, p.displayName]));
  const all = Object.values(scene.sources).flatMap((s) => s.meshes);
  const defs = new Map(doc.materials.map((d) => [d.id, d]));
  const wanted = all.filter((m) => !ignored.has(m.key) && (options.gameParts || !game.has(m.sourceId)) && (options.hidden || !scene.hidden[m.key]) && (!options.selectionOnly || selected.has(m.key)));
  const meshes = withMeshNames(doc, wanted).map((m) => {
    const partId = doc.assignments[m.key];
    // Project materials (with any edits) where the mesh has them.
    const imported = Array.isArray(m.material) ? m.material : [m.material];
    const ids = slotsOf(doc, m.key);
    const mats = ids?.length ? ids.map((id, i) => (defs.get(id) ? materialFor(defs.get(id)!) : (imported[i] ?? imported[0]!))) : imported;
    return { ...m, material: mats.length === 1 ? mats[0]! : mats, group: partId ? (partName.get(partId) ?? 'Unassigned') : 'Unassigned' };
  });
  return { meshes, slug: doc.meta.slug, fromGame: meshes.filter((m) => game.has(m.sourceId)).length };
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

function gltfRoot(meshes: readonly Exported[]): Group {
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
  return root;
}

export async function buildGlb(meshes: readonly Exported[]): Promise<Uint8Array> {
  const result = await new GLTFExporter().parseAsync(gltfRoot(meshes), { binary: true, onlyVisible: false });
  if (!(result instanceof ArrayBuffer)) throw new Error('The glTF exporter returned JSON instead of a binary file');
  return new Uint8Array(result);
}

/** glTF as text, with its buffers and textures inside it (one file to hand over). */
export async function buildGltf(meshes: readonly Exported[]): Promise<string> {
  const result = await new GLTFExporter().parseAsync(gltfRoot(meshes), { binary: false, onlyVisible: false });
  if (result instanceof ArrayBuffer) throw new Error('The glTF exporter returned a binary file instead of JSON');
  return JSON.stringify(result);
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

/** The meshes as plain arrays for the OBJ, STL, PLY and FBX writers. */
export function buildScene(meshes: readonly Exported[], slug: string, flipVFor: (sourceId: string) => boolean): ModelScene {
  const mats = collectMaterials(
    slug,
    meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])),
  );
  const out: ModelMesh[] = [];
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    if (!pos) continue;
    const normal = m.geometry.getAttribute('normal');
    const uv = m.geometry.getAttribute('uv');
    const index = m.geometry.index;
    const indices = index ? Array.from(index.array as ArrayLike<number>) : Array.from({ length: pos.count - (pos.count % 3) }, (_, i) => i);
    const positions = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) positions.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
    let normals: Float32Array | null = null;
    if (normal && normal.count >= pos.count) {
      normals = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
    }
    let uvs: Float32Array | null = null;
    if (uv && uv.count >= pos.count) {
      // glTF counts V from the top: turned over for formats that count it from the bottom.
      const flip = flipVFor(m.sourceId);
      uvs = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) uvs.set([uv.getX(i), flip ? 1 - uv.getY(i) : uv.getY(i)], i * 2);
    }
    const list = Array.isArray(m.material) ? m.material : [m.material];
    out.push({
      name: m.name,
      group: m.group,
      positions,
      normals,
      uvs,
      indices,
      groups: m.geometry.groups.map((g) => ({ start: g.start, count: Number.isFinite(g.count) ? g.count : indices.length - g.start, material: g.materialIndex ?? 0 })),
      materials: list.map((mat) => mats.names.get(mat)!),
    });
  }
  return { name: slug, meshes: out, materials: mats.materials.map((x) => ({ name: x.name, color: x.baseColor })) };
}

/** Build the file and ask where to save it. */
export async function exportModel(format: ModelFormat, options: Partial<Omit<ModelExportOptions, 'format'>> = {}): Promise<void> {
  const opts = { ...DEFAULT_MODEL_EXPORT, ...options, format };
  const built = exportedMeshes(opts);
  const status = useUiStore.getState().pushStatus;
  if (!built || !built.meshes.length) {
    status(opts.selectionOnly ? 'Nothing to export: select the meshes to export first' : 'Nothing to export: import a model first', 'warning');
    return;
  }
  try {
    const formatOf = new Map((projectStore.getState().doc?.sources ?? []).map((s) => [s.id, s.format]));
    const fromGltf = (id: string) => formatOf.get(id) === 'gltf' || formatOf.get(id) === 'glb';
    let data: Uint8Array | string;
    let extra: { ext: string; data: string } | undefined;
    if (format === 'glb') data = await buildGlb(built.meshes);
    else if (format === 'gltf') data = await buildGltf(built.meshes);
    else if (format === 'dae') data = buildDae(built.meshes, built.slug, fromGltf);
    else {
      const scene = buildScene(built.meshes, built.slug, fromGltf);
      if (!triangleCount(scene)) throw new Error('the meshes have no triangles');
      if (format === 'fbx') data = writeFbx(scene);
      else if (format === 'stl') data = writeStl(scene);
      else if (format === 'ply') data = writePly(scene);
      else {
        // The .mtl goes next to the .obj under the same name (the dialog may change it: the main process writes both).
        const { obj, mtl } = writeObj(scene, `${built.slug}.mtl`);
        data = obj;
        extra = { ext: 'mtl', data: mtl };
      }
    }
    const saved = await call('export:saveModel', { suggestedName: `${built.slug}.${format}`, format, data, ...(extra ? { extra } : {}) });
    const label = MODEL_FORMATS.find((f) => f.value === format)?.short ?? format;
    if (saved) status(`Exported ${built.meshes.length} meshes${built.fromGame ? ` (${built.fromGame} from the game's parts)` : ''} as ${label} to ${saved.path}`, 'success', 6000);
  } catch (err) {
    logger.error('model export failed:', err instanceof Error ? err.message : String(err));
    status(`Model export failed: ${err instanceof Error ? err.message : String(err)}`, 'danger', 8000);
  }
}
