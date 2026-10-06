import { isJbeamObject, parseJbeam, type JbeamObject } from '../jbeam/parse';
import { readTable } from '../jbeam/tables';

/**
 * The written jbeam as the game will assemble it, for one configuration: walk the slot tree from
 * the main part with the configuration's choices and find what would break at spawn. Two parts
 * that load together and define the same node make the game merge or misplace it (a real export:
 * a borrowed engine's block nodes renamed onto the body's, and the car came apart on spawn); a
 * slot pointing at one of the mod's own parts that wasn't written leaves a hole.
 */

const s = (v: unknown) => (typeof v === 'string' ? v : '');

function slotRows(p: JbeamObject): { name: string; def: string }[] {
  if (p.slots2) return readTable(p.slots2).records.map((r) => ({ name: s(r.values.name), def: s(r.values.default) }));
  if (p.slots) return readTable(p.slots).records.map((r) => ({ name: s(r.values.type), def: s(r.values.default) }));
  return [];
}

export function installProblems(files: readonly { part: string; text: string }[], mainPart: string, choices: Readonly<Record<string, string>>, ownPrefix: string): string[] {
  const parts = new Map<string, JbeamObject>();
  for (const f of files) {
    try {
      const v = parseJbeam(f.text).value;
      if (isJbeamObject(v)) for (const [name, body] of Object.entries(v)) if (isJbeamObject(body)) parts.set(name, body);
    } catch {
      /* our own writer produced it; a parse failure shows up in the game's log, not here */
    }
  }
  const problems: string[] = [];
  const installed = new Set<string>([mainPart]);
  const queue = [mainPart];
  while (queue.length) {
    const p = parts.get(queue.shift()!);
    if (!p) continue;
    for (const r of slotRows(p)) {
      const choice = choices[r.name] ?? r.def;
      if (!choice || installed.has(choice)) continue;
      if (!parts.has(choice)) {
        // The game's own common parts (licence plates, paint designs) aren't in the mod: only ours must be.
        if (choice.startsWith(ownPrefix)) problems.push(`The ${r.name} slot uses ${choice}, which isn't in the mod.`);
        continue;
      }
      installed.add(choice);
      queue.push(choice);
    }
  }
  // The same node in two parts at the same place is the game's own habit (a shock part restating
  // its mount): it merges them. Two places under one name is what pulls a car apart.
  // A part of a borrowed set restating its set's node somewhere else is the game's design too (a
  // gravel coilover raising the suspension, a drift kit's steering): the later one wins. So a clash
  // is between parts of different origins: ours and a borrowed set's, or two borrowed sets.
  const owner = new Map<string, { part: string; at: string }>();
  const clashes = new Map<string, string[]>();
  const origin = (part: string) => new RegExp(`^${ownPrefix}([A-Z]\\d?)_`).exec(part)?.[1] ?? 'own';
  const where = (v: Record<string, unknown>) => ['posX', 'posY', 'posZ'].map((k) => (typeof v[k] === 'number' ? Math.round((v[k]) * 200) / 200 : JSON.stringify(v[k]))).join(',');
  for (const name of installed) {
    const p = parts.get(name);
    if (!p?.nodes) continue;
    for (const r of readTable(p.nodes).records) {
      const id = s(r.values.id);
      const at = where(r.values);
      const was = owner.get(id);
      if (was && was.part !== name) {
        const sameSet = origin(was.part) === origin(name) && origin(name) !== 'own';
        if (was.at !== at && !sameSet) clashes.set(`${was.part} and ${name}`, [...(clashes.get(`${was.part} and ${name}`) ?? []), id]);
      } else owner.set(id, { part: name, at });
    }
  }
  for (const [pair, ids] of clashes) problems.push(`${pair} both define node${ids.length > 1 ? 's' : ''} ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ` and ${ids.length - 6} more` : ''}: the game would merge them and the car can come apart.`);
  return problems;
}
