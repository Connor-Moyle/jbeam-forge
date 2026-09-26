import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { RecentProject } from '@shared/ipc-contract';
import { describeError, type Logger } from '@shared/logger';
import { atomicWrite } from './atomicWrite';
import { samePath } from '../beamng/locate';

const MAX_RECENT = 12;
const MAX_THUMB_BYTES = 512 * 1024;
const THUMB_PREFIX = 'data:image/jpeg;base64,';

const RecentFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.object({
      path: z.string().min(1),
      name: z.string(),
      slug: z.string(),
      openedAt: z.iso.datetime(),
      thumbnail: z.string().nullable(),
    }),
  ),
});
type RecentFile = z.infer<typeof RecentFileSchema>;
type Entry = RecentFile['entries'][number];

export function serializeRecent(file: RecentFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Recently opened projects, most recent first (userData/recent-projects.json + thumbnails/). */
export class RecentService {
  private entries: Entry[] = [];

  constructor(
    private readonly filePath: string,
    private readonly thumbsDir: string,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = RecentFileSchema.safeParse(JSON.parse(await readFile(this.filePath, 'utf8')));
      if (parsed.success) this.entries = parsed.data.entries;
      else this.logger.warn('recent-projects.json invalid; starting empty:', parsed.error.issues[0]?.message);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.logger.warn('recent-projects.json unreadable:', describeError(err).message);
    }
  }

  has(path: string): boolean {
    return this.entries.some((e) => samePath(e.path, path));
  }

  async list(): Promise<RecentProject[]> {
    return Promise.all(
      this.entries.map(async (e) => ({
        path: e.path,
        name: e.name,
        slug: e.slug,
        openedAt: e.openedAt,
        exists: await fileExists(e.path),
        thumbnail: e.thumbnail ? await this.readThumb(e.thumbnail) : null,
      })),
    );
  }

  /** Move `path` to the front, optionally replacing its thumbnail (a JPEG data URL). */
  async touch(path: string, info: { name: string; slug: string }, thumbnailDataUrl?: string | null): Promise<void> {
    const existing = this.entries.find((e) => samePath(e.path, path));
    let thumbnail = existing?.thumbnail ?? null;
    if (thumbnailDataUrl) thumbnail = (await this.writeThumb(path, thumbnailDataUrl)) ?? thumbnail; // a rejected image keeps the old one
    const entry: Entry = { path, name: info.name, slug: info.slug, openedAt: this.now().toISOString(), thumbnail };
    const rest = this.entries.filter((e) => !samePath(e.path, path));
    const dropped = rest.slice(MAX_RECENT - 1);
    this.entries = [entry, ...rest.slice(0, MAX_RECENT - 1)];
    for (const d of dropped) if (d.thumbnail) await rm(join(this.thumbsDir, d.thumbnail), { force: true });
    await this.persist();
  }

  async remove(path: string): Promise<void> {
    const gone = this.entries.filter((e) => samePath(e.path, path));
    this.entries = this.entries.filter((e) => !samePath(e.path, path));
    for (const g of gone) if (g.thumbnail) await rm(join(this.thumbsDir, g.thumbnail), { force: true });
    await this.persist();
  }

  private async persist(): Promise<void> {
    await atomicWrite(this.filePath, serializeRecent({ version: 1, entries: this.entries }));
  }

  private async writeThumb(projectPath: string, dataUrl: string): Promise<string | null> {
    if (!dataUrl.startsWith(THUMB_PREFIX)) {
      this.logger.warn('ignoring thumbnail that is not a JPEG data URL');
      return null;
    }
    const bytes = Buffer.from(dataUrl.slice(THUMB_PREFIX.length), 'base64');
    if (bytes.length === 0 || bytes.length > MAX_THUMB_BYTES) {
      this.logger.warn(`ignoring thumbnail of ${bytes.length} bytes`);
      return null;
    }
    const name = `${createHash('sha1').update(projectPath.toLowerCase()).digest('hex')}.jpg`;
    await atomicWrite(join(this.thumbsDir, name), bytes);
    return name;
  }

  private async readThumb(name: string): Promise<string | null> {
    try {
      return THUMB_PREFIX + (await readFile(join(this.thumbsDir, name))).toString('base64');
    } catch {
      return null;
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
