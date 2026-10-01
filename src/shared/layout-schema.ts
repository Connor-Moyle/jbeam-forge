import { z } from 'zod';

/** 2: the Properties column (one panel with a tab per tool) replaced the separate tool panels. */
export const LAYOUT_VERSION = 2;

export const PRESET_IDS = ['modelling', 'model', 'materials', 'jbeam', 'moving', 'triggers', 'scripts', 'testing', 'engine', 'suspension', 'tyres', 'wheels', 'panel'] as const;
export const PresetIdSchema = z.enum(PRESET_IDS);
export type PresetId = z.infer<typeof PresetIdSchema>;

/**
 * Shape check for a persisted dockview layout. Dockview's own serialized
 * format is only validated structurally here; the renderer additionally
 * rejects layouts referencing unknown panel components and falls back to the
 * preset default if `fromJSON` throws.
 */
export const DockviewJsonSchema = z
  .object({
    grid: z.object({ root: z.unknown() }).loose(),
    panels: z.record(
      z.string(),
      z.object({ id: z.string(), contentComponent: z.string().optional() }).loose(),
    ),
  })
  .loose();

export const StoredLayoutSchema = z.object({
  version: z.literal(LAYOUT_VERSION),
  preset: PresetIdSchema,
  dockview: DockviewJsonSchema,
});

export type StoredLayout = z.infer<typeof StoredLayoutSchema>;
