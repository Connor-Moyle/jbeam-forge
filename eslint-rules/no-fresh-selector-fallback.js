/**
 * forge/no-fresh-selector-fallback (SPEC §3.5)
 *
 * The app-blanking crash in the original build came from Zustand selectors
 * returning a fresh reference on every snapshot, e.g.
 *     useStore((s) => s.parts[id] ?? [])
 * which makes useSyncExternalStore loop forever. This rule flags, inside a
 * selector function passed directly to `use*Store(...)`:
 *   - `?? []`, `?? {}`, `|| []`, `|| {}` fallbacks
 *   - returning an array/object literal
 *   - returning the result of .map/.filter/.slice/… or Object.keys/values/entries
 * Fix with module-level EMPTY_ARR / EMPTY_OBJ (src/shared/empty.ts), or wrap
 * the selector in useShallow / derive with useMemo.
 */
const ALLOCATING_METHODS = new Set(['map', 'filter', 'slice', 'concat', 'flatMap', 'flat', 'toSorted', 'toReversed', 'toSpliced', 'with']);
const ALLOCATING_STATICS = new Set(['keys', 'values', 'entries', 'fromEntries', 'assign', 'from']);

const isLiteralContainer = (n) => n && (n.type === 'ArrayExpression' || n.type === 'ObjectExpression');

function isAllocatingCall(n) {
  if (!n || n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression') return false;
  const prop = n.callee.property;
  if (prop.type !== 'Identifier') return false;
  if (ALLOCATING_METHODS.has(prop.name)) return true;
  const obj = n.callee.object;
  return obj.type === 'Identifier' && (obj.name === 'Object' || obj.name === 'Array') && ALLOCATING_STATICS.has(prop.name);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Zustand selectors that return fresh references' },
    messages: {
      fallback: 'Selector fallback `{{op}} {{kind}}` allocates on every snapshot. Use EMPTY_ARR / EMPTY_OBJ from @shared/empty.',
      literal: 'Selector returns a new {{kind}} literal on every snapshot. Wrap the selector in useShallow or select primitives.',
      derived: 'Selector returns a freshly derived value ({{name}}). Select the source and derive with useMemo, or use useShallow.',
    },
    schema: [],
  },
  create(context) {
    function checkReturned(node) {
      if (isLiteralContainer(node)) {
        context.report({ node, messageId: 'literal', data: { kind: node.type === 'ArrayExpression' ? 'array' : 'object' } });
      } else if (isAllocatingCall(node)) {
        const p = node.callee.property.name;
        context.report({ node, messageId: 'derived', data: { name: `.${p}()` } });
      } else if (node && node.type === 'ConditionalExpression') {
        checkReturned(node.consequent);
        checkReturned(node.alternate);
      }
    }

    function checkSelector(fn) {
      const visit = (n, inNestedFn) => {
        if (!n || typeof n.type !== 'string') return;
        if (n !== fn && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration')) {
          inNestedFn = true;
        }
        if (!inNestedFn) {
          if (n.type === 'LogicalExpression' && (n.operator === '??' || n.operator === '||') && isLiteralContainer(n.right)) {
            context.report({
              node: n,
              messageId: 'fallback',
              data: { op: n.operator, kind: n.right.type === 'ArrayExpression' ? '[]' : '{}' },
            });
          }
          if (n.type === 'ReturnStatement') checkReturned(n.argument);
        }
        for (const key of Object.keys(n)) {
          if (key === 'parent') continue;
          const child = n[key];
          if (Array.isArray(child)) child.forEach((c) => visit(c, inNestedFn));
          else if (child && typeof child.type === 'string') visit(child, inNestedFn);
        }
      };
      if (fn.body.type !== 'BlockStatement') checkReturned(fn.body);
      visit(fn.body, false);
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !/^use\w*Store$/.test(node.callee.name)) return;
        const sel = node.arguments[0];
        if (sel && (sel.type === 'ArrowFunctionExpression' || sel.type === 'FunctionExpression')) checkSelector(sel);
      },
    };
  },
};
