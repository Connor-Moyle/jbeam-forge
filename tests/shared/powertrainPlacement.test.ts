import { describe, expect, it } from 'vitest';
import type { JbeamObject } from '../../src/shared/jbeam/parse';
import { blockBounds, blockNodes, gearboxMating, setNodeBounds } from '../../src/shared/powertrain/placement';

const N = ['id', 'posX', 'posY', 'posZ'];

describe('where an engine or gearbox set really is', () => {
  it('is the engine’s block, not its exhaust or mounts', () => {
    const parts: Record<string, JbeamObject> = {
      engine: {
        mainEngine: { idleRPM: 800 },
        nodes: [N, ['e1r', -0.05, -1.3, 0.2], ['e1l', 0.16, -1.3, 0.2], ['e2r', -0.05, -1.9, 0.3], ['e2l', 0.16, -1.9, 0.3], ['e3r', -0.26, -1.3, 0.8], ['e4l', 0.08, -1.9, 0.8], ['em1r', -0.3, -1.6, 0.5]],
      },
      // The exhaust restates the engine's section and runs to the back of its own car.
      exhaust: { mainEngine: { exhaustVolume: 1 }, nodes: [N, ['ex1', 0.3, -1, 0.2], ['ex9', 0.4, 2.3, 0.25]] },
    };
    expect(blockBounds(parts, 'engine')).toEqual({ min: [-0.26, -1.9, 0.2], max: [0.16, -1.3, 0.8] });
  });

  it('is the node a gearbox names as its own', () => {
    const parts: Record<string, JbeamObject> = {
      box: { gearbox: { 'gearboxNode:': ['tra1'] }, nodes: [N, ['tra1', 0, -0.4, 0.35], ['dsh1', 0, 1.9, 0.3]] },
    };
    expect(blockBounds(parts, 'gearbox')).toEqual({ min: [0, -0.4, 0.35], max: [0, -0.4, 0.35] });
  });

  it('puts a gearbox on the engine’s block: its own car’s block points onto the fitted engine’s', () => {
    const engine: Record<string, JbeamObject> = { engine: { mainEngine: {}, nodes: [N, ['e1r', -0.1, -1.1, 0.2], ['e1l', 0.1, -1.1, 0.2], ['e2r', -0.1, -1.7, 0.3], ['e2l', 0.1, -1.7, 0.3]] } };
    // The gearbox was cut from a car whose engine stood 0.4 m further back and 0.05 m higher.
    const anchors = { e1r: [-0.1, -0.7, 0.25], e1l: [0.1, -0.7, 0.25], f3r: [-0.5, 0.2, 0.3] } as const;
    const move = gearboxMating(blockNodes(engine), [0, 0.2, 0.1], anchors)!;
    // e1r and e1l are what the two share: the engine's (moved by its own placement) less the gearbox's.
    expect(move.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, -0.2, 0.05]);
    expect(gearboxMating(blockNodes(engine), [0, 0, 0], { f3r: [0, 0, 0] })).toBeNull();
  });

  it('knows how far a set reaches with everything it brings', () => {
    const parts: Record<string, JbeamObject> = { engine: { nodes: [N, ['e1r', 0, -1.2, 0.2]] }, radiator: { nodes: [N, ['rad1', 0.3, -1.9, 0.6]] } };
    expect(setNodeBounds(parts)).toEqual({ min: [0, -1.9, 0.2], max: [0.3, -1.2, 0.6] });
  });

  it('is unknown for a set with no block nodes (placed by its meshes instead)', () => {
    expect(blockBounds({ motor: { mainEngine: {}, nodes: [N, ['m1', 0, 0, 0]] } }, 'engine')).toBeNull();
  });
});
