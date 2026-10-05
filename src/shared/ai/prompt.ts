import { AI_JOBS, RULE_BOOK, type AiJob, type AiSection } from './jobs';

/**
 * What an AI is shown of the project: only plain facts, by name (never internal ids), and only
 * the sections the chosen jobs need. The renderer builds it from the open project.
 */
export interface AiContext {
  car: { name: string; brand: string; bodyStyle: string; country: string; years: string };
  parts: {
    name: string;
    displayName: string;
    kind: string;
    position: string | null;
    parent: string | null;
    construction: string;
    price: number;
    priceSet: boolean;
    massKg: number;
    massSet: boolean;
    /** Generated nodes (0 = rides on its parent). */
    nodes: number;
    meshes: number;
    slot: string;
    description: string;
    opens: boolean;
    hinged: boolean;
    /** Why it can't take a hinge yet, or null when it can. */
    hingeProblem: string | null;
  }[];
  materials: { name: string; color: [number, number, number]; metallic: number; roughness: number; clearCoat: number; opacity: number; game: boolean }[];
  configs: { name: string; type: string; parts: Record<string, string> }[];
  /** Slot → the parts that can go in it. */
  slots: Record<string, string[]>;
  scripts: { templates: { id: string; name: string; description: string; params: { id: string; label: string; kind: string; min?: number; max?: number; options?: string[]; default: unknown }[] }[]; present: string[] };
  engine: { name: string; fields: AiField[] } | null;
  gearbox: { name: string; fields: AiField[] } | null;
  tuning: { part: string; setting: string; min: number; max: number; default: number }[];
}

export interface AiField {
  key: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
}

const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 1000) / 1000);
const cell = (v: unknown) => String(v ?? '').replace(/[|\n]/g, ' ');
const table = (header: string[], rows: unknown[][]) => [header.join(' | '), header.map(() => '---').join(' | '), ...rows.map((r) => r.map(cell).join(' | '))].join('\n');

/** The project as the jobs need it. */
export function describeContext(ctx: AiContext, needs: ReadonlySet<AiSection>): string {
  const out: string[] = [];
  const c = ctx.car;
  out.push(`## The car\n${c.brand ? `${c.brand} ` : ''}${c.name}${c.bodyStyle ? `, ${c.bodyStyle}` : ''}${c.country ? `, ${c.country}` : ''}${c.years ? `, ${c.years}` : ''}. ${ctx.parts.length} parts, ${ctx.parts.reduce((n, p) => n + p.massKg, 0).toFixed(0)} kg of parts (without engine, gearbox and suspension).`);
  if (needs.has('parts') || needs.has('hinges')) {
    out.push(
      `## Parts\nprice and mass marked * are set by the modder; the others are the app's defaults.\n${table(
        ['part', 'parts-menu name', 'kind', 'position', 'parent', 'slot', 'made of', 'price $', 'mass kg', 'nodes', 'meshes', ...(needs.has('hinges') ? ['opens', 'hinge'] : []), 'description'],
        ctx.parts.map((p) => [
          p.name,
          p.displayName,
          p.kind,
          p.position ?? '',
          p.parent ?? '',
          p.slot,
          p.construction,
          `${round(p.price)}${p.priceSet ? '*' : ''}`,
          `${round(p.massKg)}${p.massSet ? '*' : ''}`,
          p.nodes,
          p.meshes,
          ...(needs.has('hinges') ? [p.opens ? 'yes' : 'no', p.hinged ? 'hinged' : p.hingeProblem ? `can't: ${p.hingeProblem}` : 'can'] : []),
          p.description,
        ]),
      )}`,
    );
  }
  if (needs.has('materials'))
    out.push(`## Materials\n${table(['material', 'colour RGB', 'metallic', 'roughness', 'clear coat', 'opacity', 'game’s own'], ctx.materials.map((m) => [m.name, m.color.map(round).join(', '), round(m.metallic), round(m.roughness), round(m.clearCoat), round(m.opacity), m.game ? 'yes (leave)' : '']))}`);
  if (needs.has('configs')) {
    out.push(`## Slots and the parts each can take\n${Object.entries(ctx.slots).map(([slot, parts]) => `- ${slot}: ${parts.join(', ')}`).join('\n') || '(none)'}`);
    out.push(`## Configurations already made\n${ctx.configs.map((k) => `- ${k.name} (${k.type || 'Factory'}): ${Object.entries(k.parts).map(([s, p]) => `${s}=${p || '(empty)'}`).join(', ') || 'all defaults'}`).join('\n') || '(none: the defaults make one)'}`);
  }
  if (needs.has('scripts')) {
    out.push(`## Script templates (template id: what it does; settings)\n${ctx.scripts.templates.map((t) => `- ${t.id}: ${t.name}. ${t.description} Settings: ${t.params.map((p) => `${p.id} (${p.kind}${p.min !== undefined ? ` ${p.min}-${p.max}` : ''}${p.options ? ` one of ${p.options.join('/')}` : ''}, default ${JSON.stringify(p.default)})`).join('; ') || 'none'}`).join('\n')}`);
    out.push(`Scripts already on the car: ${ctx.scripts.present.join(', ') || 'none'}`);
  }
  for (const unit of ['engine', 'gearbox'] as const) {
    if (!needs.has(unit)) continue;
    const u = ctx[unit];
    out.push(u ? `## ${unit === 'engine' ? 'Engine' : 'Gearbox'}: ${u.name}\n${table(['key', 'setting', 'unit', 'now', 'min', 'max'], u.fields.map((f) => [f.key, f.label, f.unit, round(f.value), round(f.min), round(f.max)]))}` : `## ${unit === 'engine' ? 'Engine' : 'Gearbox'}\nNone fitted: send no ${unit} changes.`);
  }
  if (needs.has('tuning')) out.push(`## Tuning options already offered\n${ctx.tuning.map((t) => `- ${t.part} ${t.setting} ${t.min}-${t.max} (default ${t.default})`).join('\n') || '(none)'}`);
  return out.join('\n\n');
}

function jobsText(jobs: readonly AiJob[]): string {
  return jobs.map((j, i) => `${i + 1}. ${j.label}. ${j.instructions}\n   Allowed changes: ${j.allows.join(', ')}.`).join('\n');
}

/** The format, with one example per allowed kind of change. */
function formatText(jobs: readonly AiJob[]): string {
  const examples: Record<string, string> = {
    rename: '{"do": "rename", "part": "<part>", "displayName": "Sport Front Bumper"}',
    describe: '{"do": "describe", "part": "<part>", "description": "Lighter fibreglass bumper with a lip."}',
    price: '{"do": "price", "part": "<part>", "price": 450}',
    construction: '{"do": "construction", "part": "<part>", "material": "carbon"}  (steel, aluminium, carbon, fibreglass or plastic)',
    mass: '{"do": "mass", "part": "<part>", "kg": 12.5}',
    structure: '{"do": "structure", "part": "<part>", "bracing": "standard", "attachment": "bolted", "detail": 0.5}  (bracing none/light/standard/heavy; attachment bolted/clipped/rivets/welded; detail 0-1)',
    hinge: '{"do": "hinge", "part": "<part>"}',
    handles: '{"do": "handles"}',
    script: '{"do": "script", "template": "<template id>", "params": {"<setting>": 1.5}}',
    config: '{"do": "config", "name": "GT Sport", "type": "Factory", "description": "...", "parts": {"<slot>": "<part>"}, "years": {"min": 1995, "max": 1999}, "population": 2000, "value": 18000}',
    modelInfo: '{"do": "modelInfo", "bodyStyle": "Coupe", "country": "Japan", "years": {"min": 1992, "max": 2002}}',
    material: '{"do": "material", "material": "<material>", "color": [0.8, 0.05, 0.05], "metallic": 0.3, "roughness": 0.4, "clearCoat": 1, "opacity": 1}',
    powertrain: '{"do": "powertrain", "unit": "engine", "key": "<key from the table>", "value": 7200}',
    tuning: '{"do": "tuning", "part": "<part>", "setting": "downforce", "min": 0.5, "max": 1.5, "default": 1}  (setting mass/stiffness/strength/downforce)',
  };
  const kinds = [...new Set(jobs.flatMap((j) => j.allows))];
  return `\`\`\`json\n{\n  "summary": "What you changed and why, in one or two sentences.",\n  "changes": [\n${kinds.map((k) => `    ${examples[k]}`).join(',\n')}\n  ],\n  "notes": ["Anything the modder should check by hand."]\n}\n\`\`\``;
}

export function needsOf(jobs: readonly AiJob[]): Set<AiSection> {
  return new Set(jobs.flatMap((j) => j.needs));
}

/** The whole first request: rules, jobs, the project, the modder's notes and the reply format. */
export function buildRequest(ctx: AiContext, jobIds: readonly string[], notes: string): string {
  const jobs = AI_JOBS.filter((j) => jobIds.includes(j.id));
  return [
    RULE_BOOK,
    `# Your jobs\n${jobsText(jobs)}`,
    notes.trim() ? `# The modder's notes (follow these)\n${notes.trim()}` : '',
    `# The project\n${describeContext(ctx, needsOf(jobs))}`,
    `# Answer like this (only the kinds of change shown; any number of each)\n${formatText(jobs)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Iterate: a follow-up in the same conversation (copy and paste) or a fresh request with the
 * history (connected). It says what was applied, what was refused and why, what the modder
 * wants changed, and how the project looks now.
 */
export function buildIterate(ctx: AiContext, jobIds: readonly string[], feedback: string, last: { applied: string[]; refused: string[] }): string {
  const jobs = AI_JOBS.filter((j) => jobIds.includes(j.id));
  return [
    RULE_BOOK,
    'This continues an earlier round. Here is how the last answer went and what to do next. Send only the changes still to make (not the ones already applied).',
    last.applied.length ? `# Applied\n${last.applied.map((a) => `- ${a}`).join('\n')}` : '# Applied\nNothing.',
    last.refused.length ? `# Refused (fix these)\n${last.refused.map((r) => `- ${r}`).join('\n')}` : '',
    feedback.trim() ? `# The modder says\n${feedback.trim()}` : '',
    `# The jobs, again\n${jobsText(jobs)}`,
    `# The project now\n${describeContext(ctx, needsOf(jobs))}`,
    `# Answer format\n${formatText(jobs)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
