import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __pendingWrites, atomicWrite } from '../../src/main/services/atomicWrite';

vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof fsp>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let dir: string;

async function tmpFiles(): Promise<string[]> {
  return (await fsp.readdir(dir)).filter((f) => f.endsWith('.tmp'));
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(join(tmpdir(), 'jbf-aw-'));
  vi.mocked(fsp.rename).mockClear();
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  it('writes a string and reads back identical content', async () => {
    const file = join(dir, 'a.json');
    await atomicWrite(file, '{"x":1}\n');
    expect(await fsp.readFile(file, 'utf8')).toBe('{"x":1}\n');
  });

  it('creates missing parent directories', async () => {
    const file = join(dir, 'deep', 'er', 'a.txt');
    await atomicWrite(file, 'hi');
    expect(await fsp.readFile(file, 'utf8')).toBe('hi');
  });

  it('overwrites an existing file', async () => {
    const file = join(dir, 'a.txt');
    await atomicWrite(file, 'first');
    await atomicWrite(file, 'second');
    expect(await fsp.readFile(file, 'utf8')).toBe('second');
  });

  it('leaves no temp files after success', async () => {
    await atomicWrite(join(dir, 'a.txt'), 'x');
    expect(await tmpFiles()).toEqual([]);
  });

  it('serializes concurrent writes to one path in call order', async () => {
    const file = join(dir, 'a.txt');
    await Promise.all(Array.from({ length: 20 }, (_, i) => atomicWrite(file, `data${i}`)));
    expect(await fsp.readFile(file, 'utf8')).toBe('data19');
    expect(await tmpFiles()).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(__pendingWrites()).toBe(0);
  });

  it('writes Uint8Array bytes exactly', async () => {
    const file = join(dir, 'a.bin');
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await atomicWrite(file, bytes);
    expect(new Uint8Array(await fsp.readFile(file))).toEqual(bytes);
  });

  it('retries rename on EPERM', async () => {
    vi.mocked(fsp.rename).mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EPERM' }));
    const file = join(dir, 'a.txt');
    await atomicWrite(file, 'ok', { backoffMs: 1 });
    expect(fsp.rename).toHaveBeenCalledTimes(2);
    expect(await fsp.readFile(file, 'utf8')).toBe('ok');
  });

  it('rejects on a non-retryable error and cleans up the temp file', async () => {
    vi.mocked(fsp.rename).mockRejectedValueOnce(Object.assign(new Error('no space'), { code: 'ENOSPC' }));
    await expect(atomicWrite(join(dir, 'a.txt'), 'x')).rejects.toThrow('no space');
    expect(fsp.rename).toHaveBeenCalledTimes(1);
    expect(await tmpFiles()).toEqual([]);
  });

  it('a failed write does not block later writes to the same path', async () => {
    vi.mocked(fsp.rename).mockRejectedValueOnce(Object.assign(new Error('no space'), { code: 'ENOSPC' }));
    const file = join(dir, 'a.txt');
    const first = atomicWrite(file, 'first');
    const second = atomicWrite(file, 'second');
    await expect(first).rejects.toThrow();
    await second;
    expect(await fsp.readFile(file, 'utf8')).toBe('second');
  });
});
