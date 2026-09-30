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

const isEmptyList = (v: unknown) => Array.isArray(v) && v.length === 0;
const isEmptyMap = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;

export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    describe: 'Phase 3 import/taxonomy sections (typed sources/splits/assignments; parts, ignoredMeshes, customTaxonomy)',
    migrate: (doc) => {
      // v1 only had untyped placeholders that no release ever filled. Refuse to
      // guess at unexpected content rather than silently dropping it.
      if (!isEmptyList(doc.sources) || !isEmptyList(doc.splits) || !isEmptyMap(doc.assignments)) {
        throw new Error('v1 project has data in sources/splits/assignments, which no v1 app could write');
      }
      return { ...doc, formatVersion: 2, sources: [], splits: [], parts: [], assignments: {}, ignoredMeshes: [], customTaxonomy: [] };
    },
  },
  {
    from: 2,
    describe: 'per-source texture search folders (Source.textureDirs)',
    migrate: (doc) => {
      const sources: unknown[] = Array.isArray(doc.sources) ? (doc.sources as unknown[]) : [];
      return {
        ...doc,
        formatVersion: 3,
        sources: sources.map((s) => (typeof s === 'object' && s !== null ? { ...s, textureDirs: [] } : s)),
      };
    },
  },
  {
    from: 3,
    describe: 'automatic part prices (Part.price null = automatic; the old 0 default becomes automatic)',
    migrate: (doc) => {
      const parts: unknown[] = Array.isArray(doc.parts) ? (doc.parts as unknown[]) : [];
      return {
        ...doc,
        formatVersion: 4,
        parts: parts.map((p) => (typeof p === 'object' && p !== null && (p as { price?: unknown }).price === 0 ? { ...p, price: null } : p)),
      };
    },
  },
  {
    from: 4,
    describe: 'friendly mesh names (meshNames)',
    migrate: (doc) => ({ ...doc, formatVersion: 5, meshNames: {} }),
  },
  {
    from: 5,
    describe: 'vehicle materials (typed materials list, materialSlots)',
    migrate: (doc) => {
      if (Array.isArray(doc.materials) && doc.materials.length) throw new Error('v5 project has materials, which no v5 app could write');
      return { ...doc, formatVersion: 6, materials: [], materialSlots: {} };
    },
  },
  {
    from: 6,
    describe: 'hinges (typed) and hinge beam kinds',
    migrate: (doc) => {
      if (Array.isArray(doc.hinges) && doc.hinges.length) throw new Error('v6 project has hinges, which no v6 app could write');
      return { ...doc, formatVersion: 7, hinges: [] };
    },
  },
  {
    from: 7,
    describe: 'model placement (Source.placement)',
    migrate: (doc) => {
      const sources: unknown[] = Array.isArray(doc.sources) ? (doc.sources as unknown[]) : [];
      return { ...doc, formatVersion: 8, sources: sources.map((s) => (typeof s === 'object' && s !== null ? { ...s, placement: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } } : s)) };
    },
  },
  {
    from: 8,
    describe: 'reference car data (Assetto Corsa import)',
    migrate: (doc) => ({ ...doc, formatVersion: 9, reference: null }),
  },
  {
    from: 9,
    describe: 'per-mesh edits and mesh copies',
    migrate: (doc) => ({ ...doc, formatVersion: 10, meshEdits: {}, meshCopies: [] }),
  },
  {
    from: 10,
    describe: 'axles',
    migrate: (doc) => ({ ...doc, formatVersion: 11, axles: [] }),
  },
  {
    from: 11,
    describe: 'engine and gearbox',
    migrate: (doc) => ({
      ...doc,
      formatVersion: 12,
      powertrain: { engine: null, gearbox: null },
      axles: (Array.isArray(doc.axles) ? (doc.axles as Record<string, unknown>[]) : []).map((a) => ({ ...a, ownMeshes: [] })),
    }),
  },
  {
    from: 12,
    describe: 'settings adjustable in game',
    // The variables placeholder was always empty.
    migrate: (doc) => ({ ...doc, formatVersion: 13, variables: [] }),
  },
  {
    from: 13,
    describe: 'vehicle configurations',
    // The configs placeholder was always empty.
    migrate: (doc) => ({ ...doc, formatVersion: 14, configs: [] }),
  },
  {
    from: 14,
    describe: 'plates, tow hitch, nitrous and paint designs',
    migrate: (doc) => ({ ...doc, formatVersion: 15, features: { plates: { front: null, rear: null }, hitch: null, nitrous: null, skins: [] } }),
  },
  {
    from: 15,
    describe: 'engine and gearbox builder edits, factory paints',
    migrate: (doc) => {
      const pt = (doc.powertrain ?? {}) as Record<string, Record<string, unknown> | null>;
      const withEdits = (f: Record<string, unknown> | null | undefined) => (f ? { ...f, edits: { fields: {}, torque: null, gearRatios: null } } : null);
      return {
        ...doc,
        formatVersion: 16,
        powertrain: { engine: withEdits(pt.engine), gearbox: withEdits(pt.gearbox) },
        configs: (Array.isArray(doc.configs) ? (doc.configs as Record<string, unknown>[]) : []).map((c) => ({ ...c, paints: [null, null, null] })),
        paints: { list: [], defaults: [null, null, null] },
      };
    },
  },
  {
    from: 16,
    describe: 'vinyl layers',
    migrate: (doc) => ({ ...doc, formatVersion: 17, vinyls: [] }),
  },
  {
    from: 17,
    describe: 'material painting',
    migrate: (doc) => ({ ...doc, formatVersion: 18, faceMaterials: {} }),
  },
  {
    from: 18,
    // Animated parts, interior cameras, more engines, driveline edits, part choices and projected UVs are
    // all optional, so older projects need nothing; the bump keeps older apps from dropping them unread.
    describe: 'animated parts, cameras, engine options, driveline, part choices, UV projection',
    migrate: (doc) => ({ ...doc, formatVersion: 19 }),
  },
  {
    from: 19,
    // A development build of 0.13.1 kept reshaped meshes as an optional v19 field: keep them.
    describe: 'meshes reshaped in the Modelling workspace',
    migrate: (doc) => ({ ...doc, formatVersion: 20, meshModels: typeof doc.meshModels === 'object' && doc.meshModels !== null && !Array.isArray(doc.meshModels) ? doc.meshModels : {} }),
  },
];

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
