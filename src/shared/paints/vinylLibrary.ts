import type { VinylLayer } from '../project/schema';

/**
 * Ready-made vinyl groups: several layers that make one design, laid out
 * around (0, 0) in a side's view (metres). Inserting one puts it where the
 * editor is looking, as a group, ready to move, scale and recolour.
 */

export type LibraryLayer = Partial<Omit<VinylLayer, 'id' | 'side' | 'groupId'>> & Pick<VinylLayer, 'name'>;

export interface VinylGroupDef {
  name: string;
  layers: LibraryLayer[];
}

const WHITE: [number, number, number] = [1, 1, 1];
const BLACK: [number, number, number] = [0.02, 0.02, 0.02];
const RED: [number, number, number] = [0.85, 0.05, 0.05];
const YELLOW: [number, number, number] = [1, 0.85, 0.05];

export const VINYL_GROUPS: VinylGroupDef[] = [
  {
    name: 'Race number roundel',
    layers: [
      { name: 'Roundel', kind: 'shape', shape: 'circle', w: 0.55, h: 0.55, color: WHITE, slot: 0 },
      { name: 'Roundel rim', kind: 'shape', shape: 'ring', w: 0.6, h: 0.6, color: BLACK, slot: 2 },
      { name: 'Number', kind: 'text', text: '23', font: 'Impact', w: 0.34, h: 0.36, color: BLACK, slot: 2 },
    ],
  },
  {
    name: 'Number board',
    layers: [
      { name: 'Board', kind: 'shape', shape: 'rounded', w: 0.7, h: 0.5, color: WHITE, slot: 0 },
      { name: 'Number', kind: 'text', text: '7', font: 'Arial Black', w: 0.3, h: 0.4, color: BLACK, slot: 2 },
    ],
  },
  {
    name: 'Sponsor block',
    layers: [
      { name: 'Block', kind: 'shape', shape: 'parallelogram', w: 1.1, h: 0.26, color: BLACK, slot: 2 },
      { name: 'Sponsor', kind: 'text', text: 'SPONSOR', font: 'Arial Black', italic: true, w: 0.85, h: 0.16, color: WHITE, slot: 0 },
    ],
  },
  {
    name: 'Hot-rod flames',
    layers: [
      { name: 'Flames', kind: 'shape', shape: 'flames-side', w: 1.9, h: 0.7, x: 0.3, fill: 'linear', color: YELLOW, color2: RED, gradientAngle: 0, slot: 1, slot2: 2 },
      { name: 'Flame lick', kind: 'shape', shape: 'flame', w: 0.3, h: 0.5, x: -0.55, y: 0.05, rotation: -90, fill: 'linear', color: YELLOW, color2: RED, gradientAngle: 90, slot: 1, slot2: 2 },
    ],
  },
  {
    name: 'Side stripe with pinstripe',
    layers: [
      { name: 'Stripe', kind: 'shape', shape: 'bar', w: 3.6, h: 0.3, fill: 'linear', color: RED, color2: BLACK, gradientAngle: 0, slot: 1, slot2: 2 },
      { name: 'Pinstripe', kind: 'shape', shape: 'bar', w: 3.6, h: 0.06, y: 0.1, color: WHITE, slot: 0 },
    ],
  },
  {
    name: 'Speed chevrons',
    layers: [
      { name: 'Chevron 1', kind: 'shape', shape: 'chevron', w: 0.3, h: 0.4, x: -0.35, color: RED, slot: 1, opacity: 0.4 },
      { name: 'Chevron 2', kind: 'shape', shape: 'chevron', w: 0.3, h: 0.4, x: 0, color: RED, slot: 1, opacity: 0.7 },
      { name: 'Chevron 3', kind: 'shape', shape: 'chevron', w: 0.3, h: 0.4, x: 0.35, color: RED, slot: 1 },
    ],
  },
  {
    name: 'Chequered band',
    layers: [
      { name: 'Checks left', kind: 'shape', shape: 'checker', w: 0.4, h: 0.4, x: -0.4, color: BLACK, slot: 2 },
      { name: 'Checks middle', kind: 'shape', shape: 'checker', w: 0.4, h: 0.4, x: 0, color: BLACK, slot: 2 },
      { name: 'Checks right', kind: 'shape', shape: 'checker', w: 0.4, h: 0.4, x: 0.4, color: BLACK, slot: 2 },
    ],
  },
  {
    name: 'Tribal sweep',
    layers: [
      { name: 'Sweep', kind: 'shape', shape: 'tribal', w: 1.2, h: 0.6, color: BLACK, slot: 2 },
      { name: 'Sweep echo', kind: 'shape', shape: 'tribal', w: 1.2, h: 0.6, x: 0.9, flipX: true, color: BLACK, slot: 2 },
    ],
  },
  {
    name: 'Claw rip',
    layers: [
      { name: 'Claws', kind: 'shape', shape: 'claw', w: 0.7, h: 0.8, rotation: -20, color: BLACK, slot: 2 },
      { name: 'Claws glow', kind: 'shape', shape: 'claw', w: 0.62, h: 0.72, rotation: -20, color: RED, slot: 1, mode: 'clip' },
    ],
  },
  {
    name: 'Stars and bars',
    layers: [
      { name: 'Bar', kind: 'shape', shape: 'bar', w: 1.2, h: 0.5, color: [0.05, 0.15, 0.6], slot: 1 },
      { name: 'Roundel', kind: 'shape', shape: 'circle', w: 0.5, h: 0.5, color: WHITE, slot: 0 },
      { name: 'Star', kind: 'shape', shape: 'star', w: 0.46, h: 0.46, color: [0.05, 0.15, 0.6], slot: 1 },
    ],
  },
];
