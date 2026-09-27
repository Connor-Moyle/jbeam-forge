/**
 * Assetto Corsa data files: INI (car.ini, engine.ini, ext_config.ini…), LUT
 * curves ("x|y" per line), and data.acd, the packed form of a car's data/
 * folder. data.acd is only scrambled with a key made from the car's folder
 * name, so a car installed locally can be read the same way the game does.
 */

export type Ini = Record<string, Record<string, string>>;

/** Sections and keys are upper-cased (AC is case-insensitive); `;` and `//` start comments. */
export function parseIni(text: string): Ini {
  const out: Ini = {};
  let section: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*(;|\/\/).*$/, '').trim();
    if (!line) continue;
    const head = line.match(/^\[([^\]]+)\]$/);
    if (head) {
      const name = head[1]!.trim().toUpperCase();
      section = out[name] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || !section) continue;
    section[line.slice(0, eq).trim().toUpperCase()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function iniNumber(ini: Ini | undefined, section: string, key: string): number | null {
  const v = ini?.[section.toUpperCase()]?.[key.toUpperCase()];
  if (v === undefined) return null;
  const n = Number.parseFloat(v.split(',')[0]!);
  return Number.isFinite(n) ? n : null;
}

/** A LUT curve: "x|y" per line; comments and junk lines are skipped. */
export function parseLut(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*(;|\/\/).*$/, '').trim();
    const bar = line.indexOf('|');
    if (bar < 0) continue;
    const x = Number.parseFloat(line.slice(0, bar));
    const y = Number.parseFloat(line.slice(bar + 1));
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

// ---------------------------------------------------------------- data.acd

/** Signed 32-bit division and remainder the way the game's (C-style) integer maths does them. */
const div = (a: number, b: number) => (b === 0 ? 0 : Math.trunc(a / b) | 0);
const mod = (a: number, b: number) => (b === 0 ? 0 : a % b | 0);

/** The data.acd key for a car folder name (e.g. "ks_mazda_mx5_cup"). */
export function acdKey(folderName: string): string {
  const s = [...folderName.toLowerCase()].map((c) => c.charCodeAt(0));
  const n = s.length;
  let k1 = 0;
  for (const c of s) k1 = (k1 + c) | 0;
  let k2 = 0;
  for (let i = 0; i < n - 1; i += 2) {
    k2 = Math.imul(k2, s[i]!);
    k2 = (k2 - s[i + 1]!) | 0;
  }
  let k3 = 0;
  for (let i = 1; i < n - 3; i += 3) {
    k3 = Math.imul(k3, s[i]!);
    k3 = div(k3, s[i + 1]! + 0x1b);
    k3 = (k3 + (-0x1b - s[i - 1]!)) | 0;
  }
  let k4 = 0x1683;
  for (let i = 1; i < n; i++) k4 = (k4 - s[i]!) | 0;
  let k5 = 0x42;
  for (let i = 1; i < n - 4; i += 4) {
    k5 = Math.imul(Math.imul(s[i]! + 0xf, k5), s[i - 1]! + 0xf);
    k5 = (k5 + 0x16) | 0;
  }
  let k6 = 0x65;
  for (let i = 0; i < n - 2; i += 2) k6 = (k6 - s[i]!) | 0;
  let k7 = 0xab;
  for (let i = 0; i < n - 2; i += 2) k7 = mod(k7, s[i]!);
  let k8 = 0xab;
  for (let i = 0; i < n - 1; i++) {
    k8 = div(k8, s[i]!);
    k8 = (k8 + s[i + 1]!) | 0;
  }
  return [k1, k2, k3, k4, k5, k6, k7, k8].map((k) => k & 0xff).join('-');
}

/**
 * Unpack data.acd when the car folder may have been renamed since it was
 * packed: tries each candidate folder name in turn. Returns the files and
 * the name that worked.
 */
export function readAcdTrying(bytes: Uint8Array, candidates: readonly string[]): { files: Record<string, Uint8Array>; folderName: string } {
  let last: unknown = null;
  for (const name of [...new Set(candidates.filter(Boolean))]) {
    try {
      return { files: readAcd(bytes, name), folderName: name };
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('data.acd could not be unpacked');
}

/** Unpack data.acd: file name → bytes. Throws if the file is not an acd or the key is wrong. */
export function readAcd(bytes: Uint8Array, folderName: string): Record<string, Uint8Array> {
  const key = [...acdKey(folderName)].map((c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const latin1 = new TextDecoder('latin1');
  const out: Record<string, Uint8Array> = {};
  let pos = 0;
  const i32 = () => {
    if (pos + 4 > bytes.byteLength) throw new Error('data.acd ends early');
    const v = view.getInt32(pos, true);
    pos += 4;
    return v;
  };
  while (pos < bytes.byteLength) {
    let nameLength = i32();
    if (nameLength === -1111) {
      i32(); // newer files start with a small header
      nameLength = i32();
    }
    if (nameLength <= 0 || nameLength > 1024 || pos + nameLength > bytes.byteLength) throw new Error('data.acd is damaged or not an acd file');
    const name = latin1.decode(bytes.subarray(pos, pos + nameLength));
    pos += nameLength;
    const length = i32();
    if (length < 0 || pos + length * 4 > bytes.byteLength) throw new Error(`data.acd entry ${name} is damaged`);
    const data = new Uint8Array(length);
    // Each byte is stored in the low byte of a 32-bit slot, shifted by the key.
    for (let i = 0; i < length; i++) data[i] = (bytes[pos + i * 4]! - key[i % key.length]!) & 0xff;
    pos += length * 4;
    out[name] = data;
  }
  const car = out['car.ini'];
  if (car && !/\[[A-Z_]+\]/.test(latin1.decode(car.subarray(0, 4096)))) throw new Error('data.acd did not unpack with this folder name (was the car folder renamed?)');
  return out;
}
