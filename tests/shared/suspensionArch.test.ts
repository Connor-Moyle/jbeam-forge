import { describe, expect, it } from 'vitest';
import { archWarning, nodesFoulingTyres, nodesInTyre, tyreOf } from '../../src/shared/suspension/arch';

describe('a tyre against the car’s own structure', () => {
  it('reads a tyre’s size from the game’s wheel table', () => {
    expect(tyreOf({ pressureWheels: [['name', 'hubGroup', 'group', 'node1:', 'node2:'], { hubRadius: 0.2 }, { radius: 0.36 }, { tireWidth: 0.24, radius: 0.355 }, ['FR', 'wheel_FR', 'tire_FR', 'fw1rr', 'fw1r']] })).toEqual({ radius: 0.36, width: 0.24 });
    expect(tyreOf({ pressureWheels: [['name'], { hubRadius: 0.2 }] })).toBeNull();
    expect(tyreOf({})).toBeNull();
  });

  const wheel = { centre: [0.75, -1.3, 0.33], axis: [1, 0, 0] } as const;
  const tyre = { radius: 0.36, width: 0.24 };
  const nodes = [
    { id: 'fe8l', part: 'Wing L', pos: [0.8, -1.05, 0.5] as const }, // 30 cm from the axle, between the sidewalls
    { id: 'fe9l', part: 'Wing L', pos: [0.8, -1.3, 0.68] as const }, // brushing the tread: 1 cm in
    { id: 'fe2l', part: 'Wing L', pos: [0.8, -1.3, 0.75] as const }, // above the tyre
    { id: 'b9l', part: 'Body', pos: [0.55, -1.3, 0.4] as const }, // inboard of the tyre
  ];

  it('finds the nodes that start inside it, and no others', () => {
    expect(nodesInTyre(wheel, tyre, nodes).map((n) => n.id)).toEqual(['fe8l']);
    expect(nodesInTyre(wheel, { radius: 0.28, width: 0.18 }, nodes)).toEqual([]);
    // Where only the hub face is known, the tyre is outboard of it: the body's node inboard doesn't count.
    const hub = { centre: [0.6, -1.3, 0.33], axis: [1, 0, 0], exact: false } as const;
    expect(nodesInTyre(hub, tyre, nodes).map((n) => n.id)).toEqual(['fe8l']);
  });

  it('lets one shallow arch-lip node a side pass, and speaks up for a deep one or several', () => {
    const lip = [{ pos: [0.75, -1.3, 0.33 + 0.3] as const }];
    expect(nodesFoulingTyres([wheel], tyre, lip)).toEqual([]);
    expect(nodesFoulingTyres([wheel], tyre, [{ pos: [0.75, -1.3, 0.33 + 0.2] as const }])).toHaveLength(1);
    expect(nodesFoulingTyres([wheel], tyre, [...lip, { pos: [0.75, -1.0, 0.33] as const }])).toHaveLength(2);
  });

  it('says which parts, and what to do', () => {
    const text = archWarning('front', { name: 'Front Suspension', vehicleName: 'Bruckell Bastion' }, tyre, nodesInTyre(wheel, tyre, nodes))!;
    expect(text).toContain('72 cm across, 24 cm wide');
    expect(text).toContain('1 node of Wing L is inside them');
    expect(archWarning('front', { name: 'x', vehicleName: 'y' }, tyre, [])).toBeNull();
  });
});
