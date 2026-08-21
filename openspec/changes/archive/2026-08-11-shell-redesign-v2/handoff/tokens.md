# handoff: chain-A — v2 tokens and app-colour

Interface only. Source of record: `src/sdk/design-tokens.ts` (re-exported from `src/sdk/theme.ts`
— import everything from `'../../sdk/theme'`, never `design-tokens` directly).

## WhimTheme (reduced) — `ThemePref` is GONE

No presets, no accents, no shapes, no persisted pref. One frozen value, `DEFAULT_THEME`.

```ts
interface WhimTheme {
  colors: {
    bg: string; surface: string; text: string; 'text-muted': string; border: string;
    primary: string; 'on-primary': string; danger: string; positive: string; warning: string;
  };
}
export const DEFAULT_THEME: WhimTheme; // frozen; the only WhimTheme value that exists
export function sanitizeTheme(input: unknown): WhimTheme; // untrusted-input trust boundary, never throws
```

Role mapping baked into `DEFAULT_THEME`: `primary`←`accent`, `on-primary`←`#ffffff`,
`danger`←`broken`, `positive`←`working`/`done`, `warning`←`waiting`. `bg`/`surface`/`text`/
`text-muted`/`border` map 1:1 to `paper`/`surface`/`text`/`muted`/`border` below.

## SHELL_COLORS (verbatim)

| Token | Hex |
|---|---|
| paper | `#fbfaf8` |
| surface | `#f1efea` |
| border | `#e0dcd4` |
| ink | `#17171a` |
| text | `#1c1917` |
| muted | `#6b6560` |
| faint | `#a8a29a` |
| accent | `#3f3d8f` |
| yours | `#a15c07` |
| yoursOnDark | `#e0a75e` |

## STATUS_COLORS / STATUS_COLORS_ON_INK (verbatim)

| Token | Paper bg | Ink bg |
|---|---|---|
| working / done | `#0d9488` | `#2dd4bf` |
| broken | `#b91c1c` | `#f87171` |
| waiting | `#c9c3b8` | `#c9c3b8` |

`working`/`done` are the same hue (one status, two names).

## RADIUS / SPACING (px, verbatim)

`RADIUS = { chip: 999, field: 14, card: 18, tile: 22, sheet: 28 }`
`SPACING = { xs: 8, sm: 12, md: 16, lg: 22, xl: 34 }`

## MOTION (verbatim)

```ts
MOTION.breathe    = { durationMs: 1900, easing: 'ease-in-out', opacityFrom: 0.34, opacityTo: 0.72 };
MOTION.sheetRise  = { durationMs: 260, easing: 'cubic-bezier(.2,.8,.2,1)' };
MOTION.orbWheel   = { holdMs: 300, fanOutMs: 180 };
```

## FONT_FAMILY — exact Android asset filenames (no `.ttf`, that's the `fontFamily` value)

```ts
FONT_FAMILY.sansRegular  = 'InstrumentSans-Regular';
FONT_FAMILY.sansMedium   = 'InstrumentSans-Medium';
FONT_FAMILY.sansSemiBold = 'InstrumentSans-SemiBold';
FONT_FAMILY.sansBold     = 'InstrumentSans-Bold';
FONT_FAMILY.monoRegular  = 'IBMPlexMono-Regular';
FONT_FAMILY.monoMedium   = 'IBMPlexMono-Medium';
FONT_FAMILY.serifItalic  = 'Newsreader-Italic';
```

The three faces, as Android resolves the *family*: **Instrument Sans**, **IBM Plex Mono**,
**Newsreader** (italic-only style — `serifItalic` is the one variant that exists; never render it
upright).

## TYPE_SCALE — `TypeFace` fields match RN `TextStyle` exactly

```ts
interface TypeFace {
  fontFamily: string; fontSize: number; lineHeight: number; letterSpacing: number;
  fontWeight?: '400' | '500' | '600' | '700'; fontStyle?: 'italic';
  textTransform?: 'uppercase'; color?: string;
}
```

Keys: `display`, `screenTitle`, `metric`, `body`, `bodyEmphatic`, `caption`, `eyebrow`, `quote`.
`letterSpacing` is pre-multiplied from the design doc's em value into px at that face's own size —
do not reapply an em conversion. Only `quote` carries a `color` (`SHELL_COLORS.yours`) and
`fontStyle: 'italic'`; only `eyebrow` carries `textTransform: 'uppercase'`.

## appColor — invariant: never a reserved hue

```ts
export function appColor(name: string): string; // pure, deterministic (djb2 hash of `name`)
```

Same `name` always returns the same hex. The return value is **never** equal to: any
`STATUS_COLORS`/`STATUS_COLORS_ON_INK` value, `SHELL_COLORS.accent`, `SHELL_COLORS.yours`, or
`SHELL_COLORS.yoursOnDark`. Consumers: `tiles.ts#tileColor` (grid + tile fallback), and the Whim
Syntax renderer's `app`-class spans (chain-B) — both must call this one symbol, never their own
hash, so a tile and every prose mention of that app agree.

## Highlighting flag (`src/host/launcher/highlighting.ts`)

```ts
const HIGHLIGHTING_KEY = 'highlighting'; // literal KVBackend key, whim.launcher backend
export function loadHighlighting(kv: KVBackend): boolean; // default true; only '0' reads as false
export function saveHighlighting(kv: KVBackend, enabled: boolean): void; // stores '1' | '0'
```

Stores only the boolean. The Whim Syntax renderer (chain-B) reads it via `loadHighlighting` to
decide marked-up vs. flat prose; it does not own persistence.
