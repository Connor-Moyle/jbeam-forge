import { blendWeights, firingHz } from '@shared/powertrain/revMath';
import { call } from '@renderer/diagnostics/ipc';

/**
 * The engine's sound in the app, revved with a slider. With the install's
 * sound blend readable, it plays the game's own recorded samples: the two
 * recorded nearest the rpm, crossfaded and pitched to it, on-load and
 * off-load mixed by throttle (a close cousin of what the game's audio engine
 * does). Otherwise it synthesizes one from the firing frequency (rpm ×
 * cylinders / 2), which gives the character but not the car's real voice.
 */

export interface Sample {
  path: string;
  rpm: number;
  load: number;
}

interface Voice {
  sample: Sample;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

const MAX_SAMPLES = 16;
const SMOOTH = 0.04;

export class RevPreview {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  private synth: { oscs: { osc: OscillatorNode; mult: number }[]; filter: BiquadFilterNode; noise: AudioBufferSourceNode; noiseGain: GainNode; noiseFilter: BiquadFilterNode } | null = null;
  private rpm = 1000;
  private load = 0.3;
  /** "samples" when the game's recordings are playing. */
  mode: 'samples' | 'synth' | null = null;

  /** Start: the blend's samples when they load, else the synthesizer. */
  async start(blend: string | null, cylinders: number): Promise<'samples' | 'synth'> {
    this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    let samples: Sample[] = [];
    if (blend) samples = await call('beamng:soundSamples', { name: blend }).catch(() => []);
    if (samples.length) {
      const pick = samples.length > MAX_SAMPLES ? samples.filter((_, i) => i % Math.ceil(samples.length / MAX_SAMPLES) === 0) : samples;
      const loaded = await Promise.all(
        pick.map(async (s) => {
          const bytes = await call('beamng:soundFile', { path: s.path }).catch(() => null);
          if (!bytes) return null;
          try {
            return { s, buffer: await ctx.decodeAudioData(bytes.slice().buffer) };
          } catch {
            return null;
          }
        }),
      );
      for (const l of loaded) {
        if (!l || this.ctx !== ctx) continue;
        const src = ctx.createBufferSource();
        src.buffer = l.buffer;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.master);
        src.start();
        this.voices.push({ sample: l.s, src, gain });
      }
    }
    if (this.ctx !== ctx) return 'synth';
    if (this.voices.length) this.mode = 'samples';
    else {
      this.startSynth(ctx, cylinders);
      this.mode = 'synth';
    }
    this.update();
    return this.mode;
  }

  private startSynth(ctx: AudioContext, cylinders: number): void {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.connect(this.master!);
    // The firing pulse and its harmonics, and a half-order for uneven firing (the V8 burble).
    const oscs = [
      { type: 'sawtooth' as const, mult: 1, gain: 0.35 },
      { type: 'square' as const, mult: 0.5, gain: cylinders % 2 || cylinders === 8 ? 0.18 : 0.08 },
      { type: 'sine' as const, mult: 2, gain: 0.12 },
    ].map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g).connect(filter);
      osc.start();
      return { osc, mult: o.mult };
    });
    // Intake and exhaust roar: filtered noise that grows with throttle.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.Q.value = 1.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.master!);
    noise.start();
    this.synth = { oscs, filter, noise, noiseGain, noiseFilter };
    this.cylinders = cylinders;
  }

  private cylinders = 4;

  set(rpm: number, load: number): void {
    this.rpm = Math.max(100, rpm);
    this.load = Math.min(1, Math.max(0, load));
    this.update();
  }

  private update(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.mode === 'samples') {
      const on = this.voices.filter((v) => v.sample.load >= 0.5);
      const off = this.voices.filter((v) => v.sample.load < 0.5);
      const sets: [Voice[], number][] = off.length && on.length ? [[on, this.load], [off, 1 - this.load]] : [[this.voices, 1]];
      for (const v of this.voices) v.gain.gain.setTargetAtTime(0, t, SMOOTH);
      for (const [group, mix] of sets) {
        for (const [i, w] of blendWeights(group.map((v) => v.sample.rpm), this.rpm)) {
          const v = group[i]!;
          v.gain.gain.setTargetAtTime(w * mix, t, SMOOTH);
          v.src.playbackRate.setTargetAtTime(this.rpm / v.sample.rpm, t, SMOOTH);
        }
      }
    } else if (this.synth) {
      const f = firingHz(this.rpm, this.cylinders);
      for (const o of this.synth.oscs) o.osc.frequency.setTargetAtTime(f * o.mult, t, SMOOTH);
      this.synth.filter.frequency.setTargetAtTime(300 + this.load * 2500 + this.rpm * 0.25, t, SMOOTH);
      this.synth.noiseFilter.frequency.setTargetAtTime(f * 3, t, SMOOTH);
      this.synth.noiseGain.gain.setTargetAtTime(0.05 + this.load * 0.25, t, SMOOTH);
    }
  }

  stop(): void {
    for (const v of this.voices) v.src.stop();
    this.voices = [];
    if (this.synth) {
      for (const o of this.synth.oscs) o.osc.stop();
      this.synth.noise.stop();
    }
    this.synth = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.mode = null;
  }
}
