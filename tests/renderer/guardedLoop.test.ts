import { describe, expect, it, vi } from 'vitest';
import { GuardedLoop } from '../../src/renderer/panels/viewport/guardedLoop';

function fakeRaf() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  return {
    raf: (cb: FrameRequestCallback) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      queue.delete(id);
    },
    step(t = 16) {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb(t));
    },
    get pending() {
      return queue.size;
    },
  };
}

function setup(frame: (t: number) => void, max = 3) {
  const clock = fakeRaf();
  const onFatal = vi.fn();
  const onFrameError = vi.fn();
  const loop = new GuardedLoop(frame, { maxConsecutiveErrors: max, onFatal, onFrameError, raf: clock.raf, caf: clock.caf });
  return { clock, loop, onFatal, onFrameError };
}

type Frame = (t: number) => void;

const boom: Frame = () => {
  throw new Error('boom');
};

describe('GuardedLoop', () => {
  it('runs one frame per tick and keeps rescheduling', () => {
    const frame = vi.fn();
    const { clock, loop } = setup(frame);
    loop.start();
    expect(clock.pending).toBe(1);
    clock.step();
    clock.step();
    expect(frame).toHaveBeenCalledTimes(2);
    expect(clock.pending).toBe(1);
    expect(loop.running).toBe(true);
  });

  it('start is idempotent', () => {
    const { clock, loop } = setup(vi.fn());
    loop.start();
    loop.start();
    expect(clock.pending).toBe(1);
  });

  it('stop cancels the pending frame', () => {
    const frame = vi.fn();
    const { clock, loop } = setup(frame);
    loop.start();
    loop.stop();
    expect(clock.pending).toBe(0);
    expect(loop.running).toBe(false);
    clock.step();
    expect(frame).not.toHaveBeenCalled();
  });

  it('survives transient errors and resets the count after a good frame', () => {
    const frame = vi.fn<Frame>().mockImplementationOnce(boom).mockImplementationOnce(boom).mockImplementationOnce(() => undefined).mockImplementationOnce(boom).mockImplementationOnce(boom);
    const { clock, loop, onFatal, onFrameError } = setup(frame);
    loop.start();
    for (let i = 0; i < 5; i++) clock.step();
    expect(onFrameError.mock.calls.map((c) => c[1] as number)).toEqual([1, 2, 1, 2]);
    expect(onFatal).not.toHaveBeenCalled();
    expect(loop.running).toBe(true);
  });

  it('stops and reports fatal after N consecutive errors', () => {
    const frame = vi.fn<Frame>(boom);
    const { clock, loop, onFatal } = setup(frame);
    loop.start();
    clock.step();
    clock.step();
    clock.step();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(loop.running).toBe(false);
    expect(clock.pending).toBe(0);
    clock.step();
    expect(frame).toHaveBeenCalledTimes(3);
  });

  it('can be restarted after a fatal stop', () => {
    const frame = vi.fn<Frame>(boom);
    const { clock, loop, onFatal } = setup(frame);
    loop.start();
    for (let i = 0; i < 3; i++) clock.step();
    expect(onFatal).toHaveBeenCalledTimes(1);
    frame.mockImplementation(() => undefined);
    loop.start();
    expect(loop.running).toBe(true);
    clock.step();
    expect(frame).toHaveBeenCalledTimes(4);
    expect(loop.running).toBe(true);
  });
});
