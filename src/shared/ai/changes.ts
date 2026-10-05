import { z } from 'zod';
import { ATTACHMENT_STYLE_VALUES, BRACING_VALUES, CONSTRUCTION_MATERIALS } from '../project/schema';

/**
 * AI mode's reply format. Whatever AI is used (pasted into any chat, or connected with the user's
 * own key), it answers with this JSON and nothing it says is applied directly: every change is
 * checked against the project (names exist, values are sensible) and shown before it's applied,
 * all at once as one undo step. Changes name parts, materials and configurations by the names in
 * the request, never by internal ids.
 */

const Name = z.string().min(1).max(120);
const Rgb = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);

export const AiChangeSchema = z.discriminatedUnion('do', [
  /** What the part is called in the game's parts menu. */
  z.object({ do: z.literal('rename'), part: Name, displayName: z.string().min(1).max(80) }),
  z.object({ do: z.literal('describe'), part: Name, description: z.string().max(400) }),
  /** In-game price in dollars. */
  z.object({ do: z.literal('price'), part: Name, price: z.number() }),
  /** What the part is made of (sets its default strength, weight and price). */
  z.object({ do: z.literal('construction'), part: Name, material: z.enum(CONSTRUCTION_MATERIALS) }),
  /** The part's weight in kg. */
  z.object({ do: z.literal('mass'), part: Name, kg: z.number() }),
  /** How the generated structure is built: bracing, how it's attached, how detailed (0–1). */
  z.object({ do: z.literal('structure'), part: Name, bracing: z.enum(BRACING_VALUES).optional(), attachment: z.enum(ATTACHMENT_STYLE_VALUES).optional(), detail: z.number().optional() }),
  /** Make an opening part (door, hood, trunk, hatch…) hinge; the app works out the axis from the model. */
  z.object({ do: z.literal('hinge'), part: Name }),
  /** Put a handle (a trigger the player clicks) on every hinged part that has none. */
  z.object({ do: z.literal('handles') }),
  /** Add a vehicle script from the template list, with settings. */
  z.object({ do: z.literal('script'), template: Name, params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional() }),
  /** A configuration (like the game's .pc files): which part goes in which slot. */
  z.object({
    do: z.literal('config'),
    name: z.string().min(1).max(60),
    type: z.string().max(40).optional(),
    description: z.string().max(400).optional(),
    /** slot → part name, '' leaves the slot empty. */
    parts: z.record(z.string(), z.string()).optional(),
    years: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
    population: z.number().int().optional(),
    value: z.number().optional(),
  }),
  /** The car's details in the vehicle selector. */
  z.object({ do: z.literal('modelInfo'), bodyStyle: z.string().max(40).optional(), country: z.string().max(40).optional(), years: z.object({ min: z.number().int(), max: z.number().int() }).optional() }),
  /** Change a material's look (first layer). */
  z.object({ do: z.literal('material'), material: Name, color: Rgb.optional(), metallic: z.number().optional(), roughness: z.number().optional(), clearCoat: z.number().optional(), opacity: z.number().optional() }),
  /** A setting of the fitted engine or gearbox, by the key the request lists. */
  z.object({ do: z.literal('powertrain'), unit: z.enum(['engine', 'gearbox']), key: z.string().min(1).max(200), value: z.number() }),
  /** Let the player adjust a part's mass, stiffness, strength or downforce in the game's tuning menu (scales, 1 = as built). */
  z.object({ do: z.literal('tuning'), part: Name, setting: z.enum(['mass', 'stiffness', 'strength', 'downforce']), min: z.number(), max: z.number(), default: z.number() }),
]);

export type AiChange = z.infer<typeof AiChangeSchema>;

export const AiReplySchema = z.object({
  /** One or two sentences: what was done and why. */
  summary: z.string().max(2000).default(''),
  changes: z.array(z.unknown()).max(500),
  /** Anything the modder should know or do by hand. */
  notes: z.array(z.string().max(500)).max(50).default([]),
});

export interface ParsedReply {
  summary: string;
  notes: string[];
  /** Each change as sent, parsed or with why it couldn't be read. */
  changes: { raw: unknown; change: AiChange | null; problem: string | null }[];
}

/**
 * Read an AI's reply: the JSON in a ```json block, or the first {...} in the text. Chat AIs often
 * add words around it, trailing commas or comments; those are tolerated. Throws with a message
 * fit for the modder when there's no reply in it at all.
 */
export function parseReply(text: string): ParsedReply {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const body = fenced ?? sliceObject(text);
  if (!body) throw new Error('No reply found: paste the AI’s whole answer, including the part in curly brackets { }.');
  let raw: unknown;
  try {
    raw = JSON.parse(loosen(body));
  } catch (err) {
    throw new Error(`The reply isn’t valid JSON (${err instanceof Error ? err.message : String(err)}). Press Iterate to ask the AI to send it again.`);
  }
  const reply = AiReplySchema.safeParse(raw);
  if (!reply.success) throw new Error('The reply doesn’t have a "changes" list. Press Iterate to ask the AI to answer in the format it was given.');
  return {
    summary: reply.data.summary,
    notes: reply.data.notes,
    changes: reply.data.changes.map((c) => {
      const r = AiChangeSchema.safeParse(c);
      if (r.success) return { raw: c, change: r.data, problem: null };
      const issue = r.error.issues[0];
      return { raw: c, change: null, problem: `not understood: ${issue ? `${issue.path.join('.') || 'change'} ${issue.message}` : 'unknown change'}` };
    }),
  };
}

/** The first balanced {...} in the text. */
function sliceObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Comments and trailing commas out (outside strings); typographic quotes made plain. */
function loosen(json: string): string {
  let out = '';
  let inString = false;
  // A string opened with a curly quote closes on one; one opened with a plain quote keeps curly quotes as text.
  let curly = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!;
    if (inString) {
      if (c === '\\') out += c + (json[++i] ?? '');
      else if (curly ? c === '“' || c === '”' : c === '"') {
        inString = false;
        out += '"';
      } else out += c === '"' ? '\\"' : c;
      continue;
    }
    if (c === '"' || c === '“' || c === '”') {
      inString = true;
      curly = c !== '"';
      out += '"';
    } else if (c === '/' && json[i + 1] === '/') {
      while (i < json.length && json[i] !== '\n') i++;
    } else if (c === '/' && json[i + 1] === '*') {
      i = json.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
