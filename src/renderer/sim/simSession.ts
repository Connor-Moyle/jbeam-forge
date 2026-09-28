import { create } from 'zustand';
import { projectStore } from '@renderer/app/stores/project';
import { attachWorkerLogRelay } from '@renderer/diagnostics/workerRelay';
import { rlog } from '@renderer/diagnostics/logger';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { buildSimModel, precheck, type PrecheckIssue } from '@shared/sim/model';
import type { Obstacle, SimModel } from '@shared/sim/solver';
import type { HingeSpec, ScenarioId, ScenarioResult } from '@shared/sim/scenarios';
import type { SimFrame, SimRequest } from '@shared/sim/protocol';

const logger = rlog('sim');

/**
 * Test Mode session (SPEC §4.6): owns the physics worker, the simulated model
 * (the default configuration), static pre-checks and scenario results. Live
 * frames arrive at ~60 Hz and are handed to subscribers directly (the
 * viewport), never through React state.
 */

export interface LiveStats {
  seconds: number;
  hz: number;
  broken: number;
  diverged: { nodeId: string; speed: number } | null;
}

interface SimState {
  active: boolean;
  running: boolean;
  speed: number;
  gravity: boolean;
  nodes: number;
  beams: number;
  issues: PrecheckIssue[];
  stats: LiveStats;
  result: ScenarioResult | null;
  busy: ScenarioId | null;
  set: (patch: Partial<SimState>) => void;
}

const EMPTY_STATS: LiveStats = { seconds: 0, hz: 0, broken: 0, diverged: null };

export const useSim = create<SimState>()((set) => ({
  active: false,
  running: false,
  speed: 1,
  gravity: true,
  nodes: 0,
  beams: 0,
  issues: [],
  stats: EMPTY_STATS,
  result: null,
  busy: null,
  set: (patch) => set(patch),
}));

export interface LiveFrame {
  model: SimModel;
  positions: Float32Array;
  /** Per beam |force| / strength; −1 broken. Scenario results use their max-seen stress. */
  stress: Float32Array;
  /** Obstacles to draw (crash scenarios). */
  obstacles?: Obstacle[];
}

type FrameListener = (frame: LiveFrame | null) => void;
const listeners = new Set<FrameListener>();
let worker: Worker | null = null;
let detachRelay: (() => void) | null = null;
let model: SimModel | null = null;
let latest: LiveFrame | null = null;
let statsAt = 0;

export function onSimFrame(listener: FrameListener): () => void {
  listeners.add(listener);
  listener(latest);
  return () => void listeners.delete(listener);
}

function emit(frame: LiveFrame | null): void {
  latest = frame;
  for (const l of listeners) l(frame);
}

function send(req: SimRequest): void {
  worker?.postMessage(req);
}

function onMessage(e: MessageEvent<SimFrame>): void {
  const msg = e.data;
  const sim = useSim.getState();
  if (msg.type === 'loaded') sim.set({ nodes: msg.nodes, beams: msg.beams });
  else if (msg.type === 'frame' && model) {
    emit({ model, positions: msg.positions, stress: msg.stress });
    const now = performance.now();
    if (now - statsAt > 200 || msg.diverged) {
      statsAt = now;
      sim.set({ stats: { seconds: msg.seconds, hz: msg.hz, broken: msg.broken, diverged: msg.diverged } });
    }
  } else if (msg.type === 'paused') sim.set({ running: false });
  else if (msg.type === 'result' && model) {
    const r = msg.result;
    sim.set({ result: r, busy: null, running: false });
    // Show the end state with the max-seen stress (broken beams marked −1).
    const stress = new Float32Array(r.beamStress.length);
    for (let b = 0; b < stress.length; b++) stress[b] = r.beamStress[b]! >= 1.5 ? -1 : r.beamStress[b]!;
    emit({ model, positions: r.positions, stress, obstacles: r.obstacles });
  }
}

/** Enter Test Mode: build the model from the document and start the worker (paused). */
export function startTestMode(): boolean {
  const doc = projectStore.getState().doc;
  if (!doc || doc.nodes.length === 0) return false;
  stopTestMode();
  model = buildSimModel(doc, currentTaxonomy());
  const issues = precheck(model);
  worker = new Worker(new URL('../../workers/sim.worker.ts', import.meta.url), { type: 'module' });
  detachRelay = attachWorkerLogRelay(worker, 'sim');
  worker.addEventListener('message', onMessage);
  useSim.getState().set({ active: true, running: false, issues, result: null, stats: EMPTY_STATS, busy: null, gravity: true });
  send({ type: 'load', model });
  logger.info(`test mode: ${model.mass.length} nodes, ${model.beamA.length} beams, ${issues.length} pre-check issue(s)`);
  return true;
}

export function stopTestMode(): void {
  if (worker) {
    send({ type: 'dispose' });
    detachRelay?.();
    worker.terminate();
  }
  worker = null;
  detachRelay = null;
  model = null;
  emit(null);
  useSim.getState().set({ active: false, running: false, result: null, busy: null });
}

export function run(): void {
  send({ type: 'run', speed: useSim.getState().speed });
  useSim.getState().set({ running: true, result: null });
}

export function pause(): void {
  send({ type: 'pause' });
  useSim.getState().set({ running: false });
}

export function reset(): void {
  send({ type: 'reset' });
  useSim.getState().set({ result: null, stats: EMPTY_STATS });
}

export function setSpeed(speed: number): void {
  useSim.getState().set({ speed });
  if (useSim.getState().running) send({ type: 'run', speed });
}

export function setGravity(on: boolean): void {
  useSim.getState().set({ gravity: on });
  send({ type: 'gravity', on });
}

/** Grab a node and pull it towards a point (BeamNG space), or release with null. */
export function dragNode(node: number | null, target: [number, number, number] = [0, 0, 0]): void {
  send({ type: 'drag', node, target });
}

export function runScenario(id: ScenarioId, params: { kmh?: number; partId?: string; hinge?: HingeSpec } = {}): void {
  if (!worker) return;
  useSim.getState().set({ busy: id, running: false });
  send({ type: 'scenario', id, ...params });
}

/** Broken beams of a result grouped by owning part: [partId, count], most first. */
export function brokenByPart(broken: readonly number[]): [string, number][] {
  if (!model) return [];
  const counts = new Map<string, number>();
  for (const b of broken) {
    const p = model.beamPart[b];
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** Node index → id for the live model (for labels). */
export function simNodeId(i: number): string | undefined {
  return model?.nodeIds[i];
}
