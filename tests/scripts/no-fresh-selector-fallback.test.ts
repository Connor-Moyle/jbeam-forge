import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
// @ts-expect-error -- plain JS rule module
import rule from '../../eslint-rules/no-fresh-selector-fallback.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });

tester.run('no-fresh-selector-fallback', rule as never, {
  valid: [
    'const x = useUiStore((s) => s.parts[id] ?? EMPTY_ARR);',
    'const x = useUiStore((s) => s.count);',
    'const x = useUiStore((s) => s.count ?? 0);',
    'const x = useUiStore(useShallow((s) => ({ a: s.a, b: s.b })));',
    'const x = useUiStore(useShallow((s) => s.list.map((i) => i.id)));',
    'const x = useUiStore((s) => s.setCollapsed);',
    // Nested callbacks inside the selector are not the selector's return value.
    'const x = useUiStore((s) => s.items.find((i) => (i.tags ?? []).includes(t)));',
    // Non-store hooks are out of scope.
    'const x = useMemo(() => a ?? [], [a]);',
  ],
  invalid: [
    { code: 'const x = useUiStore((s) => s.parts[id] ?? []);', errors: [{ messageId: 'fallback' }] },
    { code: 'const x = useProjectStore((s) => s.meta || {});', errors: [{ messageId: 'fallback' }] },
    { code: 'const x = useUiStore((s) => ({ a: s.a, b: s.b }));', errors: [{ messageId: 'literal' }] },
    { code: 'const x = useUiStore((s) => [s.a, s.b]);', errors: [{ messageId: 'literal' }] },
    { code: 'const x = useUiStore((s) => s.list.filter((i) => i.on));', errors: [{ messageId: 'derived' }] },
    { code: 'const x = useUiStore((s) => Object.keys(s.map));', errors: [{ messageId: 'derived' }] },
    { code: 'const x = useUiStore(function (s) { return s.ok ? s.list : []; });', errors: [{ messageId: 'literal' }] },
    { code: 'const x = useUiStore((s) => { const v = s.x ?? {}; return v; });', errors: [{ messageId: 'fallback' }] },
  ],
});
