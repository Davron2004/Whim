// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — `appColor` and the v2 hues it stays clear of. Re-exported from theme.ts so its readers
// import from a single surface (`../../sdk/theme`). Never part of the `vc-sdk` surface.
// ─────────────────────────────────────────────────────────────────────────────
// Pure data + one pure function. NO React import, NO DOM access, NO side effects.
//
// The shell's colours, type, spacing and radii come from the one token module
// (`src/design/tokens.ts`); what is left here is `appColor`, a pure name->hue function the legacy
// `tileColor` path and its tests still read, with the v2 shell and status hues its palette must avoid.

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
