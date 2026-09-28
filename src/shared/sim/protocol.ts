import type { SimModel } from './solver';
import type { HingeSpec, ScenarioId, ScenarioResult } from './scenarios';

/** Messages between the renderer and the physics sandbox worker. */
export type SimRequest =
  | { type: 'load'; model: SimModel }
  | { type: 'run'; speed: number }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'gravity'; on: boolean }
  | { type: 'drag'; node: number | null; target: [number, number, number] }
  | { type: 'scenario'; id: ScenarioId; height?: number; angleDeg?: number; kmh?: number; partId?: string; hinge?: HingeSpec }
  | { type: 'dispose' };

export type SimFrame =
  | { type: 'loaded'; nodes: number; beams: number }
  | {
      type: 'frame';
      positions: Float32Array;
      /** Per beam |force| / strength; −1 = broken. */
      stress: Float32Array;
      steps: number;
      seconds: number;
      broken: number;
      /** Achieved solver rate (steps per wall-clock second). */
      hz: number;
      diverged: { nodeId: string; speed: number } | null;
    }
  | { type: 'paused'; reason: 'diverged' }
  | { type: 'result'; result: ScenarioResult };
