import type { Part, Project } from '../project/schema';
import { withPortedNotice } from './ported';
import { commonPrefix } from '../taxonomy/tokenize';
import { slotTypeOf, type TaxonomyLookup } from './jbeam';
import { partPrice } from '../parts/materials';
import { infoPaints } from '../paints/paints';

/**
 * Names and the small JSON files of an exported vehicle (SPEC §4.15):
 * DAE node/material names, info.json, the default .pc + info_<config>.json,
 * and main.materials.json. Formats: docs/beamng-vehicle-layout.md.
 */

type Doc = Pick<Project, 'meta' | 'parts' | 'assignments' | 'ignoredMeshes'>;

export function sanitizeName(s: string): string {
  const out = s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return out || 'mesh';
}

/**
 * Final DAE node names for the exported meshes (meshKey → name): the source's
 * own vehicle prefix is replaced by the mod slug (`sunburst2_door_FL` →
 * `test_door_FL`), names are sanitised and made unique. Only meshes assigned
 * to a part (and not ignored) are exported.
 */
export function exportMeshNames(doc: Doc, meshes: readonly { key: string; name: string; sourceId: string }[]): Map<string, string> {
  const slug = doc.meta.slug;
  const ignored = new Set(doc.ignoredMeshes);
  const exported = meshes.filter((m) => doc.assignments[m.key] && !ignored.has(m.key));
  const prefixBySource = new Map<string, string | null>();
  for (const sid of new Set(exported.map((m) => m.sourceId))) prefixBySource.set(sid, commonPrefix(meshes.filter((m) => m.sourceId === sid).map((m) => m.name)));
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const m of exported) {
    let base = sanitizeName(m.name);
    const prefix = prefixBySource.get(m.sourceId);
    if (prefix && base.toLowerCase().startsWith(`${prefix}_`)) base = base.slice(prefix.length + 1);
    if (!base.toLowerCase().startsWith(`${slug}_`)) base = `${slug}_${base}`;
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}_${i}`;
    taken.add(name.toLowerCase());
    out.set(m.key, name);
  }
  return out;
}

/** Material names are global in BeamNG: always prefix with the slug. */
export function exportMaterialName(slug: string, name: string, taken: Set<string>): string {
  let base = sanitizeName(name);
  if (!base.toLowerCase().startsWith(`${slug}_`)) base = `${slug}_${base}`;
  let out = base;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base}_${i}`;
  taken.add(out.toLowerCase());
  return out;
}

export const DEFAULT_CONFIG = 'default';

export function infoJson(doc: Pick<Project, 'meta'> & Partial<Pick<Project, 'paints'>>, author: string, defaultPc: string = DEFAULT_CONFIG): Record<string, unknown> {
  const m = doc.meta;
  return {
    Name: m.name,
    Brand: m.brand || 'JBeam Forge',
    Author: author || m.author || 'JBeam Forge',
    Type: m.type || 'Car',
    Description: withPortedNotice(m.description || `${m.name}, built with JBeam Forge.`, m.portedFrom),
    ...(m.bodyStyle ? { 'Body Style': m.bodyStyle } : {}),
    ...(m.country ? { Country: m.country } : {}),
    ...(m.years ? { Years: m.years } : {}),
    default_pc: defaultPc,
    ...(doc.paints ? infoPaints({ paints: doc.paints }) : {}),
  };
}

/** Every slot in the tree → its default part (the base part), flat, as `.pc` format 2 wants. */
export function defaultConfig(doc: Doc, tax: TaxonomyLookup): { format: 2; model: string; parts: Record<string, string>; vars: Record<string, never> } {
  const parts: Record<string, string> = {};
  for (const p of doc.parts) {
    if (!tax.entry(p.taxonomyId)) continue;
    const slot = slotTypeOf(doc.parts, p);
    const base: Part = p.variantOf ? (doc.parts.find((x) => x.id === p.variantOf) ?? p) : p;
    parts[slot] = base.name;
  }
  return { format: 2, model: doc.meta.slug, parts, vars: {} };
}

export function configInfo(doc: Doc, tax: TaxonomyLookup, config: ReturnType<typeof defaultConfig>): Record<string, string | number> {
  const byName = new Map(doc.parts.map((p) => [p.name, p]));
  const value = Object.values(config.parts).reduce((sum, name) => {
    const part = byName.get(name);
    return sum + (part ? partPrice(part, tax.entry(part.taxonomyId)) : 0);
  }, 0);
  return { Configuration: 'Default', 'Config Type': 'Factory', Description: `Default ${doc.meta.name} configuration.`, Value: value };
}

export interface ExportMaterial {
  /** Exported (slug-prefixed) name; also the DAE material id and `mapTo`. */
  name: string;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  /** Map slot → file name inside vehicles/<slug>/. */
  maps: Partial<Record<'baseColorMap' | 'normalMap' | 'metallicMap' | 'roughnessMap' | 'ambientOcclusionMap' | 'emissiveMap' | 'opacityMap', string>>;
  translucent: boolean;
  doubleSided: boolean;
}

/** main.materials.json in the v1.5 PBR form official 0.39 content uses (four stages, stage 0 filled). */
export function materialsJson(slug: string, materials: readonly ExportMaterial[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of materials) {
    const stage: Record<string, unknown> = {
      baseColorFactor: m.baseColor.map((c) => Math.round(c * 1000) / 1000),
      metallicFactor: Math.round(m.metallic * 1000) / 1000,
      roughnessFactor: Math.round(m.roughness * 1000) / 1000,
    };
    for (const [slot, file] of Object.entries(m.maps)) stage[slot] = `/vehicles/${slug}/${file}`;
    out[m.name] = {
      name: m.name,
      mapTo: m.name,
      class: 'Material',
      Stages: [stage, {}, {}, {}],
      ...(m.translucent ? { translucent: true, translucentZWrite: true, alphaRef: 7 } : {}),
      ...(m.doubleSided ? { doubleSided: true } : {}),
      dynamicCubemap: true,
      version: 1.5,
    };
  }
  return out;
}
