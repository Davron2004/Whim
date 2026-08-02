// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — shell design tokens v2 (docs/design/README.md "Design tokens" / "Two systems, not
// one"). A sibling of theme.ts, re-exported from it so every downstream file keeps importing
// from a single surface (`../../sdk/theme`), same as before this redesign.
// ─────────────────────────────────────────────────────────────────────────────
// Pure data + one pure function. NO React import, NO DOM access, NO side effects.
//
// These are the SHELL's tokens: fixed, not themeable, identical on every device (the six theme
// presets this module used to hold are cut — see theme.ts). Colours/type/radius/spacing/motion
// values below are copied verbatim from the design doc; do not hand-tune them.
//
// A generated mini-app never sees these values directly — the sandboxed WebView's CSP forbids
// loading Instrument Sans/IBM Plex Mono/Newsreader remotely, and "two systems, not one" (design
// doc) keeps the shell's fixed look and each app's own look deliberately un-unified. `appColor`
// below is the one exception: a pure name->hue function shared by the shell's grid, tile
// fallback, and the Whim Syntax prose renderer (`app` spans), so an app's tile and every prose
// mention of it always agree.

/** The shell palette (design doc "Colour — the shell"). Not themeable. */
export const SHELL_COLORS = {
  paper: '#fbfaf8',
  surface: '#f1efea',
  border: '#e0dcd4',
  ink: '#17171a',
  text: '#1c1917',
  muted: '#6b6560',
  faint: '#a8a29a',
  accent: '#3f3d8f',
  yours: '#a15c07',
  yoursOnDark: '#e0a75e',
} as const;

export type ShellColorToken = keyof typeof SHELL_COLORS;

/** The three reserved status hues (design doc "Colour — status") — global vocabulary, never
 *  claimable as a generated app's primary colour. `working` and `done` share one hue. */
export const STATUS_COLORS = {
  working: '#0d9488',
  done: '#0d9488',
  broken: '#b91c1c',
  waiting: '#c9c3b8',
} as const;

/** The same three, recoloured for legibility on an `ink` background. */
export const STATUS_COLORS_ON_INK = {
  working: '#2dd4bf',
  done: '#2dd4bf',
  broken: '#f87171',
  waiting: '#c9c3b8',
} as const;

/** The shell's radius scale (design doc "Radius"), one value per named UI element — not a
 *  generic none/sm/md/lg/full ramp. Pixels. */
export const RADIUS = {
  chip: 999,
  field: 14,
  card: 18,
  tile: 22,
  sheet: 28,
} as const;

/** The shell's spacing scale (design doc "Spacing"). Pixels. */
export const SPACING = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 34,
} as const;

/** Motion constants (design doc "Motion"). `breathe` is the only loading motion — no shimmer,
 *  no travelling gradient. Consumers translate `easing`/`durationMs` into whatever animation
 *  primitive they use (RN `Animated`, Reanimated, CSS) — this module stays platform-neutral. */
export const MOTION = {
  breathe: { durationMs: 1900, easing: 'ease-in-out', opacityFrom: 0.34, opacityTo: 0.72 },
  sheetRise: { durationMs: 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
  orbWheel: { holdMs: 300, fanOutMs: 180 },
} as const;

/** Android asset filenames (android/app/src/main/assets/fonts/, canonical copies in
 *  assets/fonts/) — RN/Android resolves `fontFamily` by exact file base name, never the family
 *  display name. Newsreader ships only as its italic style (design doc: "Newsreader Italic —
 *  Only the user's own quoted words. Never upright."). */
export const FONT_FAMILY = {
  sansRegular: 'InstrumentSans-Regular',
  sansMedium: 'InstrumentSans-Medium',
  sansSemiBold: 'InstrumentSans-SemiBold',
  sansBold: 'InstrumentSans-Bold',
  monoRegular: 'IBMPlexMono-Regular',
  monoMedium: 'IBMPlexMono-Medium',
  serifItalic: 'Newsreader-Italic',
} as const;

/** Field names match RN `TextStyle` exactly (fontFamily/fontSize/lineHeight/letterSpacing/
 *  fontWeight/fontStyle/textTransform/color) so a consumer can spread a `TYPE_SCALE` entry
 *  straight into a `Text` style array. This module does not import `react-native` (kept
 *  platform-neutral, D4) — the shape is structural, not a real `TextStyle` import. */
export interface TypeFace {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight?: '400' | '500' | '600' | '700';
  fontStyle?: 'italic';
  textTransform?: 'uppercase';
  color?: string;
}

/** The type scale (design doc "Typography"). `em` letter-spacing values from the doc are
 *  pre-multiplied into px at each face's own size (RN `letterSpacing` is absolute px, not em).
 *  Line-heights come from the doc's ratio where given; `eyebrow` has none specified in the doc,
 *  so `1.2` is this module's own reasonable default, not a design-doc value. */
export const TYPE_SCALE: Record<
  'display' | 'screenTitle' | 'metric' | 'body' | 'bodyEmphatic' | 'caption' | 'eyebrow' | 'quote',
  TypeFace
> = {
  display: { fontFamily: FONT_FAMILY.sansBold, fontSize: 34, lineHeight: 34, letterSpacing: -1.02, fontWeight: '700' },
  screenTitle: { fontFamily: FONT_FAMILY.sansBold, fontSize: 26, lineHeight: 29.9, letterSpacing: -0.65, fontWeight: '700' },
  metric: { fontFamily: FONT_FAMILY.monoMedium, fontSize: 48, lineHeight: 48, letterSpacing: -1.92, fontWeight: '500' },
  body: { fontFamily: FONT_FAMILY.sansRegular, fontSize: 15, lineHeight: 25.5, letterSpacing: 0, fontWeight: '400' },
  bodyEmphatic: { fontFamily: FONT_FAMILY.sansMedium, fontSize: 15, lineHeight: 25.5, letterSpacing: 0, fontWeight: '500' },
  caption: { fontFamily: FONT_FAMILY.sansRegular, fontSize: 12, lineHeight: 18.6, letterSpacing: 0, fontWeight: '400' },
  eyebrow: { fontFamily: FONT_FAMILY.monoMedium, fontSize: 10.5, lineHeight: 12.6, letterSpacing: 1.47, fontWeight: '500', textTransform: 'uppercase' },
  quote: { fontFamily: FONT_FAMILY.serifItalic, fontSize: 17, lineHeight: 27.2, letterSpacing: 0, fontWeight: '400', fontStyle: 'italic', color: SHELL_COLORS.yours },
};

/** The mini-app SDK's generic radius scale (`tokens.ts#radius()`, `RadiusToken`). Independent
 *  of the shell's own named radius steps above (`RADIUS`) — a generated app is free-form ("no
 *  contract, no slot count, no approved palette", design doc "Two systems, not one"). Values
 *  carried over unchanged from the pre-v2 per-shape model (its `soft` shape, the old default) —
 *  the shape dimension itself is gone along with the presets it came from. */
export interface MiniAppRadiusScale {
  none: string;
  sm: string;
  md: string;
  lg: string;
  full: string;
}

export const RADIUS_SCALE: MiniAppRadiusScale = {
  none: '0',
  sm: '6px',
  md: '12px',
  lg: '20px',
  full: '999px',
};

// ── appColor ──────────────────────────────────────────────────────────────────
// A fixed palette of saturated hues, deliberately excluding every reserved shell meaning: the
// three status hues (in both their paper- and ink-background forms), the accent, and `yours`.
// Reusing any of those for an app's identity colour would let a generated app's tile accidentally
// claim a shell meaning it doesn't have (design doc "Colour — status": "a generated mini-app may
// not claim these as its primary colour, or the meanings leak").

const RESERVED_APP_COLORS: ReadonlySet<string> = new Set(
  [
    STATUS_COLORS.working,
    STATUS_COLORS.broken,
    STATUS_COLORS.waiting,
    STATUS_COLORS_ON_INK.working,
    STATUS_COLORS_ON_INK.broken,
    SHELL_COLORS.accent,
    SHELL_COLORS.yours,
    SHELL_COLORS.yoursOnDark,
  ].map((hex) => hex.toLowerCase()),
);

/** A small, legible, saturated palette — deliberately clear of the reserved hues above. Index
 *  chosen deterministically by app name in `appColor`. */
const APP_COLOR_PALETTE: readonly string[] = [
  '#2563eb', // blue
  '#0284c7', // sky
  '#ca8a04', // gold
  '#f97316', // orange
  '#65a30d', // olive
  '#16a34a', // green
  '#db2777', // magenta
  '#c026d3', // fuchsia
  '#475569', // slate
  '#0f766e', // deep teal — distinct hue-family from the reserved `working`/`done` teal
];

if (APP_COLOR_PALETTE.some((hex) => RESERVED_APP_COLORS.has(hex.toLowerCase()))) {
  // Should be unreachable — a guard against a future hand-edit reintroducing a reserved hue.
  throw new Error('appColor palette collides with a reserved shell hue');
}

/** A stable string hash (djb2). Same name -> same number, every run. */
function hashName(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = ((h << 5) + h + (name.codePointAt(i) ?? 0)) >>> 0;
  }
  return h;
}

/**
 * A pure, deterministic name -> colour mapping (placement pin: lives in the SDK theme module;
 * the home grid, the tile fallback, and the Whim Syntax prose renderer's `app` spans all import
 * this one symbol, so an app's tile and every prose mention of it always agree). Draws from a
 * fixed palette that excludes the three status hues, the accent, and the `yours` brown — see
 * `APP_COLOR_PALETTE` above.
 */
export function appColor(name: string): string {
  return APP_COLOR_PALETTE[hashName(name) % APP_COLOR_PALETTE.length];
}
