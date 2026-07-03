// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — design tokens (spec §5.2 / §5.3: components accept TOKENS, not values)
// ─────────────────────────────────────────────────────────────────────────────
// The load-bearing contract this file fixes is "tokens, not values": a mini-app says
// `<Text color="primary">` / `<Stack gap="lg">`, never a hex code or a pixel count. That
// indirection is what keeps the SDK render contract backend-agnostic (#11 / §4.6) — the
// same `gap="lg"` could later be resolved by a native reconciler instead of these CSS
// strings. v0.1 resolves them to CSS (React-to-DOM inside the WebView, hypothesis R1).
//
// v0.2 (sdk-design-system, decision D1/D2): `color()` and `radius()` now resolve through
// the ACTIVE THEME (theme.ts) instead of one hardcoded palette — see theme.ts for how
// `globalThis.__WHIM_THEME__` becomes a trusted `WhimTheme`. `space()`/`weight()`/
// `textSize()` are theme-independent and behave exactly as before.

import { sanitizeTheme, DEFAULT_THEME, RADIUS_SCALE, type WhimTheme } from './theme';

export type SpaceToken = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type RadiusToken = 'none' | 'sm' | 'md' | 'lg' | 'full';
export type ColorToken =
  | 'text'
  | 'text-muted'
  | 'primary'
  | 'on-primary'
  | 'bg'
  | 'surface'
  | 'border'
  | 'danger'
  | 'positive'
  | 'warning';
export type TextSizeToken = 'caption' | 'body' | 'subtitle' | 'title' | 'display';
export type WeightToken = 'regular' | 'medium' | 'semibold' | 'bold';

/** The system font stack every SDK component renders with. CSP forbids remote fonts (design
 *  Non-Goals), so system-ui is the whole typeface story — one constant, no per-component
 *  drift. */
export const FONT = 'system-ui, -apple-system, sans-serif';

export const SPACE: Record<SpaceToken, string> = {
  none: '0',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '20px',
  xl: '32px',
};

/** The `paper`-preset (soft-shape) radius scale, kept as a static export for existing
 *  consumers. The resolver `radius()` below maps through the ACTIVE theme's shape scale
 *  instead of this fixed table. */
export const RADIUS: Record<RadiusToken, string> = RADIUS_SCALE.soft;

/** The `paper`-preset color table, kept as a static export for existing consumers. The
 *  resolver `color()` below reads the ACTIVE theme instead of this fixed table. */
export const COLOR: Record<ColorToken, string> = DEFAULT_THEME.colors;

// font-size paired with a sensible default weight + line-height per size token.
export const TEXT_SIZE: Record<TextSizeToken, { size: string; weight: WeightToken; line: string }> = {
  caption: { size: '13px', weight: 'regular', line: '1.35' },
  body: { size: '16px', weight: 'regular', line: '1.45' },
  subtitle: { size: '20px', weight: 'semibold', line: '1.3' },
  title: { size: '28px', weight: 'bold', line: '1.2' },
  display: { size: '40px', weight: 'bold', line: '1.1' },
};

export const WEIGHT: Record<WeightToken, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// ── Active theme (design D1) ──────────────────────────────────────────────────
// `globalThis.__WHIM_THEME__` is untrusted input the loader installs (best-effort frozen)
// from the trusted `__whimHostInit` frame before the bundle mounts; it is absent in any
// host that never sets it (e.g. a bare desktop preview). Sanitized ONCE, at the first
// resolver call below, and cached in this module-level `let` — never re-read per render, so
// an in-realm mutation of the global after mount has no effect. When the global is absent,
// `sanitizeTheme(undefined)` yields `DEFAULT_THEME` semantics (every field falls back).
let cachedTheme: WhimTheme | undefined;

function activeTheme(): WhimTheme {
  if (!cachedTheme) {
    cachedTheme = sanitizeTheme((globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__);
  }
  return cachedTheme;
}

// Resolvers — the single place a token becomes a value. A native-reconciler backend would
// swap this module for one that maps the same token names to native style primitives.
export const space = (t: SpaceToken = 'none'): string => SPACE[t] ?? SPACE.none;
export const radius = (t: RadiusToken = 'none'): string => {
  const scale = RADIUS_SCALE[activeTheme().shape];
  return scale[t] ?? scale.none;
};
export const color = (t: ColorToken = 'text'): string => activeTheme().colors[t] ?? activeTheme().colors.text;
export const weight = (t: WeightToken = 'regular'): number => WEIGHT[t] ?? WEIGHT.regular;
export const textSize = (t: TextSizeToken = 'body') => TEXT_SIZE[t] ?? TEXT_SIZE.body;
