import type { StructBeam } from '../project/schema';
import { ATTACHMENT_VALUES, BEAM_PRESET_VALUES, type AttachmentStyle, type BeamPresetId } from './presets';

/**
 * The physical values of one generated beam: the single source of truth for
 * both the jbeam exporter and the physics sandbox (SPEC §4.6: "spring-damper
 * beams using the SAME preset values export writes").
 */
export interface BeamPhysics {
  beamSpring: number;
  beamDamp: number;
  beamDeform: number;
  /** null = FLT_MAX (unbreakable). */
  beamStrength: number | null;
  deformLimitExpansion: number;
  breakGroup: string | null;
}

export const DEFORM_LIMIT_EXPANSION = 1.1; // official median (docs/proxy-generation.md)

export function beamPhysics(kind: StructBeam['kind'], preset: BeamPresetId, attachment: AttachmentStyle, partName: string): BeamPhysics {
  if (kind === 'attach') {
    const a = ATTACHMENT_VALUES[attachment];
    return { beamSpring: a.beamSpring, beamDamp: a.beamDamp, beamDeform: a.beamDeform, beamStrength: a.beamStrength, deformLimitExpansion: DEFORM_LIMIT_EXPANSION, breakGroup: a.breakGroup ? `${partName}_attach` : null };
  }
  const p = BEAM_PRESET_VALUES[preset];
  const spring = kind === 'brace' ? Math.round(p.beamSpring * p.braceSpringFactor) : p.beamSpring;
  return { beamSpring: spring, beamDamp: p.beamDamp, beamDeform: p.beamDeform, beamStrength: p.beamStrength, deformLimitExpansion: DEFORM_LIMIT_EXPANSION, breakGroup: null };
}
