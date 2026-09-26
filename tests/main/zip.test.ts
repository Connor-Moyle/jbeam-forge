import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { safeJoin, withZip, ZipReader } from '../../src/main/beamng/zip';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jbf-zip-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeZip(files: Record<string, string | Buffer>, opts: { zip64?: boolean } = {}): Promise<string> {
  const path = join(dir, 'test.zip');
  const z = new yazl.ZipFile();
  for (const [name, data] of Object.entries(files)) {
    z.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name, { forceZip64Format: opts.zip64 ?? false });
  }
  z.end();
  await pipeline(z.outputStream, createWriteStream(path));
  return path;
}

describe('ZipReader', () => {
  it('lists file entries and reads text (BOM stripped)', async () => {
    const path = await makeZip({
      'vehicles/covet/covet.jbeam': '\uFEFF{"covet":{}}',
      'vehicles/covet/sub/info.json': '{}',
    });
    await withZip(path, async (zip) => {
      const names = (await zip.entries()).map((e) => e.name).sort();
      expect(names).toEqual(['vehicles/covet/covet.jbeam', 'vehicles/covet/sub/info.json']);
      expect(await zip.readText('vehicles/covet/covet.jbeam')).toBe('{"covet":{}}');
      expect(await zip.has('missing')).toBe(false);
    });
  });

  it('reads zip64-format archives', async () => {
    const path = await makeZip({ 'a.txt': 'hello' }, { zip64: true });
    await withZip(path, async (zip) => expect(await zip.readText('a.txt')).toBe('hello'));
  });

  it('refuses to buffer entries over the limit', async () => {
    const path = await makeZip({ 'big.bin': Buffer.alloc(2048) });
    await withZip(path, async (zip) => {
      await expect(zip.readBuffer('big.bin', 1024)).rejects.toThrow(/stream it instead/);
    });
  });

  it('extracts only filtered entries, with renaming', async () => {
    const path = await makeZip({
      'vehicles/covet/covet.jbeam': 'j',
      'vehicles/covet/covet.dae': 'd',
      'vehicles/covet/covet_bumper_R _midengine.jbeam': 'space',
    });
    const out = join(dir, 'out');
    await withZip(path, async (zip) => {
      const written = await zip.extract(
        (n) => n.endsWith('.jbeam'),
        out,
        (n) => n.replace('vehicles/covet/', ''),
      );
      expect(written).toHaveLength(2);
    });
    expect(await readFile(join(out, 'covet_bumper_R _midengine.jbeam'), 'utf8')).toBe('space');
    await expect(readFile(join(out, 'covet.dae'))).rejects.toThrow();
  });

  it('errors clearly for missing entries', async () => {
    const path = await makeZip({ 'a.txt': 'x' });
    const zip = await ZipReader.open(path);
    await expect(zip.readText('nope')).rejects.toThrow(/Entry not found/);
    zip.close();
  });
});

describe('safeJoin', () => {
  it('joins normal relative paths', () => {
    expect(safeJoin(dir, 'a/b.txt')).toBe(join(dir, 'a', 'b.txt'));
  });

  it.each(['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:\\Windows\\x', 'C:evil'])('rejects %s', (name) => {
    expect(() => safeJoin(dir, name)).toThrow(/Refusing/);
  });
});

describe('ZipReader — regressions', () => {
  it('handles concurrent first calls with a single central-directory pass', async () => {
    const files = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}.txt`, `v${i}`]));
    const path = await makeZip(files);
    await withZip(path, async (zip) => {
      const [a, b, c, entries] = await Promise.all([zip.has('f0.txt'), zip.has('f49.txt'), zip.readText('f25.txt'), zip.entries()]);
      expect([a, b, c]).toEqual([true, true, 'v25']);
      expect(entries).toHaveLength(50);
    });
  });
});
