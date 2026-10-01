import { BEAMNG_API, CONTROLLER_HOOKS, ELECTRICS } from './api';
import type { ActionDef, OutputDef, ParamDef } from './templates';

/**
 * Plain-English notes for every line of a vehicle script, for the script
 * tutorials: what the line is (a comment, a setting read from the jbeam, an
 * electrics value written, a function the game calls…) and how it ties to
 * the template's settings, keys and outputs. Worked out from the code
 * itself, so every line of every template (and a customised copy) has one.
 */

export interface ExplainContext {
  /** Controller name, for the electrics names it writes (jbf_<name>…). */
  name: string;
  params: readonly ParamDef[];
  outputs: readonly OutputDef[];
  actions: readonly ActionDef[];
}

export interface ExplainedLine {
  /** 1-based line number. */
  n: number;
  text: string;
  note: string;
}

/** A block of code (lines up to a blank line), explained line by line. */
export interface ExplainedChunk {
  title: string;
  lines: ExplainedLine[];
}

const HOOKS = new Map(CONTROLLER_HOOKS.map((h) => [h.name, h.doc]));
const ELECTRIC_DOCS = new Map(ELECTRICS.map((e) => [e.name, e.doc]));
const API = [...BEAMNG_API].sort((a, b) => b.name.length - a.name.length);


function describeCondition(cond: string): string {
  return cond
    .replace(/\s*~=\s*/g, ' is not ')
    .replace(/\s*==\s*/g, ' is ')
    .replace(/\s*>=\s*/g, ' is at least ')
    .replace(/\s*<=\s*/g, ' is at most ')
    .replace(/\s+and\s+/g, ' and ')
    .replace(/\s+or\s+/g, ' or ')
    .replace(/^not\s+/, 'not ')
    .trim();
}

/** The setting a jbeamData key belongs to. */
function settingFor(key: string, ctx: ExplainContext): ParamDef | undefined {
  return ctx.params.find((p) => p.id === key);
}

function apiNote(line: string): string | null {
  for (const e of API) {
    if (e.kind === 'table' && e.name === 'electrics') continue;
    const name = e.name.replace(':', '[:.]');
    if (new RegExp(`(^|[^\\w.])${name.replace(/\./g, '\\.')}\\s*\\(`).test(line)) return `${e.name}: ${e.doc}`;
  }
  return null;
}

/** What an `end` closes: an if, a loop or a function, and where it started. */
export interface OpenBlock {
  kind: 'if' | 'loop' | 'function';
  /** Function name, for a function. */
  name?: string;
  line: number;
}

/**
 * One line's note. `inFunction` is the function the line sits in (null at the
 * top); `closing` is the block an `end` on this line closes.
 */
export function explainLine(raw: string, ctx: ExplainContext, inFunction: string | null, closing?: OpenBlock): string {
  const line = raw.trim();
  if (!line) return 'A blank line, to keep the code readable.';
  const comment = /^--\s?(.*)$/.exec(line);
  if (comment) return comment[1] ? `A comment for people reading the code (Lua skips it): “${comment[1]}”` : 'An empty comment line.';
  const code = line.replace(/\s+--.*$/, '');
  const trailing = /\s--\s?(.*)$/.exec(line)?.[1];
  const withTrailing = (s: string) => (trailing ? `${s} The comment after it says: “${trailing}”.` : s);

  if (/^local M\s*=\s*\{\s*\}$/.test(code)) return 'Creates M, the module table: everything the game can call on this controller (init, updateGFX, the key functions) goes into it.';
  if (/^M\.type\s*=\s*"auxiliary"$/.test(code)) return 'Tells BeamNG this is an auxiliary controller: it adds a feature to the car without driving it.';
  if (/^return M$/.test(code)) return 'Hands the module to the game. This must be the last line: it is how BeamNG gets init, updateGFX and the rest.';

  // M.name = name: the functions the game (or a key) can call.
  const exportFn = /^M\.(\w+)\s*=\s*(\w+)$/.exec(code);
  if (exportFn) {
    const [, as, fn] = exportFn;
    const hook = HOOKS.get(as!);
    if (hook) return `Gives the game ${fn}() as M.${as}: ${hook}`;
    const action = ctx.actions.find((a) => a.call.replace(/\(.*$/, '') === as);
    if (action) return `Makes ${fn}() callable from outside as M.${as}. The “${action.label}” key (${action.key || 'no key yet'}) calls it: ${action.desc}`;
    return `Makes ${fn}() callable from outside as M.${as} (other controllers, or a key you add, can call it).`;
  }

  // Functions.
  const fnDef = /^(local\s+)?function\s+([\w.:]+)\s*\(([^)]*)\)/.exec(code);
  if (fnDef) {
    const name = fnDef[2]!.replace(/^M[.:]/, '');
    const args = fnDef[3]!.trim();
    const hook = HOOKS.get(name);
    const action = ctx.actions.find((a) => a.call.replace(/\(.*$/, '') === name);
    let what = hook ? `${hook}` : action ? `The “${action.label}” key (${action.key || 'no key yet'}) runs it: ${action.desc}.` : 'A helper the code below uses.';
    if (name === 'init' || name === 'reset') what += ' jbeamData is this controller’s row in the jbeam: the settings you set in the form.';
    if (args.split(',').some((a) => a.trim() === 'dt')) what += ' dt is the time since the last frame, in seconds, so movement is the same speed at any frame rate.';
    return withTrailing(`Starts the function ${name}(${args}). ${what}`);
  }

  // Settings from the jbeam.
  const setting = /^(\w+)\s*=\s*jbeamData\.(\w+)\s+or\s+(.+)$/.exec(code);
  if (setting) {
    const [, v, key, fallback] = setting;
    const p = settingFor(key!, ctx);
    if (p) return withTrailing(`Reads your setting “${p.label}” (${key}) into ${v}${p.unit ? ` in ${p.unit}` : ''}. If the jbeam doesn’t have it, it keeps ${fallback!.trim() === v ? 'the default set at the top' : fallback!.trim()}.`);
    if (/^out/.test(key!)) return withTrailing(`Reads the electrics name to write (${key}) from the jbeam, so two copies of this script on one car don’t clash.`);
    return withTrailing(`Reads ${key} from the jbeam into ${v}, else keeps ${fallback!.trim()}.`);
  }
  if (/^jbeamData\s*=\s*jbeamData\s+or\s+savedData$/.test(code)) return 'A reset may come without the jbeam data: use the settings saved from the first init.';
  if (/^savedData\s*=\s*jbeamData$/.test(code)) return 'Keeps these settings for the next reset.';

  // Electrics written and read.
  const write = /^electrics\.values(?:\[(.+?)\]|\.(\w+))\s*=\s*(.+)$/.exec(code);
  if (write) {
    const target = write[1] ?? write[2]!;
    const value = write[3]!.trim();
    const output = ctx.outputs.find((o) => target === 'out' + (o.suffix ? o.suffix[0]!.toUpperCase() + o.suffix.slice(1) : '') || target === `"jbf_${ctx.name}${o.suffix ? `_${o.suffix}` : ''}"`);
    const named = output ? `“${output.label}” (jbf_${ctx.name}${output.suffix ? `_${output.suffix}` : ''})` : target.startsWith('"') ? target : `the electrics value named in ${target}`;
    return withTrailing(`Writes ${value} to ${named}. Electrics values are shared: animated parts, lights, gauges and sounds read them, which is how this script moves meshes and lights things.`);
  }
  const read = /electrics\.values\.(\w+)/.exec(code);
  if (read && !/^electrics\.values\.\w+\s*=/.test(code)) {
    const doc = ELECTRIC_DOCS.get(read[1]!);
    if (doc) return withTrailing(`Uses the car’s electrics value ${read[1]}: ${doc}`);
  }

  // Control flow.
  const ifThen = /^if\s+(.+)\s+then(\s+.+\s+end)?$/.exec(code);
  if (ifThen) return withTrailing(ifThen[2] ? `A one-line check: when ${describeCondition(ifThen[1]!)}, it does ${ifThen[2].replace(/\s+end$/, '').trim()}.` : `Checks a condition: the lines below run only when ${describeCondition(ifThen[1]!)}.`);
  const elseif = /^elseif\s+(.+)\s+then$/.exec(code);
  if (elseif) return withTrailing(`Otherwise, when ${describeCondition(elseif[1]!)}, the lines below run instead.`);
  if (code === 'else') return 'Otherwise (none of the checks above matched), the lines below run.';
  if (/^end[,)]?$/.test(code)) {
    if (closing?.kind === 'function') return `End of the function ${closing.name ?? ''} (started on line ${closing.line}).`;
    if (closing?.kind === 'loop') return `End of the loop started on line ${closing.line}: back to its top for the next round.`;
    if (closing?.kind === 'if') return `End of the check started on line ${closing.line}.`;
    return 'Closes the block above.';
  }
  const forOneLine = /^for\s+(.+?)\s+in\s+(.+?)\s+do\s+(.+)\s+end$/.exec(code);
  if (forOneLine) {
    if (/string\.gmatch\(.+"\[\^,%s\]\+"\)/.test(forOneLine[2]!)) return withTrailing(`Splits a comma-separated list (${forOneLine[2]!.replace(/^string\.gmatch\(|,\s*"\[.*$/g, '')}) into names and adds each one to a table.`);
    return withTrailing(`A one-line loop: for each ${forOneLine[1]!.trim()} in ${forOneLine[2]!.trim()}, it does ${forOneLine[3]!.trim()}.`);
  }
  const forIn = /^for\s+(.+)\s+in\s+(.+)\s+do$/.exec(code);
  if (forIn) return withTrailing(`A loop: for each ${forIn[1]!.trim()} in ${forIn[2]!.trim()}, the lines below run once.`);
  const forNum = /^for\s+(\w+)\s*=\s*(.+?),\s*(.+?)(?:,\s*(.+))?\s+do$/.exec(code);
  if (forNum) return withTrailing(`A counting loop: ${forNum[1]} goes from ${forNum[2]} to ${forNum[3]}${forNum[4] ? ` in steps of ${forNum[4]}` : ''}, running the lines below each time.`);
  const whileLoop = /^while\s+(.+)\s+do$/.exec(code);
  if (whileLoop) return withTrailing(`Repeats the lines below as long as ${describeCondition(whileLoop[1]!)}.`);
  const ret = /^return\s+(.+)$/.exec(code);
  if (ret) return withTrailing(`Gives back ${ret[1]} as the result of ${inFunction ?? 'this block'}.`);
  if (code === 'return') return `Leaves ${inFunction ?? 'the block'} early.`;

  // The game's functions.
  const api = apiNote(code);
  const assigned = /^(?:local\s+)?([\w.[\]"]+)\s*=\s*[^=]/.exec(code)?.[1];
  if (api) return withTrailing(assigned ? `Sets ${assigned} using ${api}` : `Calls ${api}`);
  if (/\bclamp\s*\(/.test(code)) return withTrailing(`${/^\w+\s*=/.test(code) ? `Sets ${code.split('=')[0]!.trim()} to ` : 'Uses '}a value kept between a lowest and a highest (clamp), so it can’t run past its limits.`);

  // Declarations and assignments.
  const local = /^local\s+([\w\s,]+?)(?:\s*=\s*(.+))?$/.exec(code);
  if (local) {
    const names = local[1]!.split(',').map((s) => s.trim());
    const value = local[2]?.trim();
    if (!value) return withTrailing(`Declares ${names.join(', ')} for later (empty to start with).`);
    if (value === '{}') return withTrailing(`An empty table named ${names.join(', ')}, filled in later.`);
    const pick = /^(.+?)\s+and\s+(.+?)\s+or\s+(.+)$/.exec(value);
    if (pick && names.length === 1) return withTrailing(`${inFunction ? 'Works out' : 'Sets up'} ${names[0]}: ${pick[2]} when ${describeCondition(pick[1]!.replace(/^\(|\)$/g, ''))}, otherwise ${pick[3]} (Lua’s “a and b or c” is a one-line if).`);
    if (/^\{/.test(value)) return withTrailing(`A table${names.length > 1 ? 's' : ''} named ${names.join(', ')}: ${value.endsWith('}') ? `a list of values (${value.length > 60 ? `${value.slice(0, 57)}…` : value}).` : 'its contents follow on the next lines.'}`);
    const values = value.split(',').map((s) => s.trim());
    const settings = names.map((n, i) => ({ n, v: values[i], p: ctx.params.find((p) => p.id === n) }));
    if (settings.some((s) => s.p)) return withTrailing(`Starting values for ${settings.map((s) => (s.p ? `“${s.p.label}” (${s.n} = ${s.v})` : `${s.n} = ${s.v}`)).join(', ')}. init replaces them with your settings.`);
    if (values.some((v) => /^"jbf_/.test(v))) return withTrailing(`The names of the electrics values it writes (${values.join(', ')}). Animated parts, lights and gauges read them by these names.`);
    if (inFunction) return withTrailing(`Works out ${names.join(', ')} = ${value} for the lines below (local: only used inside ${inFunction}).`);
    return withTrailing(`Sets up ${names.join(', ')} = ${value}, kept between frames (the script’s memory).`);
  }
  const assign = /^([\w.[\]"]+(?:\s*,\s*[\w.[\]"]+)*)\s*=\s*(.+)$/.exec(code);
  if (assign) {
    const target = assign[1]!.trim();
    const value = assign[2]!.trim();
    if (/^\w+$/.test(target) && new RegExp(`^${target}\\s*[-+*/]`).test(value)) return withTrailing(`Updates ${target}: ${value}.`);
    return withTrailing(`Sets ${target} to ${value}.`);
  }
  const call = /^([\w.:]+)\s*\((.*)\)$/.exec(code);
  if (call) return withTrailing(`Runs ${call[1]}(${call[2]})${ctx.actions.some((a) => a.call.startsWith(`${call[1]}(`)) ? ', the same as its key does' : ''}.`);
  if (/^[\]}),]+$/.test(code)) return 'Closes the table or call opened above.';
  if (/^["\w].*[,;]$/.test(code) || /^\{/.test(code)) return withTrailing('One entry of the table (or call) above.');
  return withTrailing('Continues the code above.');
}

/**
 * Every line of a script, in blocks (split at blank lines), each line with
 * its note. The block title comes from its first comment or function.
 */
export function explainLua(lua: string, ctx: ExplainContext): ExplainedChunk[] {
  const lines = lua.replace(/\r\n/g, '\n').split('\n');
  const chunks: ExplainedChunk[] = [];
  let current: ExplainedLine[] = [];
  const stack: OpenBlock[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current.find((l) => l.text.trim());
    const fn = current.map((l) => /function\s+([\w.:]+)/.exec(l.text)?.[1]).find(Boolean);
    const comment = current.map((l) => /^\s*--\s?(.+)$/.exec(l.text)?.[1]).find(Boolean);
    const title = fn ? `The ${fn.replace(/^M[.:]/, '')} function` : comment ? comment.replace(/[.:]$/, '') : first ? first.text.trim().slice(0, 48) : 'Code';
    chunks.push({ title, lines: current });
    current = [];
  };
  lines.forEach((text, i) => {
    const trimmed = text.trim();
    if (!trimmed) {
      // A blank line inside a function doesn't split it.
      if (!stack.length) flush();
      return;
    }
    const code = trimmed.startsWith('--') ? '' : trimmed.replace(/\s+--.*$/, '');
    const fn = /^(?:local\s+)?function\s+([\w.:]+)/.exec(code)?.[1] ?? (/=\s*function\s*\(/.test(code) ? 'an inline function' : null);
    // Blocks this line opens and closes, in order, so "end" knows what it closes.
    const words = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '').match(/\b(function|if|for|while|repeat|then|do|end|elseif)\b/g) ?? [];
    let closing: OpenBlock | undefined;
    for (const w of words) {
      if (w === 'function') stack.push({ kind: 'function', name: fn ?? 'an inline function', line: i + 1 });
      else if (w === 'if') stack.push({ kind: 'if', line: i + 1 });
      else if (w === 'for' || w === 'while') stack.push({ kind: 'loop', line: i + 1 });
      else if (w === 'end') closing = stack.pop();
    }
    const within = [...stack].reverse().find((b) => b.kind === 'function')?.name ?? closing?.name ?? fn ?? null;
    current.push({ n: i + 1, text, note: explainLine(text, ctx, within?.replace(/^M[.:]/, '') ?? null, closing) });
  });
  flush();
  return chunks;
}
