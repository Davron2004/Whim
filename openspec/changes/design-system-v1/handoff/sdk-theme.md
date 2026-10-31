# Contract: sdk-theme (chain-3)

Interface only. Values live in `src/design/tokens.ts` (handoff/design-tokens.md); system.md §2.5 and §7.2
say what they mean.

## `src/sdk/theme.ts` — the inert theme and its sanitizer (pure, no React/DOM)

```ts
export interface WhimThemeColors {
  bg; surface; sheet; 'sheet-group'; thumb; text; 'text-muted'; border;   // all string
  primary; 'on-primary'; danger; positive; warning;
}
export interface WhimTheme {
  colors: WhimThemeColors;
  scheme: Scheme;                 // 'light' | 'dark'           default 'light'
  tint: TintName;                 // one of TINT_NAMES           default 'slate'
  fontScale: number;              // clamped 0.85–2.0            default 1
  reduceMotion: boolean;          //                             default false
  increaseContrast: boolean;      //                             default false
  platform: 'ios' | 'android';    //                             default 'android'
}
export const FONT_SCALE_RANGE = { min: 0.85, max: 2 };
export function sanitizeTheme(input: unknown): WhimTheme;   // never throws
export const DEFAULT_THEME: WhimTheme;                      // = sanitizeTheme(undefined), deep-frozen
export * from './design-tokens';                            // v2 shell tokens, unchanged (shell still reads them)
```

`vc-sdk` re-exports `WhimTheme` type-only; nothing else from this file is public.

Sanitizing rules (field by field, unknown keys dropped, so the loader's `chromeInsetBottom` never survives):

- `scheme`, `tint`, `platform`: exact member of the closed set, else the default.
- `fontScale`: a finite number, clamped to the range; anything else (NaN, ±Infinity, a string) is 1.
- `reduceMotion`, `increaseContrast`: `typeof === 'boolean'`, else false.
- Colours: every role except `primary`/`on-primary` takes the delivered value when it matches
  `/^#[0-9a-f]{6}$/i`, else the token module's value **for the sanitized scheme** (`COLORS[scheme]`;
  `text-muted` ← `text-2`, status names ← their fills).
- `primary` = `TINTS[tint][scheme]`, `on-primary` = `ON_TINT[scheme]`, always. A delivered
  `colors.primary` is ignored: the tint name is the one source. The host only needs to send `tint`.

## `src/sdk/tokens.ts` — resolvers (internal to the SDK; not re-exported from `vc-sdk`)

```ts
export type SpaceToken = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type RadiusToken = 'none' | 'sm' | 'md' | 'lg' | 'full';
export type ColorToken = 'text'|'text-muted'|'primary'|'on-primary'|'bg'|'surface'|'border'|'danger'|'positive'|'warning';
export type TextColorToken = 'text' | 'text-muted' | 'primary' | 'positive' | 'danger' | 'warning';
export type TextSizeToken = SdkTextSize;      // 'display' | 'title' | 'subtitle' | 'body' | 'caption'
export type WeightToken = 'regular' | 'medium' | 'semibold' | 'bold';
export type PaintRole = ColorToken | keyof WhimThemeColors | ColorRole;  // ColorRole from src/design/tokens
export interface ResolvedTextSize { size: string; line: string; tracking: string; weight: WeightToken }

export const FONT: string;                    // 'system-ui, -apple-system, sans-serif'
export const TABULAR_NUMS = { fontVariantNumeric: 'tabular-nums' };   // spread into a style
export const WEIGHT: Record<WeightToken, number>;                    // 400 500 600 700

export function activeTheme(): WhimTheme;     // sanitizes globalThis.__WHIM_THEME__ once, then cached

// pure, over an explicit theme (use these in tests)
export function resolveColor(theme: WhimTheme, t: PaintRole): string;
export function resolveTextColor(theme: WhimTheme, t: TextColorToken): string;
export function resolveTextSize(theme: WhimTheme, t: TextSizeToken): ResolvedTextSize;

// the same over activeTheme() (use these in components)
export const color: (t?: PaintRole) => string;               // default 'text'
export const textColor: (t?: TextColorToken) => string;      // default 'text'
export const textSize: (t?: TextSizeToken) => ResolvedTextSize;  // default 'body'
export const space: (t?: SpaceToken) => string;              // 'none' → '0'; xs 4, sm 8, md 12, lg 20, xl 32 ('Npx')
export const radius: (t?: RadiusToken) => string;            // 'none' → '0'; sm 10, md 14, lg 20, full 999 ('Npx')
export const weight: (t?: WeightToken) => number;
```

- **Fill vs text form.** `color(role)` is the fill: a role the theme carries reads `theme.colors`, any
  other token-module role (`fill`, `fill-strong`, `separator`, `text-3`, `scrim`, `danger-soft`,
  `danger-text`, `on-danger`, `ember`, …) reads `COLORS[theme.scheme]`; an unknown name gives `text`.
  `textColor(t)` is the readable form: status names → `<status>-text`, `primary` → the tint value
  (fill and text are the same value for a tint), `text-muted` → `text-2`. Use `textColor` for any
  text or icon colour, `color` for backgrounds, tracks, marks, borders.
- **Legacy `Text color`.** Values outside `TextColorToken` from old bundles render as:
  `on-primary`/`bg`/`surface` → `text`, `border` → `text-muted`, anything else → `text`. Never throws.
- **`increaseContrast`** — applied inside the resolvers: `text-muted` resolves to `text` in both
  `color` and `textColor`. Outlining `Card`/`List` is the component's job (chain-5), read
  `activeTheme().increaseContrast`.
- **`fontScale`** — applied inside `textSize`: `size` and `line` are `px` strings of the system.md
  §7.2 sizes × `fontScale` (rounded to 0.01): caption 13/18, body 17/24, subtitle 20/25, title
  28/34, display 40/44. `tracking` is the type token's em value (scales with the size by itself).
  `weight` is the size's default (subtitle semibold, title/display bold, others regular).
  Stacking at 1.35 and the 44/48 targets are component decisions: read `activeTheme().fontScale`,
  `.platform` (`LAYOUT.touchTarget` in the token module).
- **`reduceMotion`, `scheme`, `tint`, `platform`** — no resolver uses them beyond the colours;
  motion (chain-6) and components read `activeTheme()`.
- **Read once.** `activeTheme()` caches its first result; module-level code may call `space` and
  `radius` only (they are theme-independent). Calling `color`/`textSize` at module load would pin the
  default theme before the loader installs the delivered one.

## `src/sdk/press.ts`

```ts
export const TAP_RESET = { WebkitTapHighlightColor: 'transparent' };
export const CONTROL_RESET = { ...TAP_RESET, userSelect: 'none', WebkitUserSelect: 'none' };
```

Spread `CONTROL_RESET` into every control (button, toggle row, slider, segment, pressable card/row);
`TAP_RESET` alone on non-control click targets (Modal scrim and sheet) and inputs. `Screen` no longer
disables selection: text is selectable.

## Component state after this chain (what chain-4/5 start from)

- `Screen`: `bg`, body font from `textSize('body')` (size/line), `overscrollBehavior: 'none'`.
- `Text`/`Heading`: `color?: TextColorToken` via `textColor`, `letterSpacing: tracking`; `Text size="display"`
  is tabular. `NumberInput` is tabular. `Modal` sheet has `overscrollBehavior: 'contain'`.
- Everything else (sizes, radii, borders, `16px` fonts in controls) is unchanged v2 styling over the
  new resolver values: chain-5's restyle.
- `src/host/launcher/theme.ts` `SHELL_PALETTE` is pinned to the v2 `SHELL_COLORS`/`STATUS_COLORS`
  values (EXEMPT entry in `design-system.suite.ts` for its white `onAccent`); `LauncherRoot` still
  passes `DEFAULT_THEME` to `MiniAppView` — the host frame builder (scheme, tint, fontScale, …) is a
  later chain's.
