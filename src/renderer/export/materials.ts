import { Color, DoubleSide, SRGBColorSpace, Texture, type Material } from 'three';
import { exportMaterialName, type ExportMaterial } from '@shared/export/files';

/**
 * Imported three.js materials → exported material definitions + the texture
 * files to copy into the mod (SPEC §4.15). Phase 8 replaces this with the full
 * material editor; this keeps what the import already knows.
 */

const SLOT_MAP: [keyof ExportMaterial['maps'], string][] = [
  ['baseColorMap', 'map'],
  ['normalMap', 'normalMap'],
  ['metallicMap', 'metalnessMap'],
  ['roughnessMap', 'roughnessMap'],
  ['ambientOcclusionMap', 'aoMap'],
  ['emissiveMap', 'emissiveMap'],
  ['opacityMap', 'alphaMap'],
];

export interface MaterialExport {
  materials: ExportMaterial[];
  /** three material → exported name */
  names: Map<Material, string>;
  copies: { from: string; to: string }[];
}

function basename(p: string): string {
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

export function collectMaterials(slug: string, materials: Iterable<Material>): MaterialExport {
  const taken = new Set<string>();
  const out: MaterialExport = { materials: [], names: new Map(), copies: [] };
  const fileFor = new Map<string, string>(); // source path → file name in the mod
  const usedFiles = new Set<string>();
  const copyTexture = (src: string): string => {
    const known = fileFor.get(src);
    if (known) return known;
    const base = basename(src).replace(/[^A-Za-z0-9_.-]/g, '_');
    let name = base.toLowerCase().startsWith(`${slug}_`) ? base : `${slug}_${base}`;
    const dot = name.lastIndexOf('.');
    for (let i = 2; usedFiles.has(name.toLowerCase()); i++) name = `${name.slice(0, dot)}_${i}${name.slice(dot)}`;
    usedFiles.add(name.toLowerCase());
    fileFor.set(src, name);
    out.copies.push({ from: src, to: `vehicles/${slug}/${name}` });
    return name;
  };

  for (const mat of materials) {
    if (out.names.has(mat)) continue;
    const m = mat as unknown as Record<string, unknown> & { color?: Color; opacity: number; transparent: boolean; metalness?: number; roughness?: number; shininess?: number };
    const name = exportMaterialName(slug, mat.name || 'material', taken);
    out.names.set(mat, name);
    const c = m.color instanceof Color ? m.color.clone() : new Color(1, 1, 1);
    const srgb = { r: 1, g: 1, b: 1 };
    c.getRGB(srgb, SRGBColorSpace);
    const maps: ExportMaterial['maps'] = {};
    for (const [slot, prop] of SLOT_MAP) {
      const tex = m[prop];
      const src = tex instanceof Texture ? (tex.userData.sourcePath as string | undefined) : undefined;
      if (src) maps[slot] = copyTexture(src);
    }
    // Phong (COLLADA/OBJ/FBX) has no roughness: derive it from shininess.
    const roughness = typeof m.roughness === 'number' ? m.roughness : typeof m.shininess === 'number' ? Math.max(0.05, Math.min(1, 1 - m.shininess / 100)) : 0.5;
    out.materials.push({
      name,
      baseColor: [srgb.r, srgb.g, srgb.b, m.opacity ?? 1],
      metallic: typeof m.metalness === 'number' ? m.metalness : 0,
      roughness,
      maps,
      translucent: (m.transparent && (m.opacity ?? 1) < 1) || !!maps.opacityMap,
      doubleSided: mat.side === DoubleSide,
    });
  }
  return out;
}
