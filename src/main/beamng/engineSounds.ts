import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isJbeamObject, parseJbeam, type JbeamValue } from '@shared/jbeam/parse';
import { withZip } from './zip';

/**
 * The game's engine sounds: every sound blend (art/sound/blends/<name>.sfxBlend2D.json)
 * in the install's zips. An engine's soundConfig / soundConfigExhaust names one
 * as its `sampleName`, and the blend lists the recorded samples by rpm and
 * load, which the app can play back for a rev preview.
 */

export interface EngineSound {
  /** What `sampleName` takes. */
  name: string;
  /** Zip holding the blend. */
  zip: string;
  entry: string;
}

export interface SoundSample {
  /** Path in the game's file system ("art/sound/…ogg"). */
  path: string;
  rpm: number;
  /** 0 = off load, 1 = on load (when the blend says). */
  load: number;
}

const BLEND = /(?:^|\/)art\/sound\/blends\/([^/]+)\.sfxBlend2D\.json$/i;
const AUDIO = /\.(ogg|wav|flac)$/i;

async function zipsOf(installDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of [join(installDir, 'content'), join(installDir, 'content', 'vehicles')]) {
    try {
      for (const f of await readdir(dir)) if (f.toLowerCase().endsWith('.zip')) out.push(join(dir, f));
    } catch {
      // not there in this install
    }
  }
  return out;
}

const cache = new Map<string, { sig: string; list: EngineSound[] }>();

export async function scanEngineSounds(installDir: string): Promise<EngineSound[]> {
  const zips = await zipsOf(installDir);
  const sig = (await Promise.all(zips.map(async (z) => `${z}:${(await stat(z)).mtimeMs}`))).join('|');
  const hit = cache.get(installDir);
  if (hit?.sig === sig) return hit.list;
  const seen = new Map<string, EngineSound>();
  for (const zip of zips) {
    try {
      await withZip(zip, async (z) => {
        for (const e of await z.entries()) {
          const m = BLEND.exec(e.name);
          if (m && !seen.has(m[1]!)) seen.set(m[1]!, { name: m[1]!, zip, entry: e.name });
        }
      });
    } catch {
      // unreadable zip: skip
    }
  }
  const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  cache.set(installDir, { sig, list });
  return list;
}

/**
 * The samples a blend plays, by rpm and load. Blends list them as rows or
 * objects holding a file path and its rpm (and sometimes a load); anything
 * shaped like that is taken, so small format changes don't break it.
 */
export function blendSamples(text: string): SoundSample[] {
  const { value } = parseJbeam(text);
  const out: SoundSample[] = [];
  const visit = (v: JbeamValue | undefined, depth: number) => {
    if (depth > 8 || v === undefined || v === null) return;
    if (Array.isArray(v)) {
      const path = v.find((c): c is string => typeof c === 'string' && AUDIO.test(c));
      const nums = v.filter((c): c is number => typeof c === 'number');
      const rpm = nums.find((n) => n >= 200 && n <= 25000);
      if (path && rpm !== undefined) {
        const load = nums.find((n) => n >= 0 && n <= 1 && n !== rpm);
        out.push({ path, rpm, load: load ?? 1 });
        return;
      }
      for (const c of v) visit(c, depth + 1);
      return;
    }
    if (isJbeamObject(v)) {
      const path = Object.values(v).find((c): c is string => typeof c === 'string' && AUDIO.test(c));
      const rpm = typeof v.rpm === 'number' ? v.rpm : typeof v.RPM === 'number' ? v.RPM : undefined;
      if (path && rpm !== undefined) {
        const load = typeof v.load === 'number' ? v.load : 1;
        out.push({ path, rpm, load });
        return;
      }
      for (const c of Object.values(v)) visit(c, depth + 1);
    }
  };
  visit(value, 0);
  return out.sort((a, b) => a.load - b.load || a.rpm - b.rpm);
}

/** A blend's samples (empty when it can't be read). */
export async function engineSoundSamples(installDir: string, name: string): Promise<SoundSample[]> {
  const found = (await scanEngineSounds(installDir)).find((s) => s.name === name);
  if (!found) return [];
  try {
    return await withZip(found.zip, async (z) => blendSamples(await z.readText(found.entry, 4 * 1024 * 1024)));
  } catch {
    return [];
  }
}

/** One sample's bytes, from whichever zip holds it (null when none does). */
export async function readSoundFile(installDir: string, path: string): Promise<Uint8Array | null> {
  if (!AUDIO.test(path) || path.includes('..')) return null;
  const want = path.replace(/^\/+/, '').toLowerCase();
  for (const zip of await zipsOf(installDir)) {
    try {
      const bytes = await withZip(zip, async (z) => {
        const e = (await z.entries()).find((x) => x.name.toLowerCase() === want);
        return e ? z.readBuffer(e.name, 32 * 1024 * 1024) : null;
      });
      if (bytes) return new Uint8Array(bytes);
    } catch {
      // next zip
    }
  }
  return null;
}
