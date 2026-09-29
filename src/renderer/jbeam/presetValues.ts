import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { materialDefaults } from '@shared/parts/materials';
import { partSettings } from '@shared/proxy/generate';
import { beamPhysics } from '@shared/proxy/beamValues';
import { BEAM_PRESET_VALUES } from '@shared/proxy/presets';
import type { Project, StructBeam, StructNode, StructTri } from '@shared/project/schema';
import { GROUND_MODEL } from '@shared/export/jbeam';

/**
 * What a node, beam or triangle gets from its part's preset when nothing is
 * set by hand: shown as the placeholder in the JBeam workspace, and the base
 * a "scale ×" starts from.
 */

type Doc = Pick<Project, 'parts' | 'proxy'>;

function partPreset(doc: Doc, partId: string) {
  const part = doc.parts.find((p) => p.id === partId);
  const entry = part && currentTaxonomy().entry(part.taxonomyId);
  if (!part || !entry) return null;
  return { part, preset: materialDefaults(entry, part.constructionMaterial).beamPreset, settings: partSettings(doc, part, entry) };
}

export function presetNodeValue(doc: Doc, node: Pick<StructNode, 'partId'>, key: string): number | string | boolean | undefined {
  const p = partPreset(doc, node.partId);
  if (!p) return undefined;
  const values: Record<string, number | string | boolean> = { nodeMaterial: BEAM_PRESET_VALUES[p.preset].nodeMaterial, frictionCoef: 0.5, collision: true, selfCollision: true };
  return values[key];
}

export function presetBeamValue(doc: Doc, beam: Pick<StructBeam, 'partId' | 'kind'>, key: string): number | string | boolean | undefined {
  const p = partPreset(doc, beam.partId);
  if (!p) return undefined;
  const v = beamPhysics(beam.kind, p.preset, p.settings.attachment, p.part.name);
  const values: Record<string, number | string | boolean | undefined> = {
    beamSpring: v.beamSpring,
    beamDamp: v.beamDamp,
    beamDeform: v.beamDeform,
    beamStrength: v.beamStrength ?? undefined,
    beamType: `|${v.beamType ?? 'NORMAL'}`,
    beamPrecompression: v.precompression ?? 1,
    breakGroup: v.breakGroup ?? undefined,
    deformLimitExpansion: v.deformLimitExpansion,
  };
  return values[key];
}

export function presetTriValue(doc: Doc, tri: Pick<StructTri, 'partId'>, key: string): number | string | boolean | undefined {
  const p = partPreset(doc, tri.partId);
  if (!p) return undefined;
  const values: Record<string, string> = { groundModel: GROUND_MODEL[BEAM_PRESET_VALUES[p.preset].nodeMaterial] ?? 'metal', triangleType: 'NORMALTYPE' };
  return values[key];
}
