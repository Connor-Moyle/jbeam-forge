import { readFile, rename } from 'node:fs/promises';
import shipped from '@shared/taxonomy/taxonomy.json';
import { mergeTaxonomy, TaxonomyEntrySchema, TaxonomyFileSchema, validateTaxonomy, type TaxonomyEntry } from '@shared/taxonomy/schema';
import { describeError, type Logger } from '@shared/logger';
import { atomicWrite } from './atomicWrite';

export function serializeUserTaxonomy(entries: readonly TaxonomyEntry[]): string {
  return `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;
}

/**
 * Owns `userData/user-taxonomy.json`: custom part kinds the user added with
 * "Add Custom Part → save for all projects" (SPEC §4.3). Layered over the
 * shipped taxonomy; saving validates the merged result so a user entry can
 * never break the tree (missing parent, cycle, prefix clash).
 */
export class UserTaxonomyService {
  private entries: TaxonomyEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<TaxonomyEntry[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.logger.warn('user taxonomy read failed:', describeError(err).message);
      return (this.entries = []);
    }
    try {
      const file = TaxonomyFileSchema.parse(JSON.parse(text));
      const problems = validateTaxonomy(mergeTaxonomy(TaxonomyFileSchema.parse(shipped).entries, file.entries));
      if (problems.length) throw new Error(problems.map((p) => `${p.id}: ${p.problem}`).join('; '));
      this.entries = file.entries;
    } catch (err) {
      const backup = `${this.filePath}.invalid-${Date.now()}`;
      this.logger.warn('user-taxonomy.json is invalid; backing up to', backup, describeError(err).message);
      await rename(this.filePath, backup).catch(() => undefined);
      this.entries = [];
    }
    return this.entries;
  }

  get(): TaxonomyEntry[] {
    return this.entries;
  }

  /** Replace the user layer. Rejects (nothing written) when the merged taxonomy would be invalid. */
  save(input: unknown): Promise<TaxonomyEntry[]> {
    const run = this.queue.then(async () => {
      const entries = TaxonomyEntrySchema.array().parse(input);
      const problems = validateTaxonomy(mergeTaxonomy(TaxonomyFileSchema.parse(shipped).entries, entries));
      if (problems.length) throw new Error(`Invalid custom part: ${problems.map((p) => `${p.id}: ${p.problem}`).join('; ')}`);
      await atomicWrite(this.filePath, serializeUserTaxonomy(entries));
      this.entries = entries;
      this.logger.info('user taxonomy saved:', entries.length, 'entries');
      return entries;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
