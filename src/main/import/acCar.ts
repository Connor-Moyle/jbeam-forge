import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseIni, readAcd } from '@shared/ac/files';
import type { AcCarInfo } from '@shared/ipc-contract';

/**
 * Reads an Assetto Corsa car folder (content/cars/<id>): its main kn5, the
 * skins, and the text of its data files (data/ or data.acd), ui_car.json and
 * the Custom Shaders Patch extension folder.
 */

const TEXT_EXTENSIONS = new Set(['.ini', '.lut', '.rto', '.json', '.lua', '.txt', '.csv']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/** UTF-8 when it is valid, else Windows-1252 (older AC files). */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function listFiles(dir: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...(await listFiles(full, depth - 1)).map((p) => `${e.name}/${p}`));
    else if (e.isFile()) out.push(e.name);
  }
  return out;
}

/** The kn5 the game draws up close: lods.ini's LOD_0, else the biggest that isn't a collider or a far LOD. */
async function mainKn5(folder: string, lodsIni: string | undefined): Promise<string | null> {
  const lod0 = lodsIni ? parseIni(lodsIni).LOD_0?.FILE : undefined;
  if (lod0 && existsSync(join(folder, lod0))) return join(folder, lod0);
  let best: { path: string; size: number } | null = null;
  for (const name of await readdir(folder)) {
    if (extname(name).toLowerCase() !== '.kn5' || /collider|_lod_[b-z]\b|driver/i.test(name)) continue;
    const size = (await stat(join(folder, name))).size;
    if (!best || size > best.size) best = { path: join(folder, name), size };
  }
  return best?.path ?? null;
}

export async function readAcCar(folder: string): Promise<AcCarInfo> {
  const carId = basename(folder);
  const files: Record<string, string> = {};
  const warnings: string[] = [];
  let total = 0;
  const keep = (path: string, bytes: Uint8Array) => {
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return;
    if (bytes.byteLength > MAX_FILE_BYTES || total + bytes.byteLength > MAX_TOTAL_BYTES) {
      warnings.push(`${path} was left out (too large to keep with the project)`);
      return;
    }
    total += bytes.byteLength;
    files[path] = decodeText(bytes);
  };

  const dataDir = join(folder, 'data');
  const acd = join(folder, 'data.acd');
  if (existsSync(dataDir)) {
    for (const name of await listFiles(dataDir, 0)) keep(`data/${name}`, await readFile(join(dataDir, name)));
  } else if (existsSync(acd)) {
    try {
      for (const [name, bytes] of Object.entries(readAcd(await readFile(acd), carId))) keep(`data/${name}`, bytes);
    } catch (err) {
      warnings.push(`data.acd could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    warnings.push('No data folder or data.acd: only the model and its textures come in.');
  }
  const ui = join(folder, 'ui', 'ui_car.json');
  if (existsSync(ui)) keep('ui/ui_car.json', await readFile(ui));
  for (const rel of await listFiles(join(folder, 'extension'), 2)) keep(`extension/${rel}`, await readFile(join(folder, 'extension', rel)));

  const kn5 = await mainKn5(folder, files['data/lods.ini']);
  if (!kn5) warnings.push('No kn5 model found in the folder.');
  const skinsDir = join(folder, 'skins');
  const skins = existsSync(skinsDir)
    ? (await readdir(skinsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
    : [];
  return { folder, carId, kn5, skins, files, warnings };
}
