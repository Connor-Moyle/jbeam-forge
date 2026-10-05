import type { AiChange, ParsedReply } from './changes';
import { AI_JOBS } from './jobs';
import type { AiContext } from './prompt';

/**
 * Checking an AI's changes before the modder sees them: each is accepted (with a plain-words
 * description of what it does) or refused with the reason, which Iterate sends back. Nothing
 * here changes the project.
 */

export interface CheckedChange {
  change: AiChange | null;
  /** What it does, in words ("Front bumper: price $450 (was $300)"). */
  text: string;
  ok: boolean;
  problem: string | null;
}

const LIMITS = {
  price: [0, 500_000],
  mass: [0.05, 5_000],
  detail: [0.05, 1],
  colour: [0, 1],
  unit: [0, 1],
  tuning: [0.05, 20],
  years: [1885, 2100],
  population: [0, 1_000_000],
  value: [0, 50_000_000],
} as const;

const within = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function checkReply(ctx: AiContext, jobIds: readonly string[], reply: ParsedReply): CheckedChange[] {
  const allowed = new Set(AI_JOBS.filter((j) => jobIds.includes(j.id)).flatMap((j) => j.allows));
  const parts = new Map(ctx.parts.map((p) => [p.name, p]));
  const materials = new Map(ctx.materials.map((m) => [m.name, m]));
  const templates = new Map(ctx.scripts.templates.map((t) => [t.id, t]));
  const seen = new Set<string>();
  return reply.changes.map(({ raw, change, problem }) => {
    if (!change) return { change: null, text: JSON.stringify(raw).slice(0, 160), ok: false, problem };
    const refuse = (why: string, text = describe(change)) => ({ change, text, ok: false, problem: why });
    if (!allowed.has(change.do)) return refuse(`"${change.do}" isn't one of the chosen jobs`);
    const part = 'part' in change ? parts.get(change.part) : undefined;
    if ('part' in change && !part) return refuse(`there is no part called "${change.part}"`);
    // The same thing changed twice in one reply: the first one counts.
    const key = JSON.stringify([change.do, 'part' in change ? change.part : 'material' in change ? change.material : 'name' in change ? change.name : 'key' in change ? change.key : 'template' in change ? change.template : '', 'setting' in change ? change.setting : ''].filter(Boolean));
    if (seen.has(key) && change.do !== 'handles') return refuse('the same change twice in one reply');
    seen.add(key);
    switch (change.do) {
      case 'rename':
        return ok(change, `${part!.displayName}: called “${change.displayName}”`);
      case 'describe':
        return ok(change, `${part!.displayName}: description “${change.description.slice(0, 80)}${change.description.length > 80 ? '…' : ''}”`);
      case 'price':
        if (!within(change.price, LIMITS.price)) return refuse(`price ${change.price} is outside 0–500,000`);
        return ok(change, `${part!.displayName}: price ${money(change.price)} (was ${money(part!.price)})`);
      case 'construction':
        return ok(change, `${part!.displayName}: made of ${change.material} (was ${part!.construction})`);
      case 'mass':
        if (!within(change.kg, LIMITS.mass)) return refuse(`mass ${change.kg} kg is outside 0.05–5,000`);
        if (part!.massKg > 0 && (change.kg > part!.massKg * 20 || change.kg < part!.massKg / 20)) return refuse(`${change.kg} kg is over 20 times off the ${part!.massKg.toFixed(1)} kg it has now; check the units (kg)`);
        return ok(change, `${part!.displayName}: ${change.kg} kg (was ${part!.massKg.toFixed(1)} kg)`);
      case 'structure':
        if (change.detail !== undefined && !within(change.detail, LIMITS.detail)) return refuse(`detail ${change.detail} is outside 0.05–1`);
        return ok(change, `${part!.displayName}: ${[change.bracing && `${change.bracing} bracing`, change.attachment && change.attachment, change.detail !== undefined && `detail ${change.detail}`].filter(Boolean).join(', ') || 'no change'}`);
      case 'hinge':
        if (part!.hinged) return refuse(`${part!.displayName} already hinges`);
        if (part!.hingeProblem) return refuse(`${part!.displayName} can't take a hinge: ${part!.hingeProblem}`);
        return ok(change, `${part!.displayName}: opens on a hinge`);
      case 'handles':
        return ok(change, 'A handle on every hinged part that has none');
      case 'script': {
        const t = templates.get(change.template);
        if (!t) return refuse(`there is no script template "${change.template}"`);
        if (ctx.scripts.present.includes(t.id)) return refuse(`the car already has ${t.name}`);
        for (const [k, v] of Object.entries(change.params ?? {})) {
          const p = t.params.find((x) => x.id === k);
          if (!p) return refuse(`${t.name} has no setting "${k}"`);
          if (p.kind === 'meshes' || p.kind === 'mesh') return refuse(`${t.name}: meshes are picked in the app, not sent ("${k}")`);
          if (p.kind === 'number' && (typeof v !== 'number' || (p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max))) return refuse(`${t.name}: ${k} must be a number${p.min !== undefined ? ` from ${p.min} to ${p.max}` : ''}`);
          if (p.kind === 'boolean' && typeof v !== 'boolean') return refuse(`${t.name}: ${k} must be true or false`);
          if (p.kind === 'choice' && !p.options?.includes(String(v))) return refuse(`${t.name}: ${k} must be one of ${p.options?.join(', ')}`);
        }
        return ok(change, `Add ${t.name}${change.params && Object.keys(change.params).length ? ` (${Object.entries(change.params).map(([k, v]) => `${k} ${String(v)}`).join(', ')})` : ''}`);
      }
      case 'config': {
        for (const [slot, name] of Object.entries(change.parts ?? {})) {
          const options = ctx.slots[slot];
          if (!options) return refuse(`there is no slot "${slot}"`);
          if (name !== '' && !options.includes(name)) return refuse(`"${name}" can't go in the ${slot} slot (it takes ${options.join(', ')})`);
        }
        if (change.years && (!within(change.years.min, LIMITS.years) || !within(change.years.max, LIMITS.years) || change.years.min > change.years.max)) return refuse('years must run from an earlier to a later year');
        if (change.population !== undefined && !within(change.population, LIMITS.population)) return refuse('population must be 0–1,000,000');
        if (change.value !== undefined && !within(change.value, LIMITS.value)) return refuse('value is out of range');
        const exists = ctx.configs.some((k) => k.name.toLowerCase() === change.name.toLowerCase());
        return ok(change, `${exists ? 'Update' : 'New'} configuration “${change.name}”${change.type ? ` (${change.type})` : ''}: ${Object.keys(change.parts ?? {}).length} slot${Object.keys(change.parts ?? {}).length === 1 ? '' : 's'} changed`);
      }
      case 'modelInfo':
        if (change.years && (!within(change.years.min, LIMITS.years) || !within(change.years.max, LIMITS.years) || change.years.min > change.years.max)) return refuse('years must run from an earlier to a later year');
        return ok(change, `Vehicle details: ${[change.bodyStyle, change.country, change.years && `${change.years.min}–${change.years.max}`].filter(Boolean).join(', ')}`);
      case 'material': {
        const m = materials.get(change.material);
        if (!m) return refuse(`there is no material "${change.material}"`);
        if (m.game) return refuse(`${m.name} is the game's own material: it's used by name and can't be changed here`);
        for (const [k, v] of [['metallic', change.metallic], ['roughness', change.roughness], ['clearCoat', change.clearCoat], ['opacity', change.opacity]] as const) if (v !== undefined && !within(v, LIMITS.unit)) return refuse(`${k} must be 0–1`);
        if (change.opacity !== undefined && change.opacity < 0.05) return refuse('opacity under 0.05 makes it invisible');
        return ok(change, `Material ${m.name}: ${[change.color && `colour ${change.color.map((c) => c.toFixed(2)).join(', ')}`, change.metallic !== undefined && `metallic ${change.metallic}`, change.roughness !== undefined && `roughness ${change.roughness}`, change.clearCoat !== undefined && `clear coat ${change.clearCoat}`, change.opacity !== undefined && `opacity ${change.opacity}`].filter(Boolean).join(', ')}`);
      }
      case 'powertrain': {
        const unit = ctx[change.unit];
        if (!unit) return refuse(`no ${change.unit} is fitted`);
        const f = unit.fields.find((x) => x.key === change.key);
        if (!f) return refuse(`the ${change.unit} has no setting "${change.key}"`);
        if (!Number.isFinite(change.value) || change.value < f.min || change.value > f.max) return refuse(`${f.label} must be ${f.min}–${f.max}${f.unit ? ` ${f.unit}` : ''}`);
        return ok(change, `${change.unit === 'engine' ? 'Engine' : 'Gearbox'}: ${f.label} ${change.value}${f.unit ? ` ${f.unit}` : ''} (was ${f.value})`);
      }
      case 'tuning':
        if (![change.min, change.max, change.default].every((v) => within(v, LIMITS.tuning))) return refuse('tuning scales must be 0.05–20');
        if (!(change.min < change.max) || change.default < change.min || change.default > change.max) return refuse('the default must lie between min and max, and min below max');
        if (change.setting === 'downforce' && part!.kind.toLowerCase().indexOf('wing') < 0 && part!.kind.toLowerCase().indexOf('spoiler') < 0) return refuse(`downforce only works on a wing or spoiler, not ${part!.kind}`);
        return ok(change, `${part!.displayName}: ${change.setting} adjustable in game, ${change.min}–${change.max} (default ${change.default})`);
    }
  });
}

function ok(change: AiChange, text: string): CheckedChange {
  return { change, text, ok: true, problem: null };
}

function describe(change: AiChange): string {
  return JSON.stringify(change).slice(0, 160);
}
