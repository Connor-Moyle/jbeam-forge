import { readFile, rm } from 'node:fs/promises';
import { StoredLayoutSchema, type StoredLayout } from '@shared/layout-schema';
import { describeError, type Logger } from '@shared/logger';
import { atomicWrite } from './atomicWrite';

export function serializeLayout(layout: StoredLayout): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}

/** Persists the dockview layout to `userData/layouts/current.json`. */
export class LayoutService {
  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  /** Returns null (caller uses the preset default) when missing or invalid. */
  async load(): Promise<StoredLayout | null> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('layout read failed:', describeError(err).message);
      }
      return null;
    }
    try {
      const parsed = StoredLayoutSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        this.logger.warn('stored layout failed validation; using default:', parsed.error.issues[0]?.message);
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.logger.warn('stored layout is not valid JSON; using default:', describeError(err).message);
      return null;
    }
  }

  async save(layout: StoredLayout): Promise<void> {
    const valid = StoredLayoutSchema.parse(layout);
    await atomicWrite(this.filePath, serializeLayout(valid));
    this.logger.debug('layout saved, preset =', valid.preset);
  }

  /** Delete the stored layout so the next load falls back to the preset default. */
  async reset(): Promise<void> {
    await rm(this.filePath, { force: true });
    this.logger.info('layout reset to default');
  }
}
