import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseIni, readAcdTrying } from '@shared/ac/files';
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

/** What a model file is, from its name: "Detailed (LOD A)", "Far (LOD C)", "Collider", "Driver". */
export function modelLabel(name: string): string {
  const stem = basename(name, extname(name));
  if (/collider/i.test(stem)) return 'Collider (the game’s collision shape)';
  if (/driver/i.test(stem)) return 'Driver';
  const lod = stem.match(/_lod_([a-z])$/i)?.[1]?.toUpperCase();
  if (!lod || lod === 'A') return `Detailed (${stem})`;
  return `${lod === 'B' ? 'Medium' : 'Far'} detail, LOD ${lod} (${stem})`;
}

async function listModels(folder: string, main: string | null): Promise<AcCarInfo['models']> {
  const out: AcCarInfo['models'] = [];
  for (const name of await readdir(folder)) {
    if (extname(name).toLowerCase() !== '.kn5') continue;
    const path = join(folder, name);
    out.push({ path, label: modelLabel(name), bytes: (await stat(path)).size });
  }
  const rank = (m: AcCarInfo['models'][number]) => (m.path === main ? 0 : /collider|driver/i.test(basename(m.path)) ? 2 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
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
      // Packed data is keyed to the folder name it was packed under: try that, then names the car
      // may have had (its model file, its UI name) in case the folder was renamed since.
      const uiText = existsSync(join(folder, 'ui', 'ui_car.json')) ? await readFile(join(folder, 'ui', 'ui_car.json'), 'utf8') : '';
      const uiName = uiText.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? '';
      const stems = (await readdir(folder)).filter((f) => extname(f).toLowerCase() === '.kn5' && !/collider/i.test(f)).map((f) => basename(f, extname(f)).replace(/_lod_[a-z]$/i, ''));
      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const candidates = [carId, carId.replace(/\s+/g, '_'), carId.replace(/\s+/g, ''), ...stems, ...stems.map((s) => `ks_${s}`), slug(uiName), slug(carId)];
      const { files: unpacked, folderName } = readAcdTrying(await readFile(acd), candidates);
      if (folderName !== carId) warnings.push(`data.acd was packed for a folder called "${folderName}": read it with that name.`);
      for (const [name, bytes] of Object.entries(unpacked)) keep(`data/${name}`, bytes);
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
  return { folder, carId, kn5, models: await listModels(folder, kn5), skins, files, warnings };
}
