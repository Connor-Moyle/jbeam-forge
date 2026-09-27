import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseKn5 } from '@shared/kn5/parse';

/**
 * A kn5 carries its textures inside the file. They're written once to a cache
 * folder (keyed by the file's path, size and date) so the texture pass, the
 * material editor and the exporter can treat them like any other image.
 */
export async function kn5TextureDir(kn5Path: string, cacheRoot: string): Promise<string> {
  const st = await stat(kn5Path);
  const key = createHash('sha1').update(`${resolve(kn5Path)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  const dir = join(cacheRoot, key);
  const done = join(dir, '.complete');
  if (existsSync(done)) return dir;
  const kn5 = parseKn5(await readFile(kn5Path));
  await mkdir(dir, { recursive: true });
  for (const t of kn5.textures) {
    const name = basename(t.name.replace(/\\/g, '/'));
    if (name && t.data.byteLength) await writeFile(join(dir, name), t.data);
  }
  await writeFile(done, '');
  return dir;
}
