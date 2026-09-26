# Zustand rules (SPEC §3.5)

The original build's "blank app" crash came from two mistakes: selectors that return a fresh reference on every snapshot, and store writes during render. React's `useSyncExternalStore` treats a new reference as a change, so these patterns loop until React gives up and unmounts the tree.

## The stable-selector rule

**A selector passed to `use*Store(...)` must return either a primitive, or a reference that already lives in the store.**

| ❌ Don't | ✅ Do |
|---|---|
| `useStore((s) => s.parts[id] ?? [])` | `useStore((s) => s.parts[id] ?? EMPTY_ARR)` |
| `useStore((s) => s.meta \|\| {})` | `useStore((s) => s.meta ?? EMPTY_OBJ)` |
| `useStore((s) => ({ a: s.a, b: s.b }))` | `useStore(useShallow((s) => ({ a: s.a, b: s.b })))` |
| `useStore((s) => s.list.filter(f))` | `const list = useStore((s) => s.list); const shown = useMemo(() => list.filter(f), [list]);` |

`EMPTY_ARR` and `EMPTY_OBJ` live in `src/shared/empty.ts` and are frozen module-level constants.

`npm run lint` enforces this with `forge/no-fresh-selector-fallback` (`eslint-rules/`). The rule flags `?? []`, `?? {}`, `|| []` and `|| {}` inside selectors. It also flags returned array/object literals, and returned `.map/.filter/.slice/…` or `Object.keys/values/entries` results. Selectors wrapped in `useShallow` are exempt.

## Never write to a store during render

- Creation-on-demand (`getOrCreateSettings()`-style) goes in `useEffect`, never in the render body.
- Store actions must be no-ops when nothing changes (see `setCollapsed` in `src/renderer/app/stores/ui.ts`). That keeps references stable and avoids pointless notifications.
- `react-hooks/*` ESLint rules are errors, not warnings.

## Where state lives

- **Zustand stores**: app/document state shared across panels (`src/renderer/app/stores/`).
- **Component state**: purely local UI (hover, drafts).
- **Persisted UI conveniences** (collapsed sections): `zustand/middleware` `persist` with `partialize`, so only the durable slice is stored.
- **User settings**: main process (`SettingsService`, `userData/settings.json`) via IPC. Never localStorage.
