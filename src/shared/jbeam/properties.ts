/**
 * The jbeam properties the JBeam workspace can set on one node, beam or
 * triangle (fork), with what each does. Easy mode shows the common ones;
 * Advanced shows all of them and lets you type any other property name.
 */

export type PropertyTarget = 'node' | 'beam' | 'tri';

export interface JbeamProperty {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'enum' | 'string';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  options?: readonly { value: string; label: string }[];
  /** What the game does with it, in a sentence. */
  doc: string;
  /** Shown only in Advanced mode. */
  advanced?: boolean;
  /** The game's own default, shown as the placeholder. */
  fallback?: number | string | boolean;
}

export const NODE_MATERIALS = [
  { value: '|NM_METAL', label: 'Metal' },
  { value: '|NM_PLASTIC', label: 'Plastic' },
  { value: '|NM_RUBBER', label: 'Rubber' },
  { value: '|NM_GLASS', label: 'Glass' },
  { value: '|NM_WOOD', label: 'Wood' },
] as const;

export const NODE_PROPERTIES: readonly JbeamProperty[] = [
  { key: 'collision', label: 'Collides with the world', type: 'boolean', doc: 'Off lets the node pass through the ground and other objects (useful inside the car).', fallback: true },
  { key: 'selfCollision', label: 'Collides with the car', type: 'boolean', doc: 'Whether the node bumps into the car’s own triangles.', fallback: true },
  { key: 'frictionCoef', label: 'Friction', type: 'number', min: 0, max: 5, step: 0.05, precision: 2, doc: 'Grip against the ground and objects.', fallback: 0.5 },
  { key: 'nodeMaterial', label: 'Surface', type: 'enum', options: NODE_MATERIALS, doc: 'Sounds, sparks and scrape effects when it touches things.' },
  { key: 'fixed', label: 'Fixed in place', type: 'boolean', doc: 'Pins the node in space (for test rigs only; a driven car won’t move).', advanced: true, fallback: false },
  { key: 'slidingFrictionCoef', label: 'Sliding friction', type: 'number', min: 0, max: 5, step: 0.05, precision: 2, doc: 'Friction once it’s sliding.', advanced: true },
  { key: 'surfaceCoef', label: 'Surface area (air)', type: 'number', min: 0, max: 10, step: 0.05, precision: 2, doc: 'How much the air pushes on the node (drag of loose parts).', advanced: true, fallback: 0.1 },
  { key: 'volumeCoef', label: 'Volume (water)', type: 'number', min: 0, max: 10, step: 0.05, precision: 2, doc: 'How much it floats.', advanced: true, fallback: 0.1 },
  { key: 'group', label: 'Extra group', type: 'string', doc: 'A group name other parts or flexbodies can refer to.', advanced: true },
  { key: 'chemEnergy', label: 'Fuel energy', type: 'number', min: 0, max: 100000, step: 100, precision: 0, doc: 'Energy it releases when it burns (fire).', advanced: true },
  { key: 'burnRate', label: 'Burn rate', type: 'number', min: 0, max: 10, step: 0.1, precision: 2, doc: 'How fast it burns.', advanced: true },
  { key: 'flashPoint', label: 'Flash point', type: 'number', unit: '°C', min: 0, max: 2000, step: 10, precision: 0, doc: 'Temperature it catches fire at.', advanced: true },
  { key: 'specHeat', label: 'Specific heat', type: 'number', min: 0, max: 10, step: 0.1, precision: 2, doc: 'How slowly it heats up.', advanced: true },
  { key: 'couplerTag', label: 'Coupler tag', type: 'string', doc: 'Couples to nodes with the same tag (trailer hitches, tow bars).', advanced: true },
  { key: 'couplerStrength', label: 'Coupler strength', type: 'number', unit: 'N', min: 0, max: 1e8, step: 1000, precision: 0, doc: 'Force before the coupling lets go.', advanced: true },
  { key: 'couplerRadius', label: 'Coupler reach', type: 'number', unit: 'm', min: 0, max: 2, step: 0.01, precision: 2, doc: 'How close the other node must be to couple.', advanced: true },
];

export const BEAM_TYPES = [
  { value: '|NORMAL', label: 'Normal (spring)' },
  { value: '|BOUNDED', label: 'Bounded (free between limits)' },
  { value: '|SUPPORT', label: 'Support (only pushes)' },
  { value: '|ANISOTROPIC', label: 'Anisotropic (stiffer one way)' },
  { value: '|PRESSURED', label: 'Pressured (tyres)' },
  { value: '|HYDRO', label: 'Hydro (steering, actuators)' },
  { value: '|LBEAM', label: 'L-beam (angle)' },
] as const;

export const BEAM_PROPERTIES: readonly JbeamProperty[] = [
  { key: 'beamSpring', label: 'Stiffness', type: 'number', unit: 'N/m', min: 0, max: 1e9, step: 10000, precision: 0, doc: 'How hard the beam resists stretching or squashing.' },
  { key: 'beamDamp', label: 'Damping', type: 'number', unit: 'N·s/m', min: 0, max: 1e6, step: 5, precision: 1, doc: 'Calms vibration. Too little and it shakes; too much and it goes stiff and unstable.' },
  { key: 'beamDeform', label: 'Bends at', type: 'number', unit: 'N', min: 0, max: 1e9, step: 500, precision: 0, doc: 'Force at which it bends for good (a dent).' },
  { key: 'beamStrength', label: 'Breaks at', type: 'number', unit: 'N', min: 0, max: 1e10, step: 1000, precision: 0, doc: 'Force at which it snaps. Leave empty for never.' },
  { key: 'beamType', label: 'Type', type: 'enum', options: BEAM_TYPES, doc: 'How the beam behaves.' },
  { key: 'beamPrecompression', label: 'Precompression', type: 'number', min: 0, max: 5, step: 0.01, precision: 3, doc: 'Length it wants to be, as a share of its built length (above 1 pushes apart).', fallback: 1 },
  { key: 'breakGroup', label: 'Break group', type: 'string', doc: 'When one beam of a group breaks, they all do (a part coming off).' },
  { key: 'deformLimitExpansion', label: 'Stretch limit', type: 'number', min: 0, max: 10, step: 0.05, precision: 2, doc: 'How far it can stretch before it no longer deforms (stops rubbery stretching).', advanced: true },
  { key: 'deformLimit', label: 'Squash limit', type: 'number', min: 0, max: 10, step: 0.05, precision: 2, doc: 'How far it can be squashed before it stops deforming.', advanced: true },
  { key: 'beamShortBound', label: 'Short bound', type: 'number', min: 0, max: 5, step: 0.01, precision: 3, doc: 'Bounded and support beams: how far it squashes freely.', advanced: true },
  { key: 'beamLongBound', label: 'Long bound', type: 'number', min: 0, max: 5, step: 0.01, precision: 3, doc: 'Bounded beams: how far it stretches freely.', advanced: true },
  { key: 'beamLimitSpring', label: 'Limit stiffness', type: 'number', unit: 'N/m', min: 0, max: 1e9, step: 10000, precision: 0, doc: 'Stiffness once past the bounds.', advanced: true },
  { key: 'beamLimitDamp', label: 'Limit damping', type: 'number', min: 0, max: 1e6, step: 5, precision: 1, doc: 'Damping once past the bounds.', advanced: true },
  { key: 'beamDampRebound', label: 'Rebound damping', type: 'number', min: 0, max: 1e6, step: 5, precision: 1, doc: 'Damping while it extends (shock absorbers).', advanced: true },
  { key: 'beamDampFast', label: 'Fast damping', type: 'number', min: 0, max: 1e6, step: 5, precision: 1, doc: 'Damping above the split speed.', advanced: true },
  { key: 'beamDampVelocitySplit', label: 'Damping split speed', type: 'number', unit: 'm/s', min: 0, max: 10, step: 0.01, precision: 2, doc: 'Speed where damping switches to the fast values.', advanced: true },
  { key: 'springExpansion', label: 'Stiffness when stretched', type: 'number', unit: 'N/m', min: 0, max: 1e9, step: 10000, precision: 0, doc: 'Anisotropic beams: stiffness while stretching.', advanced: true },
  { key: 'dampExpansion', label: 'Damping when stretched', type: 'number', min: 0, max: 1e6, step: 5, precision: 1, doc: 'Anisotropic beams: damping while stretching.', advanced: true },
  { key: 'deformGroup', label: 'Deform group', type: 'string', doc: 'Triggers a flexbody change (glass cracking) when these beams deform.', advanced: true },
  { key: 'deformationTriggerRatio', label: 'Deform trigger', type: 'number', min: 0, max: 1, step: 0.005, precision: 3, doc: 'How much deformation triggers the deform group.', advanced: true },
  { key: 'breakGroupType', label: 'Break group type', type: 'number', min: 0, max: 1, step: 1, precision: 0, doc: '1: breaking this beam doesn’t break the rest of its group.', advanced: true },
  { key: 'optional', label: 'Optional', type: 'boolean', doc: 'Skipped quietly if one of its nodes is missing (a part not fitted).', advanced: true },
  { key: 'disableMeshBreaking', label: 'Keep the mesh whole', type: 'boolean', doc: 'The mesh doesn’t tear here when the beam breaks.', advanced: true },
  { key: 'disableTriangleBreaking', label: 'Keep triangles', type: 'boolean', doc: 'Triangles using it stay when it breaks.', advanced: true },
];

export const GROUND_MODELS = ['metal', 'plastic', 'rubber', 'glass', 'wood'] as const;

export const TRI_PROPERTIES: readonly JbeamProperty[] = [
  { key: 'dragCoef', label: 'Air drag', type: 'number', min: 0, max: 100, step: 1, precision: 1, doc: 'How much the air pushes on this triangle.' },
  { key: 'liftCoef', label: 'Lift', type: 'number', min: -500, max: 500, step: 1, precision: 1, doc: 'Lift (or downforce, from how it’s angled) it makes: wings and spoilers.' },
  { key: 'stallAngle', label: 'Stall angle', type: 'number', unit: 'rad', min: 0, max: 1.6, step: 0.01, precision: 2, doc: 'Past this angle it stops making lift.' },
  { key: 'groundModel', label: 'Surface', type: 'enum', options: GROUND_MODELS.map((g) => ({ value: g, label: g.charAt(0).toUpperCase() + g.slice(1) })), doc: 'What it feels like to the world when scraped.' },
  { key: 'triangleType', label: 'Collision', type: 'enum', options: [
      { value: 'NORMALTYPE', label: 'Collides' },
      { value: 'NONCOLLIDABLE', label: 'Air only (no collision)' },
    ], doc: 'Air-only triangles shape the aerodynamics without colliding.', advanced: true },
  { key: 'breakGroup', label: 'Break group', type: 'string', doc: 'Goes when its break group breaks.', advanced: true },
];

export const PROPERTIES: Readonly<Record<PropertyTarget, readonly JbeamProperty[]>> = { node: NODE_PROPERTIES, beam: BEAM_PROPERTIES, tri: TRI_PROPERTIES };

/** Keys JBeam Forge writes itself (ids, positions, weight): not settable as options. */
export const RESERVED: Readonly<Record<PropertyTarget, readonly string[]>> = {
  node: ['id', 'posX', 'posY', 'posZ', 'nodeWeight'],
  beam: ['id1', 'id2'],
  tri: ['id1', 'id2', 'id3'],
};

export function propertyOf(target: PropertyTarget, key: string): JbeamProperty | undefined {
  return PROPERTIES[target].find((p) => p.key === key);
}

/** A value typed for a property, checked (null when it can't be used). */
export function coerceProperty(prop: JbeamProperty | undefined, raw: string | number | boolean): number | string | boolean | null {
  if (!prop) {
    if (typeof raw !== 'string') return raw;
    const t = raw.trim();
    if (t === 'true' || t === 'false') return t === 'true';
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : t.slice(0, 200);
  }
  switch (prop.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : raw === 'true';
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return null;
      return Math.min(prop.max ?? Infinity, Math.max(prop.min ?? -Infinity, n));
    }
    case 'enum':
      return prop.options?.some((o) => o.value === raw) ? String(raw) : null;
    default:
      return String(raw).slice(0, 200);
  }
}
