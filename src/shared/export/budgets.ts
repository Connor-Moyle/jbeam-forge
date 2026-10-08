/**
 * Performance budgets: what a car costs the game, against the game's own cars. Physics cost goes
 * with nodes and beams (every beam is worked out 2,000 times a second), collision cost with
 * triangles, and drawing cost with the number of meshes. The limits are a little above the
 * heaviest of the game's road cars (eight of them measured: 520 to 900 nodes, 4,300 to 7,400
 * beams, 900 to 2,300 triangles); a lorry with a trailer goes further, and so may a mod, but it
 * should be on purpose.
 */
export interface CarCost {
  /** The car's own structure, without the game's parts fitted to it. */
  nodes: number;
  beams: number;
  triangles: number;
  /** Meshes the game draws for it. */
  meshes: number;
}

export const BUDGET = { nodes: 1100, beams: 9000, triangles: 2800, meshes: 450 } as const;

const LABEL: Record<keyof CarCost, [string, string]> = {
  nodes: ['nodes', 'Lower the detail of the largest parts in the JBeam tab, or let small parts ride on their parent instead of having structure of their own.'],
  beams: ['beams', 'Fewer nodes bring fewer beams; lighter bracing on parts that don’t need it helps too.'],
  triangles: ['collision triangles', 'Lower the detail of the largest parts, or build small parts as boxes.'],
  meshes: ['meshes', 'Join meshes that share a part and a material in your modelling program.'],
};

/** One warning for each count over its budget, with how far over and what to do. */
export function budgetWarnings(cost: CarCost): string[] {
  return (Object.keys(BUDGET) as (keyof CarCost)[])
    .filter((k) => cost[k] > BUDGET[k])
    .map((k) => `The car has ${cost[k].toLocaleString('en-US')} ${LABEL[k][0]}, ${Math.round((cost[k] / BUDGET[k] - 1) * 100)}% over what the heaviest of the game's own cars use (about ${BUDGET[k].toLocaleString('en-US')}): it will run slower than they do, most of all with several on the map. ${LABEL[k][1]}`);
}
