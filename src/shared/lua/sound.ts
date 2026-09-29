/**
 * A seamless looping wind sound (fork), made with the export so the wind
 * noise script has something to play without shipping a recording: brown
 * noise (random walk, low-passed) with a slow gust swell, the loop's ends
 * cross-faded so it repeats without a click. 16-bit mono WAV.
 */

/** Small seeded generator: the same bytes on every export. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function windNoiseWav(seconds = 3, rate = 22050): Uint8Array {
  const n = Math.round(seconds * rate);
  const fade = Math.round(rate * 0.25);
  const raw = new Float32Array(n + fade);
  const rand = rng(1234);
  let brown = 0;
  let low = 0;
  for (let i = 0; i < raw.length; i++) {
    brown = (brown + (rand() * 2 - 1) * 0.02) * 0.998;
    low += (brown - low) * 0.25;
    const gust = 0.75 + 0.25 * Math.sin((2 * Math.PI * i) / (n / 2));
    raw[i] = low * gust;
  }
  // Cross-fade the tail into the head so the loop is seamless.
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i]!;
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = raw[i]! * k + raw[n + i]! * (1 - k);
  }
  let peak = 1e-9;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round((out[i]! / peak) * 0.8 * 32767), true);
  return bytes;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of bytes, in any environment. */
export function base64Of(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? '=' : B64[c & 63]!);
  }
  return out;
}
