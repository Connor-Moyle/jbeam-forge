import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface AtomicWriteOptions {
  /** Retries for rename on Windows EPERM/EBUSY/EACCES (AV/indexer locks). Default 5. */
  retries?: number;
  /** Base backoff in ms, doubled each retry. Default 20. */
  backoffMs?: number;
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Tail of the write chain per absolute path. */
const tails = new Map<string, Promise<void>>();

/**
 * Write via temp file + fsync + rename so a crash never leaves a truncated
 * file. Writes to the same path are serialized in call order; a failed write
 * does not block the ones queued behind it.
 */
export function atomicWrite(filePath: string, data: string | Uint8Array, opts: AtomicWriteOptions = {}): Promise<void> {
  const key = resolve(filePath);
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => writeOnce(key, data, opts));
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

async function writeOnce(filePath: string, data: string | Uint8Array, opts: AtomicWriteOptions): Promise<void> {
  const retries = opts.retries ?? 5;
  const backoffMs = opts.backoffMs ?? 20;
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (!code || !RETRYABLE.has(code) || attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
      }
    }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export function __pendingWrites(): number {
  return tails.size;
}
