/**
 * Ordered `.jbforge` migrations. Each step takes the raw document at version
 * `from` and returns it at version `from + 1` (including the bumped
 * `formatVersion`). Steps must be pure: never mutate the input.
 *
 * v1 is the initial format, so the registry is empty until the first change.
 */
export type RawDoc = Record<string, unknown>;

export interface Migration {
  from: number;
  describe: string;
  migrate(doc: Readonly<RawDoc>): RawDoc;
}

export const MIGRATIONS: readonly Migration[] = [];

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly code: 'MIGRATION_MISSING' | 'MIGRATION_FAILED',
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Apply every step from `fromVersion` up to `toVersion`. */
export function runMigrations(
  doc: RawDoc,
  fromVersion: number,
  toVersion: number,
  registry: readonly Migration[] = MIGRATIONS,
): { doc: RawDoc; applied: string[] } {
  const applied: string[] = [];
  let current = doc;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = registry.find((m) => m.from === v);
    if (!step) {
      throw new MigrationError(`No migration from project format v${v} to v${v + 1}`, 'MIGRATION_MISSING');
    }
    try {
      current = step.migrate(current);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new MigrationError(`Migration v${v}→v${v + 1} failed: ${reason}`, 'MIGRATION_FAILED');
    }
    if (current.formatVersion !== v + 1) {
      throw new MigrationError(
        `Migration v${v}→v${v + 1} did not set formatVersion to ${v + 1}`,
        'MIGRATION_FAILED',
      );
    }
    applied.push(`v${v}→v${v + 1}: ${step.describe}`);
  }
  return { doc: current, applied };
}
