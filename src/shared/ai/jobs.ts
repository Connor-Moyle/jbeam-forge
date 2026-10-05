import type { AiChange } from './changes';

/**
 * AI mode's jobs: what the modder can hand to an AI. Each says what it may change (the change
 * kinds it's allowed to send), what it needs to see of the project, and how to do it well. A
 * reply's changes outside the chosen jobs are refused.
 */

export type AiSection = 'parts' | 'materials' | 'configs' | 'scripts' | 'engine' | 'gearbox' | 'tuning' | 'hinges';

export interface AiJob {
  id: string;
  label: string;
  /** What the job does, for the checklist. */
  description: string;
  allows: AiChange['do'][];
  needs: AiSection[];
  /** Instructions for the AI, in addition to the rule book. */
  instructions: string;
}

export const AI_JOBS: readonly AiJob[] = [
  {
    id: 'names',
    label: 'Names and descriptions',
    description: 'Parts-menu names and short descriptions for every part.',
    allows: ['rename', 'describe'],
    needs: ['parts'],
    instructions:
      'Give every part a clear parts-menu name in the style of the game ("Front Bumper", "Sport Hood", "Racing Seat"), using the car’s name only where the game would. Write a one-sentence description where it helps (what changes with this part). Keep names under 40 characters. Don’t rename parts that already have a good name.',
  },
  {
    id: 'prices',
    label: 'Prices',
    description: 'Realistic in-game prices for each part.',
    allows: ['price'],
    needs: ['parts'],
    instructions:
      'Set each part’s price in US dollars as a replacement part would cost for this kind of car (an economy car’s door is cheaper than a supercar’s). Body panels usually cost 100–2,000, glass 50–800, lights 50–1,500, seats 100–3,000, carbon or race parts several times the steel ones. Use round numbers.',
  },
  {
    id: 'weights',
    label: 'Weights',
    description: 'Realistic mass for every part, so the car weighs what it should.',
    allows: ['mass', 'construction'],
    needs: ['parts'],
    instructions:
      'Set each part’s mass in kg for what it is made of and its size. The total of all parts plus the fitted engine, gearbox and suspension should come to a believable curb weight for this car. Typical steel parts: door 15–25, hood 10–20, trunk lid 8–15, front bumper 4–8, fender 3–6, seat 12–25, window glass 3–8. Carbon is about 40%, aluminium about 60%, fibreglass about 70% of steel. Change a part’s construction material only when its name or the modder’s notes say so.',
  },
  {
    id: 'structure',
    label: 'Structure (jbeam generation)',
    description: 'How each part’s nodes and beams are generated: bracing, attachment and detail.',
    allows: ['structure', 'construction'],
    needs: ['parts'],
    instructions:
      'Choose for each part with its own structure: bracing (none for thin trim, light for panels, standard for doors and the body, heavy for the chassis and crash structures), attachment (bolted for panels and bumpers, clipped for trim and plastic covers, welded for parts that are one with the body, rivets for aircraft-style or race parts) and detail (0.3–0.5 for most parts; up to 0.7 for the body and parts that need to bend realistically; 0.2 for small trim). More detail means more nodes and a heavier car to simulate.',
  },
  {
    id: 'materials',
    label: 'Material looks',
    description: 'Colour, metalness, roughness and clear coat of the project’s materials.',
    allows: ['material'],
    needs: ['materials', 'parts'],
    instructions:
      'Adjust materials by what their names say they are: paint (metallic 0–0.6, roughness 0.3–0.5, clear coat 1), chrome (metallic 1, roughness 0.05), rubber and tyres (metallic 0, roughness 0.9, dark grey), plastic trim (roughness 0.6–0.8), glass (opacity 0.2–0.4, roughness 0), carbon (dark, roughness 0.3, clear coat 1). Colours are 0–1 RGB. Leave materials that are the game’s own alone.',
  },
  {
    id: 'hinges',
    label: 'Opening doors, hood and trunk',
    description: 'Hinges for parts that open, and handles to open them in the game.',
    allows: ['hinge', 'handles'],
    needs: ['parts', 'hinges'],
    instructions: 'Hinge every part that opens on the real car (doors, hood, trunk, hatch, tailgate, fuel flap, glovebox) and that the project says can take a hinge. Then add handles. The app works out each axis and latch from the model.',
  },
  {
    id: 'scripts',
    label: 'Moving parts and features (scripts)',
    description: 'Electric windows, moving seats, wipers, mirrors, pop-up lights, shift lights…',
    allows: ['script'],
    needs: ['scripts', 'parts'],
    instructions:
      'Add the vehicle scripts this car would have, only from the template list, and only those it doesn’t have yet. Set number and choice settings where the defaults don’t suit this car; leave mesh settings out (the modder picks meshes in the app). A car with pop-up headlights gets the pop-up script; electric windows on anything modern; a shift light on performance cars.',
  },
  {
    id: 'configs',
    label: 'Configurations',
    description: 'Factory, sport and race versions of the car (like the game’s .pc files).',
    allows: ['config'],
    needs: ['configs', 'parts'],
    instructions:
      'Make 2–5 configurations the way the game’s cars have them: a base model, better-equipped or sport trims, and a race or custom build where the parts allow it. Each lists only the slots that differ from the defaults (part name per slot, empty string to leave it empty). Set type (Factory, Custom, Race, Police, Service), years, a population (common trims 1,000–10,000, rare ones 10–500) and a value in dollars.',
  },
  {
    id: 'details',
    label: 'Vehicle details',
    description: 'Body style, country and years for the vehicle selector.',
    allows: ['modelInfo'],
    needs: ['parts'],
    instructions: 'Fill in the car’s body style (Sedan, Coupe, Hatchback, Wagon, Pickup, SUV, Van, Convertible…), country of origin and the years it was built, from its name and the modder’s notes.',
  },
  {
    id: 'engine',
    label: 'Engine tune',
    description: 'Engine settings: revs, inertia, friction, cooling, oil, damage limits, sound.',
    allows: ['powertrain'],
    needs: ['engine'],
    instructions:
      'Tune the fitted engine’s listed settings to suit the car and the modder’s notes, changing only keys from the list, within their ranges. Keep idle 600–1,100 rpm for road engines. Rev limit follows the engine type (diesel 4,500–5,500, road petrol 6,000–7,500, race up to 9,000+). Torque rating (maxTorqueRating) must stay above the engine’s peak torque or it breaks. Bigger radiators and more oil run cooler: raise them for race and towing builds.',
  },
  {
    id: 'gearbox',
    label: 'Gearbox and shifting',
    description: 'Gearbox and automatic shift points.',
    allows: ['powertrain'],
    needs: ['gearbox'],
    instructions: 'Adjust the fitted gearbox’s listed settings (shift points, clutch, torque converter, lock torque) to match the engine and the kind of car. Upshift points must sit below the engine’s rev limit and above its peak torque.',
  },
  {
    id: 'tuning',
    label: 'In-game tuning options',
    description: 'Which parts the player can adjust in the game’s tuning menu.',
    allows: ['tuning'],
    needs: ['parts', 'tuning'],
    instructions:
      'Offer tuning where players expect it: wing downforce (0.5–1.5), panel and bumper strength for crash tuning (0.5–2), part weight on race parts (0.7–1.3). Scales are multipliers where 1 is the part as built; the default must lie between min and max.',
  },
];

export const jobById = (id: string) => AI_JOBS.find((j) => j.id === id);

/**
 * The rule book every request starts with: how BeamNG and JBeam Forge work, what the AI may and
 * may not do, and how to answer. Written for an AI that has never seen this project.
 */
export const RULE_BOOK = `You are helping a modder finish a car for the driving game BeamNG.drive in JBeam Forge, an app that turns a 3D model into a game mod. The app has already done the geometry: it imported the model, split it into parts and generated each part's physics structure (nodes and beams, the game's "jbeam"). Your job is to fill in the details the modder asked for, by sending back a list of changes. The app checks every change before showing it to the modder, who decides what to apply.

Rules:
1. Only use names that appear in this request: part names (the first column of the parts table), material names, slot names, template ids, engine and gearbox setting keys. Never invent a name. A change that names something that isn't listed is refused.
2. Only send the kinds of change your jobs allow (listed under each job). Other kinds are refused.
3. Stay inside the ranges given. Values outside a range are refused, not clamped.
4. Units: mass in kg, prices in US dollars, lengths in metres, speeds in rpm, colours as 0-1 RGB.
5. Be realistic for this exact car: its type, era, country and the modder's notes. When unsure, keep the current value (send no change).
6. Don't repeat values that are already right. Fewer, correct changes are better than many guesses.
7. Answer with one JSON object in a \`\`\`json code block, and nothing else needed: {"summary": "...", "changes": [ ... ], "notes": [ ... ]}. "summary" says in one or two sentences what you did; "notes" lists anything the modder should check or do by hand.

BeamNG facts that matter here:
- A car is a tree of parts in slots; each slot can take one of several parts (a hood slot may offer a stock and a carbon hood). Configurations choose a part per slot.
- Structure: thin panels flex and dent, the body/chassis carries the car. Parts are bolted, clipped, riveted or welded to their parent.
- Weight: a small car weighs 900-1,200 kg in total, a family car 1,300-1,600, a large SUV 2,000-2,600, a pickup 1,800-2,500.
- The game's tuning menu changes "variables": scales from min to max with a default.`;
