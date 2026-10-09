// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — design tokens (components accept TOKENS, not values; docs/design/system.md §2.5, §7.2)
// ─────────────────────────────────────────────────────────────────────────────
// The load-bearing contract this file fixes is "tokens, not values": a mini-app says
// `<Text color="primary">` / `<Stack gap="lg">`, never a hex code or a pixel count. That
// indirection is what keeps the SDK render contract backend-agnostic (#11) — the same `gap="lg"`
// could later be resolved by a native reconciler instead of these CSS strings.
//
// Every value comes from the one token module (`src/design/tokens.ts`). Colours and type resolve
// through the ACTIVE THEME (theme.ts): its scheme, tint, text scale and Increase Contrast.
// `space()` and `radius()` are theme-independent, so module-level code may call them before the
// theme is installed; nothing else here may run before mount.

import { COLORS, SDK_RADII, SDK_SPACE, RADII, TYPE_SCALE, type ColorRole, type SdkTextSize, type StatusName } from '../design/tokens';
import { sanitizeTheme, type WhimTheme } from './theme';

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
/** The colours text and icons take: each resolves to its readable text form. */
export type TextColorToken = 'text' | 'text-muted' | 'primary' | 'positive' | 'danger' | 'warning';
export type TextSizeToken = SdkTextSize;
export type WeightToken = 'regular' | 'medium' | 'semibold' | 'bold';

/** Every role an SDK component may paint with: the public tokens plus the system roles that have no
 *  public name (`fill`, `separator`, the status soft and text forms, …). */
export type PaintRole = ColorToken | keyof WhimTheme['colors'] | ColorRole;

/** The system font stack every SDK component renders with. The CSP keeps `font-src 'none'`, so
 *  `system-ui` is the whole typeface story (system.md §2.7). */
export const FONT = 'system-ui, -apple-system, sans-serif';

/** Tabular figures for counting and ticking numbers (timers, totals): spread into a style. */
export const TABULAR_NUMS = { fontVariantNumeric: 'tabular-nums' } as const;

export const WEIGHT: Record<WeightToken, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// ── Active theme ──────────────────────────────────────────────────────────────
// `globalThis.__WHIM_THEME__` is untrusted input the loader installs (frozen) from the trusted
// `__whimHostInit` frame before the bundle mounts; it is absent in any host that never sets it (a
// baked delivery, a desktop preview), and then every field takes its default. Sanitized ONCE, at
// the first call, and cached: never re-read per render, so an in-realm mutation of the global after
// mount has no effect, and a change of the phone's settings applies at the app's next open.
let cachedTheme: WhimTheme | undefined;

/** The sanitized theme this realm renders under. */
export function activeTheme(): WhimTheme {
  cachedTheme ??= sanitizeTheme((globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__);
  return cachedTheme;
}

/** The text-form role of each status hue. */
const STATUS_TEXT: Record<StatusName, ColorRole> = {
  positive: 'positive-text',
  danger: 'danger-text',
  warning: 'warning-text',
};

/** What an old bundle's `Text color` outside the narrowed set renders as. */
const LEGACY_TEXT_COLOR: Readonly<Record<string, TextColorToken>> = {
  'on-primary': 'text',
  bg: 'text',
  surface: 'text',
  border: 'text-muted',
};

/** `key` is an own property of `table` (a bundle can pass any string; `'constructor' in {}` is true). */
function own<K extends string>(table: Readonly<Record<K, unknown>>, key: string): key is K {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

const WEIGHT_NAME: Readonly<Record<number, WeightToken>> = { 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' };

/** The type token behind each SDK `Text size`. */
const SDK_TYPE = Object.fromEntries(
  Object.values(TYPE_SCALE)
    .filter((spec) => spec.sdk !== undefined)
    .map((spec) => [spec.sdk, spec]),
) as Record<SdkTextSize, (typeof TYPE_SCALE)[keyof typeof TYPE_SCALE]>;

// ── Resolvers: the single place a token becomes a value ───────────────────────

export const space = (t: SpaceToken = 'none'): string => (own(SDK_SPACE, t) ? `${SDK_SPACE[t]}px` : '0');

export function radius(t: RadiusToken = 'none'): string {
  if (t === 'full') return `${RADII.full.radius}px`;
  return own(SDK_RADII, t) ? `${SDK_RADII[t]}px` : '0';
}

/** A role's fill form under `theme`: a delivered colour when the theme carries the role, else the
 *  token module's value for the theme's scheme. `primary`/`on-primary` are the tint and the label
 *  on it; the status names are their fills. With Increase Contrast, `text-muted` is `text`. */
export function resolveColor(theme: WhimTheme, t: PaintRole): string {
  const role: string = t === 'text-muted' && theme.increaseContrast ? 'text' : t;
  if (own(theme.colors, role)) return theme.colors[role];
  const system = COLORS[theme.scheme];
  return own(system, role) ? system[role] : theme.colors.text;
}

/** A text colour's readable form under `theme`: the status names resolve to their text forms, the
 *  tint to its own value (it is the text colour too), and an old bundle's value outside the
 *  narrowed set to `LEGACY_TEXT_COLOR`'s choice; anything else is `text`. */
export function resolveTextColor(theme: WhimTheme, t: TextColorToken): string {
  const token: string = own(LEGACY_TEXT_COLOR, t) ? LEGACY_TEXT_COLOR[t] : t;
  if (own(STATUS_TEXT, token)) return resolveColor(theme, STATUS_TEXT[token]);
  if (token === 'text-muted' || token === 'primary') return resolveColor(theme, token);
  return resolveColor(theme, 'text');
}

export interface ResolvedTextSize {
  size: string;
  line: string;
  /** Letter spacing in em, so it scales with the size. */
  tracking: string;
  weight: WeightToken;
}

/** An SDK text size under `theme`: size and line height multiplied by `fontScale`, the size's
 *  tracking and default weight. */
export function resolveTextSize(theme: WhimTheme, t: TextSizeToken): ResolvedTextSize {
  const spec = own(SDK_TYPE, t) ? SDK_TYPE[t] : SDK_TYPE.body;
  return {
    size: px(spec.size * theme.fontScale),
    line: px(spec.lineHeight * theme.fontScale),
    tracking: `${spec.tracking}em`,
    weight: WEIGHT_NAME[spec.weight] ?? 'regular',
  };
}

export const color = (t: PaintRole = 'text'): string => resolveColor(activeTheme(), t);
export const textColor = (t: TextColorToken = 'text'): string => resolveTextColor(activeTheme(), t);
export const textSize = (t: TextSizeToken = 'body'): ResolvedTextSize => resolveTextSize(activeTheme(), t);
export const weight = (t: WeightToken = 'regular'): number => (own(WEIGHT, t) ? WEIGHT[t] : WEIGHT.regular);
