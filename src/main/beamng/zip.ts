import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { stripBom } from '@shared/logger';

/**
 * Lazy zip access for BeamNG content. Official zips are huge (common.zip is
 * ~4 GB, zip64), so we only ever read the central directory and stream the
 * entries we need — never load a whole archive into memory.
 */

export interface ZipEntryInfo {
  name: string;
  size: number;
  compressedSize: number;
}

export class ZipReader {
  private entryMap: Promise<Map<string, Entry>> | null = null;

  private constructor(
    private readonly zip: ZipFile,
    readonly path: string,
  ) {}

  static open(path: string): Promise<ZipReader> {
    return new Promise((res, rej) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zip) => {
        if (err) rej(err);
        else res(new ZipReader(zip, path));
      });
    });
  }

  /** All file entries (directories skipped), read once from the central directory. */
  async entries(): Promise<ZipEntryInfo[]> {
    const map = await this.load();
    return [...map.values()].map((e) => ({ name: e.fileName, size: e.uncompressedSize, compressedSize: e.compressedSize }));
  }

  async has(name: string): Promise<boolean> {
    return (await this.load()).has(name);
  }

  async stream(name: string): Promise<Readable> {
    const entry = (await this.load()).get(name);
    if (!entry) throw new Error(`Entry not found in ${this.path}: ${name}`);
    return this.zip.openReadStreamPromise(entry);
  }

  async readBuffer(name: string, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
    const entry = (await this.load()).get(name);
    if (!entry) throw new Error(`Entry not found in ${this.path}: ${name}`);
    if (entry.uncompressedSize > maxBytes) {
      throw new Error(`Entry ${name} is ${entry.uncompressedSize} bytes (limit ${maxBytes}); stream it instead`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of await this.zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async readText(name: string, maxBytes?: number): Promise<string> {
    return stripBom((await this.readBuffer(name, maxBytes)).toString('utf8'));
  }

  /** Stream matching entries to `outDir`, preserving relative paths. Returns written paths. */
  async extract(filter: (name: string) => boolean, outDir: string, rename: (name: string) => string = (n) => n): Promise<string[]> {
    const written: string[] = [];
    for (const [name, entry] of await this.load()) {
      if (!filter(name)) continue;
      const dest = safeJoin(outDir, rename(name));
      await mkdir(dirname(dest), { recursive: true });
      await pipeline(await this.zip.openReadStreamPromise(entry), createWriteStream(dest));
      written.push(dest);
    }
    return written;
  }

  close(): void {
    this.zip.close();
  }

  /**
   * Read the central directory once. The pending promise is cached, so
   * concurrent callers share one pass over yauzl's single entry cursor.
   */
  private load(): Promise<Map<string, Entry>> {
    this.entryMap ??= this.readCentralDirectory();
    return this.entryMap;
  }

  private readCentralDirectory(): Promise<Map<string, Entry>> {
    return new Promise((res, rej) => {
      const map = new Map<string, Entry>();
      const zip = this.zip;
      const cleanup = () => {
        zip.removeListener('entry', onEntry);
        zip.removeListener('end', onEnd);
        zip.removeListener('error', onError);
      };
      const onEntry = (e: Entry) => {
        if (!e.fileName.endsWith('/')) map.set(e.fileName, e);
        zip.readEntry();
      };
      const onEnd = () => {
        cleanup();
        res(map);
      };
      const onError = (err: Error) => {
        cleanup();
        rej(err);
      };
      zip.on('entry', onEntry);
      zip.once('end', onEnd);
      zip.once('error', onError);
      zip.readEntry();
    });
  }
}

/** Join an archive-relative path under `root`, refusing anything that would escape it. */
export function safeJoin(root: string, entryName: string): string {
  if (isAbsolute(entryName) || /^[A-Za-z]:/.test(entryName)) throw new Error(`Refusing absolute entry path: ${entryName}`);
  const base = resolve(root);
  const dest = resolve(join(base, entryName));
  const rel = relative(base, dest);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing entry path outside target: ${entryName}`);
  return dest;
}

/** Open, use, always close. */
export async function withZip<T>(path: string, fn: (zip: ZipReader) => Promise<T>): Promise<T> {
  const zip = await ZipReader.open(path);
  try {
    return await fn(zip);
  } finally {
    zip.close();
  }
}
