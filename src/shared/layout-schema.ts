import { z } from 'zod';

export const LAYOUT_VERSION = 1;

export const PRESET_IDS = ['modelling', 'materials', 'jbeam', 'moving', 'triggers', 'scripts', 'testing', 'engine', 'tyres', 'wheels'] as const;
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
