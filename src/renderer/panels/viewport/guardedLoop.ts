/**
 * requestAnimationFrame loop that survives transient frame errors and stops
 * after N consecutive failures instead of spamming errors at 60 Hz
 * (SPEC §3.6: guarded render loop).
 */
export interface GuardedLoopOptions {
  maxConsecutiveErrors: number;
  onFatal: (error: unknown) => void;
  onFrameError?: (error: unknown, consecutive: number) => void;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (handle: number) => void;
}

export class GuardedLoop {
  private handle: number | null = null;
  private consecutiveErrors = 0;
  private readonly raf: (cb: FrameRequestCallback) => number;
  private readonly caf: (handle: number) => void;

  constructor(
    private readonly frame: (time: number) => void,
    private readonly opts: GuardedLoopOptions,
  ) {
    this.raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = opts.caf ?? ((h) => cancelAnimationFrame(h));
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;
    this.consecutiveErrors = 0;
    this.handle = this.raf(this.tick);
  }

  stop(): void {
    if (this.handle !== null) this.caf(this.handle);
    this.handle = null;
  }

  private readonly tick = (time: number): void => {
    if (this.handle === null) return;
    try {
      this.frame(time);
      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;
      this.opts.onFrameError?.(err, this.consecutiveErrors);
      if (this.consecutiveErrors >= this.opts.maxConsecutiveErrors) {
        this.handle = null;
        this.opts.onFatal(err);
        return;
      }
    }
    if (this.handle !== null) this.handle = this.raf(this.tick);
  };
}
