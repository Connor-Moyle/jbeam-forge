/// <reference lib="webworker" />
/**
 * Physics sandbox worker (SPEC §4.6, §2: "Physics solver in a dedicated Web
 * Worker, flat typed arrays, transferable position updates"). Runs the solver
 * in real time (or slow motion), streams positions + beam stress to the
 * viewport, and runs one-click scenarios on demand.
 */
import { Solver, type SimModel } from '@shared/sim/solver';
import { cornerDrop, crash, drop, hingeSwing, hingeYank, settle, yank, type ScenarioResult } from '@shared/sim/scenarios';
import type { SimRequest, SimFrame } from '@shared/sim/protocol';
import { createWorkerLogger, installWorkerErrorHandlers } from './logBridge';

const logger = createWorkerLogger('worker:sim');
installWorkerErrorHandlers(logger);

let model: SimModel | null = null;
let solver: Solver | null = null;
let running = false;
let speed = 1;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let drag: { node: number; target: [number, number, number] } | null = null;
let hzWindow: { t: number; steps: number } = { t: 0, steps: 0 };
let hz = 0;

const FRAME_MS = 16;
const MAX_STEPS_PER_FRAME = 400;
const DRAG_STIFFNESS = 2000; // N/m per kg of the dragged node (a soft "hand")

function post(frame: SimFrame, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(frame, transfer);
}

function sendFrame(): void {
  if (!solver) return;
  const positions = new Float32Array(solver.x);
  const stress = new Float32Array(solver.m);
  for (let b = 0; b < solver.m; b++) {
    const s = solver.model.strength[b]!;
    const lim = Number.isFinite(s) ? s : Math.max(1, solver.model.deform[b]! * 3);
    stress[b] = solver.broken[b] ? -1 : solver.beamForce[b]! / lim;
  }
  post({ type: 'frame', positions, stress, steps: solver.steps, seconds: solver.steps * solver.dt, broken: solver.breakLog.length, hz, diverged: solver.divergence ? { nodeId: solver.divergence.nodeId, speed: solver.divergence.speed } : null }, [positions.buffer, stress.buffer]);
}

function tick(): void {
  if (!solver || !running) return;
  const now = performance.now();
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.round((elapsed * speed) / solver.dt));
  solver.extForce.fill(0);
  if (drag) {
    const i = drag.node;
    const m = solver.model.mass[i]! || 1;
    for (let k = 0; k < 3; k++) solver.extForce[i * 3 + k] = DRAG_STIFFNESS * m * (drag.target[k]! - solver.x[i * 3 + k]!) - 20 * m * solver.v[i * 3 + k]!;
  }
  const ok = solver.step(steps);
  hzWindow.steps += steps;
  if (now - hzWindow.t > 500) {
    hz = (hzWindow.steps / (now - hzWindow.t)) * 1000;
    hzWindow = { t: now, steps: 0 };
  }
  sendFrame();
  if (!ok) {
    running = false;
    post({ type: 'paused', reason: 'diverged' });
  }
}

function runScenario(req: Extract<SimRequest, { type: 'scenario' }>): ScenarioResult | null {
  if (!model) return null;
  switch (req.id) {
    case 'settle':
      return settle(model);
    case 'drop':
      return drop(model, req.height ?? 1);
    case 'corner-drop':
      return cornerDrop(model, req.angleDeg ?? 20);
    case 'yank':
      return req.partId ? yank(model, req.partId) : null;
    case 'crash-pole':
      return crash(model, 'pole', req.kmh ?? 50);
    case 'crash-wall':
      return crash(model, 'wall', req.kmh ?? 50);
    case 'crash-offset':
      return crash(model, 'offset', req.kmh ?? 50);
    case 'hinge-swing':
      return req.hinge ? hingeSwing(model, req.hinge) : null;
    case 'hinge-yank':
      return req.hinge ? hingeYank(model, req.hinge) : null;
    case 'suspension-drop':
      return null;
  }
}

self.addEventListener('message', (e: MessageEvent<SimRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'load':
      model = req.model;
      solver = new Solver(model);
      running = false;
      post({ type: 'loaded', nodes: solver.n, beams: solver.m });
      sendFrame();
      break;
    case 'run':
      if (!solver) return;
      speed = req.speed;
      if (!running) {
        running = true;
        last = performance.now();
        hzWindow = { t: last, steps: 0 };
        timer ??= setInterval(tick, FRAME_MS);
      }
      break;
    case 'pause':
      running = false;
      break;
    case 'reset':
      solver?.reset();
      drag = null;
      sendFrame();
      break;
    case 'gravity':
      if (solver) solver.gravityOn = req.on;
      break;
    case 'drag':
      drag = req.node === null ? null : { node: req.node, target: req.target };
      break;
    case 'scenario': {
      running = false;
      const started = performance.now();
      const result = runScenario(req);
      if (!result) return;
      logger.info(`scenario ${req.id}: ${Math.round(performance.now() - started)} ms — ${result.summary.join(' ')}`);
      post({ type: 'result', result }, [result.positions.buffer, result.beamStress.buffer, result.nodeDisplacement.buffer, result.beamPlastic.buffer]);
      break;
    }
    case 'dispose':
      if (timer) clearInterval(timer);
      timer = null;
      solver = null;
      model = null;
      break;
  }
});
