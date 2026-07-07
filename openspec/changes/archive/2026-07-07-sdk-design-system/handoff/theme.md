# Handoff: theme-core (chain-A)

Interface only — implementation lives in `src/sdk/theme.ts` (pure, no React/DOM) and `src/sdk/tokens.ts` (resolvers). Both are plain ESM, importable from the RN launcher too (D4).

## Types (`src/sdk/theme.ts`) — verbatim

```ts
export type ThemeShape = 'sharp' | 'soft' | 'round';

export interface WhimTheme {
  name: string;
  dark: boolean;
  shape: ThemeShape;
  colors: {
    bg: string; surface: string; text: string; 'text-muted': string; border: string;
    primary: string; 'on-primary': string;
    danger: string; positive: string; warning: string;
  };
}

export interface ThemePref { preset: string; accent?: string; shape?: ThemeShape; }
```

## Data

- `PRESETS: Record<string, {dark, shape, colors}>` — ids: `paper` (default), `ink`, `neon`,
  `meadow`, `sunset`, `mono`. Values verbatim from design.md's preset table.
- `ACCENTS: Record<string, {primary, 'on-primary'}>` — ids: `indigo`, `blue`, `sky`, `teal`,
  `green`, `amber`, `rose`, `fuchsia`, `violet`, `slate`.
- `RADIUS_SCALE: Record<ThemeShape, {none, sm, md, lg, full}>` — px strings, `none` is `'0'` for
  every shape; used by `tokens.ts#radius()`.
- `PRESETS`/`ACCENTS`/`RADIUS_SCALE`/`DEFAULT_THEME` are deep-frozen (recursive `Object.freeze`).

## Functions

```ts
function resolveTheme(pref: ThemePref): WhimTheme;
function sanitizeTheme(input: unknown): WhimTheme; // never throws
const DEFAULT_THEME: WhimTheme; // = resolveTheme({ preset: 'paper' }), frozen
```

`sanitizeTheme` is the trust boundary for `globalThis.__WHIM_THEME__`: per color field, must
match `/^#[0-9a-f]{6}$/i` else falls back to `DEFAULT_THEME.colors[field]`; `shape` must be
`'sharp'|'soft'|'round'` else `'soft'`; `dark` coerced with `!!`. Never throws; non-object input
(incl. `undefined`) yields `DEFAULT_THEME`-equivalent output.

## `src/sdk/tokens.ts` additions

- `ColorToken` gains `'positive'` and `'warning'` (10 members — matches `WhimTheme.colors` keys
  exactly, so `color(t)` is a direct `activeTheme().colors[t]` lookup).
- `export const FONT = 'system-ui, -apple-system, sans-serif'` — the one font-stack constant;
  `index.tsx`'s `Screen`/`Button` interpolate it instead of inlining a stack.
- `color()`/`radius()` resolve through a module-cached `activeTheme()`: reads
  `globalThis.__WHIM_THEME__` via `sanitizeTheme` **once** (first resolver call in the realm),
  caches in a module `let` for the realm's lifetime — a later global mutation has no effect
  until the iframe is recreated. `space()`/`weight()`/`textSize()` unchanged (theme-independent).
- `RADIUS`/`COLOR` still exist (name contract) but alias the `paper` preset's scale/colors; use
  `radius()`/`color()` at theme-aware call sites, not these static tables.

`src/sdk/index.tsx` re-exports type-only: `export type { WhimTheme, ThemeShape } from './theme';`
