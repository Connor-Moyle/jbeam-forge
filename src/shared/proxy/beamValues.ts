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
  /** Non-normal beams (hinges, Phase 9). Absent = |NORMAL. */
  beamType?: 'BOUNDED' | 'SUPPORT';
  precompression?: number;
  longBound?: number;
  shortBound?: number;
  limitSpring?: number;
  limitDamp?: number;
  /** 1 = breaking this beam doesn't break the rest of its group. */
  breakGroupType?: 0 | 1;
}

/** A hinge's tunables, as the beams need them. */
export interface HingeBeamSettings {
  stiffness: number;
  damping: number;
  strength: number;
}

const HINGE_FALLBACK: HingeBeamSettings = { stiffness: 1_201_000, damping: 70, strength: 78_000 };

export const DEFORM_LIMIT_EXPANSION = 1.1; // official median (docs/proxy-generation.md)

export function beamPhysics(kind: StructBeam['kind'], preset: BeamPresetId, attachment: AttachmentStyle, partName: string, hinge: HingeBeamSettings = HINGE_FALLBACK, longBound = 1): BeamPhysics {
  const e = DEFORM_LIMIT_EXPANSION;
  // Hinged parts: values from the stock Sunburst front door.
  switch (kind) {
    case 'hinge':
      return { beamSpring: hinge.stiffness, beamDamp: hinge.damping, beamDeform: Math.round(hinge.strength * 0.126), beamStrength: hinge.strength, deformLimitExpansion: e, breakGroup: `${partName}_hinge` };
    case 'mount':
      return { beamSpring: 1_001_000, beamDamp: 50, beamDeform: 12_000, beamStrength: null, deformLimitExpansion: e, breakGroup: null };
    case 'limit':
      return { beamSpring: 0, beamDamp: 5, beamDeform: 3_000, beamStrength: 10_000, deformLimitExpansion: e, breakGroup: null, beamType: 'BOUNDED', longBound, shortBound: 1, limitSpring: 10_000, limitDamp: 2_500, precompression: 1 };
    case 'support':
      return { beamSpring: 1_001_000, beamDamp: 50, beamDeform: 8_000, beamStrength: 200_000, deformLimitExpansion: e, breakGroup: `${partName}_supportBeams`, beamType: 'SUPPORT', longBound: 30 };
    case 'popopen':
      // The game's own doors: 2.3 % of the beam's length, enough to move the edge off the catch.
      return { beamSpring: 50_000, beamDamp: 1_320, beamDeform: 40_000, beamStrength: 10_000, deformLimitExpansion: e, breakGroup: `${partName}_hinge`, beamType: 'SUPPORT', longBound: 25, precompression: 1.023, breakGroupType: 1 };
    default:
      break;
  }
  if (kind === 'attach') {
    const a = ATTACHMENT_VALUES[attachment];
    return { beamSpring: a.beamSpring, beamDamp: a.beamDamp, beamDeform: a.beamDeform, beamStrength: a.beamStrength, deformLimitExpansion: DEFORM_LIMIT_EXPANSION, breakGroup: a.breakGroup ? `${partName}_attach` : null };
  }
  const p = BEAM_PRESET_VALUES[preset];
  const spring = kind === 'brace' ? Math.round(p.beamSpring * p.braceSpringFactor) : p.beamSpring;
  return { beamSpring: spring, beamDamp: p.beamDamp, beamDeform: p.beamDeform, beamStrength: p.beamStrength, deformLimitExpansion: DEFORM_LIMIT_EXPANSION, breakGroup: null };
}
