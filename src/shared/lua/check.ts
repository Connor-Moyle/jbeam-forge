import { parse, type Chunk, type Node } from 'luaparse';
import { BEAMNG_API, CONTROLLER_HOOKS, KNOWN_GLOBALS, UNAVAILABLE } from './api';

/**
 * The Lua checker (fork): what's wrong with a vehicle script before it goes
 * in game. Syntax errors (with a hint for the usual slips from other
 * languages), names used but never defined, globals made by a missing
 * `local`, locals never used, `obj.` where BeamNG needs `obj:`, functions
 * vehicle Lua doesn't have, writes to electrics that should go to
 * electrics.values, and, for a controller, the `return M` and the hooks the
 * game calls.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface LuaDiagnostic {
  severity: Severity;
  message: string;
  /** 1-based line and column; end is exclusive. */
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** Character offsets (for the editor). */
  from: number;
  to: number;
  code: string;
}

export interface CheckOptions {
  /** A controller module: must return its table, and should define hooks. */
  controller?: boolean;
  /** Extra globals to accept (a template's own). */
  globals?: readonly string[];
}

export interface CheckResult {
  diagnostics: LuaDiagnostic[];
  ok: boolean;
  /** Hooks the returned module defines (controller mode). */
  hooks: string[];
}

const OBJ_METHODS = new Set(BEAMNG_API.filter((e) => e.name.startsWith('obj:')).map((e) => e.name.slice(4)));
const HOOK_NAMES = new Set(CONTROLLER_HOOKS.map((h) => h.name));

interface Loc {
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
  range?: [number, number];
}

function at(node: Loc, severity: Severity, code: string, message: string): LuaDiagnostic {
  const s = node.loc?.start ?? { line: 1, column: 0 };
  const e = node.loc?.end ?? s;
  return { severity, code, message, line: s.line, col: s.column + 1, endLine: e.line, endCol: e.column + 1, from: node.range?.[0] ?? 0, to: node.range?.[1] ?? 0 };
}

/** Plain-language hints for syntax errors people make coming from other languages. */
function syntaxHint(line: string): string {
  if (/[+\-*/]=/.test(line)) return ' Lua has no += or -=: write x = x + 1.';
  if (/!=/.test(line)) return ' Lua writes “not equal” as ~=.';
  if (/\+\+|--\s*$/.test(line) && /\w\+\+/.test(line)) return ' Lua has no ++: write x = x + 1.';
  if (/\/\//.test(line)) return ' Comments start with -- in Lua.';
  if (/&&|\|\|/.test(line)) return ' Lua uses the words and / or.';
  if (/\bthen\b/.test(line) === false && /^\s*(if|elseif)\b/.test(line)) return ' An if needs then after its condition.';
  if (/\{\s*$/.test(line) && /\b(if|function|for|while)\b/.test(line)) return ' Lua blocks don’t use braces: if … then … end.';
  return '';
}

interface Scope {
  vars: Map<string, { node: Loc; used: boolean; param: boolean }>;
  parent: Scope | null;
}

export function checkLua(code: string, opts: CheckOptions = {}): CheckResult {
  const out: LuaDiagnostic[] = [];
  let ast: Chunk;
  try {
    ast = parse(code, { luaVersion: 'LuaJIT', locations: true, ranges: true, comments: false });
  } catch (err) {
    const e = err as { line?: number; column?: number; index?: number; message?: string };
    const line = e.line ?? 1;
    const col = (e.column ?? 0) + 1;
    const text = (e.message ?? 'Syntax error').replace(/^\[\d+:\d+\]\s*/, '');
    const src = code.split('\n')[line - 1] ?? '';
    const from = e.index ?? 0;
    out.push({ severity: 'error', code: 'syntax', message: `Syntax: ${text}.${syntaxHint(src)}`, line, col, endLine: line, endCol: col + 1, from, to: Math.min(code.length, from + 1) });
    return { diagnostics: out, ok: false, hooks: [] };
  }

  const extra = new Set(opts.globals ?? []);
  const globalWrites = new Set<string>();
  let scope: Scope = { vars: new Map(), parent: null };
  const push = () => (scope = { vars: new Map(), parent: scope });
  const pop = () => {
    for (const [name, v] of scope.vars) if (!v.used && !v.param && !name.startsWith('_') && name !== 'M') out.push(at(v.node, 'info', 'unused', `${name} is never used.`));
    scope = scope.parent ?? scope;
  };
  const declare = (id: { name: string } & Loc, param = false) => {
    scope.vars.set(id.name, { node: id, used: false, param });
  };
  const lookup = (name: string) => {
    for (let s: Scope | null = scope; s; s = s.parent) {
      const v = s.vars.get(name);
      if (v) return v;
    }
    return null;
  };
  const reported = new Set<string>();

  const readName = (id: { name: string } & Loc) => {
    const v = lookup(id.name);
    if (v) {
      v.used = true;
      return;
    }
    if (KNOWN_GLOBALS.has(id.name) || extra.has(id.name) || globalWrites.has(id.name)) return;
    const key = `read:${id.name}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push(at(id, 'warning', 'undefined', `${id.name} isn’t defined here: a typo, or a local declared further down?`));
  };
  const writeName = (id: { name: string } & Loc) => {
    const v = lookup(id.name);
    if (v) return;
    globalWrites.add(id.name);
    if (KNOWN_GLOBALS.has(id.name)) {
      out.push(at(id, 'warning', 'shadow', `Assigning ${id.name} replaces the game’s own ${id.name} for every script on the car.`));
      return;
    }
    const key = `write:${id.name}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push(at(id, 'warning', 'global', `${id.name} becomes a global, shared with every script on the car: declare it with local.`));
  };

  /** "a.b.c" for a member chain of plain names, else null. */
  const dotted = (n: Node): string | null => {
    if (n.type === 'Identifier') return n.name;
    if (n.type === 'MemberExpression') {
      const base = dotted(n.base);
      return base ? `${base}${n.indexer}${n.identifier.name}` : null;
    }
    return null;
  };

  const hooksDefined = new Set<string>();
  let moduleName: string | null = null;
  const last = ast.body[ast.body.length - 1];
  if (last?.type === 'ReturnStatement' && last.arguments.length === 1 && last.arguments[0]!.type === 'Identifier') moduleName = last.arguments[0].name;
  const noteHook = (target: Node) => {
    if (target.type !== 'MemberExpression' || target.base.type !== 'Identifier' || target.base.name !== moduleName) return;
    const name = target.identifier.name;
    hooksDefined.add(name);
    if (!HOOK_NAMES.has(name)) {
      const near = [...HOOK_NAMES].find((h) => h.toLowerCase() === name.toLowerCase());
      if (near) out.push(at(target.identifier, 'warning', 'hook-case', `The game calls ${near}, not ${name}: names are case-sensitive.`));
    }
  };

  const visit = (node: Node | null | undefined): void => {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        readName(node);
        return;
      case 'LocalStatement':
        node.init.forEach(visit);
        for (const v of node.variables) declare(v);
        return;
      case 'AssignmentStatement':
        node.init.forEach(visit);
        for (const t of node.variables) {
          if (t.type === 'Identifier') writeName(t);
          else {
            if (t.type === 'MemberExpression') {
              noteHook(t);
              const name = dotted(t);
              if (name && /^electrics\.(?!values\b)\w+$/.test(name)) out.push(at(t, 'warning', 'electrics', `Write ${name.replace('electrics.', 'electrics.values.')}: electrics.${t.identifier.name} isn’t a value props or lights read.`));
              visit(t.base);
            } else {
              visit(t.base);
              visit(t.index);
            }
          }
        }
        return;
      case 'FunctionDeclaration': {
        if (node.identifier) {
          if (node.isLocal && node.identifier.type === 'Identifier') declare(node.identifier);
          else if (node.identifier.type === 'Identifier') writeName(node.identifier);
          else {
            noteHook(node.identifier);
            visit(node.identifier.type === 'MemberExpression' ? node.identifier.base : node.identifier);
          }
        }
        push();
        // function M:name() has an implicit self.
        if (node.identifier?.type === 'MemberExpression' && node.identifier.indexer === ':') declare({ name: 'self', ...(node.identifier as Loc) }, true);
        for (const p of node.parameters) if (p.type === 'Identifier') declare(p, true);
        node.body.forEach(visit);
        pop();
        return;
      }
      case 'ForNumericStatement':
        visit(node.start);
        visit(node.end);
        visit(node.step);
        push();
        declare(node.variable, true);
        node.body.forEach(visit);
        pop();
        return;
      case 'ForGenericStatement':
        node.iterators.forEach(visit);
        push();
        for (const v of node.variables) declare(v, true);
        node.body.forEach(visit);
        pop();
        return;
      case 'DoStatement':
      case 'WhileStatement':
        if (node.type === 'WhileStatement') visit(node.condition);
        push();
        node.body.forEach(visit);
        pop();
        return;
      case 'RepeatStatement':
        push();
        node.body.forEach(visit);
        visit(node.condition);
        pop();
        return;
      case 'IfStatement':
        for (const clause of node.clauses) {
          if (clause.type !== 'ElseClause') visit(clause.condition);
          push();
          clause.body.forEach(visit);
          pop();
        }
        return;
      case 'MemberExpression': {
        const name = dotted(node);
        if (name && UNAVAILABLE[name]) out.push(at(node, 'error', 'unavailable', `${name} isn’t available in vehicle Lua. ${UNAVAILABLE[name]}`));
        else visit(node.base);
        return;
      }
      case 'CallExpression':
      case 'StringCallExpression':
      case 'TableCallExpression': {
        const base = node.base;
        if (base.type === 'MemberExpression' && base.indexer === '.' && base.base.type === 'Identifier' && base.base.name === 'obj' && OBJ_METHODS.has(base.identifier.name)) {
          out.push(at(base, 'warning', 'colon', `Call it as obj:${base.identifier.name}(…) with a colon: with a dot the car isn’t passed in.`));
        }
        visit(base);
        if (node.type === 'CallExpression') node.arguments.forEach(visit);
        else if (node.type === 'StringCallExpression') visit(node.argument);
        else visit(node.arguments);
        return;
      }
      case 'IndexExpression':
        visit(node.base);
        visit(node.index);
        return;
      case 'TableConstructorExpression':
        for (const f of node.fields) {
          if (f.type === 'TableKey') visit(f.key);
          visit(f.value);
        }
        return;
      case 'BinaryExpression':
      case 'LogicalExpression':
        visit(node.left);
        visit(node.right);
        return;
      case 'UnaryExpression':
        visit(node.argument);
        return;
      case 'ReturnStatement':
        node.arguments.forEach(visit);
        return;
      case 'CallStatement':
        visit(node.expression);
        return;
      case 'GotoStatement':
      case 'LabelStatement':
      case 'BreakStatement':
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'NilLiteral':
      case 'VarargLiteral':
        return;
      default:
        return;
    }
  };

  // Pre-pass: names assigned as globals anywhere (so reads before the assignment aren't "undefined").
  const prepass = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(prepass);
    const node = n as Node;
    if (node.type === 'AssignmentStatement') for (const t of node.variables) if (t.type === 'Identifier') globalWrites.add(t.name);
    if (node.type === 'FunctionDeclaration' && !node.isLocal && node.identifier?.type === 'Identifier') globalWrites.add(node.identifier.name);
    for (const v of Object.values(node)) if (v && typeof v === 'object') prepass(v);
  };
  // Only a name nothing declares locally counts; locals are resolved during the walk.
  prepass(ast.body);
  for (const s of ast.body) visit(s);
  pop();

  if (opts.controller) {
    if (!moduleName) {
      out.push({ ...at(last ?? ast, 'error', 'no-return', 'A vehicle script must end with return M (the table of functions the game calls).'), from: code.length, to: code.length });
    } else {
      // A table constructor's keys count too: local M = { updateGFX = f }.
      const declaredAsTable = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(declaredAsTable);
        const node = n as Node;
        if (node.type === 'LocalStatement' || node.type === 'AssignmentStatement') {
          node.variables.forEach((v, i) => {
            const init = node.init[i];
            if (v.type === 'Identifier' && v.name === moduleName && init?.type === 'TableConstructorExpression') for (const f of init.fields) if (f.type === 'TableKeyString') hooksDefined.add(f.key.name);
          });
        }
        for (const v of Object.values(node)) if (v && typeof v === 'object') declaredAsTable(v);
      };
      declaredAsTable(ast.body);
      const hooks = [...hooksDefined].filter((h) => HOOK_NAMES.has(h));
      if (!hooks.length) out.push(at(last!, 'warning', 'no-hooks', `${moduleName} defines none of the functions the game calls (init, updateGFX, update…), so the script never runs.`));
      if (hooksDefined.has('update') && !hooksDefined.has('updateGFX')) out.push(at(last!, 'info', 'update-rate', 'update runs 2000 times a second: animations and logic belong in updateGFX (once a frame).'));
    }
  }
  out.sort((a, b) => a.from - b.from || (a.severity === 'error' ? -1 : 1));
  return { diagnostics: out, ok: !out.some((d) => d.severity === 'error'), hooks: [...hooksDefined].filter((h) => HOOK_NAMES.has(h)) };
}
