// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — the theme a mini-app renders under (docs/design/system.md §2.5, design-system-v1 D3).
// ─────────────────────────────────────────────────────────────────────────────
// Pure data + pure functions. NO React import, NO DOM access, NO side effects.
//
// The host delivers the theme as inert data on the existing init frame (#45): the resolved colour
// roles, the phone's scheme, the app's tint, its text scale, Reduce Motion, Increase Contrast and
// the platform. The values come from the one token module (`src/design/tokens.ts`), so the shell
// and the apps never grow two palettes. SDK role names are unchanged, so every installed bundle
// re-themes by token resolution alone (#13): no per-app palette, no migration.
//
// The ONLY untrusted input this module touches is `globalThis.__WHIM_THEME__`, installed by the
// loader from the trusted `__whimHostInit` frame before a bundle mounts. `sanitizeTheme` IS the
// trust boundary: it treats that global as attacker-controlled (a mini-app shares the iframe realm
// and can mutate it) and never throws — worst case a hostile mutation mis-themes the mutating realm
// itself, nothing else. This is inert data, not a capability.

import { COLORS, ON_TINT, TINT_NAMES, TINTS, type Scheme, type TintName } from '../design/tokens';

/** The colour roles the theme carries, by SDK name. `text-muted` is the system's `text-2`;
 *  `primary`/`on-primary` are the app's tint and the label on it. */
export interface WhimThemeColors {
  bg: string;
  surface: string;
  sheet: string;
  'sheet-group': string;
  thumb: string;
  text: string;
  'text-muted': string;
  border: string;
  primary: string;
  'on-primary': string;
  danger: string;
  positive: string;
  warning: string;
}

export interface WhimTheme {
  colors: WhimThemeColors;
  scheme: Scheme;
  tint: TintName;
  /** The phone's text size as a multiplier, 0.85–2.0. */
  fontScale: number;
  reduceMotion: boolean;
  increaseContrast: boolean;
  platform: 'ios' | 'android';
}

/** The text-scale range the SDK honours (system.md §2.5, §6: text scales to 200%). */
export const FONT_SCALE_RANGE = { min: 0.85, max: 2 } as const;

/** The roles whose value is the tint's, never a delivered colour: one name decides them. */
type TintRole = 'primary' | 'on-primary';
type DeliveredRole = Exclude<keyof WhimThemeColors, TintRole>;

/** Where each delivered SDK role reads its default in the token module. */
const ROLE_SOURCE: Readonly<Record<DeliveredRole, keyof (typeof COLORS)['light']>> = {
  bg: 'bg',
  surface: 'surface',
  sheet: 'sheet',
  'sheet-group': 'sheet-group',
  thumb: 'thumb',
  text: 'text',
  'text-muted': 'text-2',
  border: 'border',
  danger: 'danger',
  positive: 'positive',
  warning: 'warning',
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function fontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(FONT_SCALE_RANGE.max, Math.max(FONT_SCALE_RANGE.min, value));
}

/** The iframe-side trust boundary: `input` is untrusted (an attacker-reachable global read straight
 *  off `globalThis`). Field by field, every invalid or missing value takes its default: `light`,
 *  `slate`, 1, false, false, `android`, and each colour the token module's value for the sanitized
 *  scheme. `primary` and `on-primary` always come from `tint` and `scheme`. Only the fields above
 *  survive (the loader's `chromeInsetBottom` never does). Never throws. */
export function sanitizeTheme(input: unknown): WhimTheme {
  const raw = record(input);
  const rawColors = record(raw.colors);
  const scheme = oneOf<Scheme>(raw.scheme, ['light', 'dark'], 'light');
  const tint = oneOf<TintName>(raw.tint, TINT_NAMES, 'slate');
  const defaults = COLORS[scheme];

  const colors = { primary: TINTS[tint][scheme], 'on-primary': ON_TINT[scheme] } as WhimThemeColors;
  for (const [role, source] of Object.entries(ROLE_SOURCE) as [DeliveredRole, keyof typeof defaults][]) {
    const candidate = rawColors[role];
    colors[role] = typeof candidate === 'string' && HEX_COLOR_RE.test(candidate) ? candidate : defaults[source];
  }

  return {
    colors,
    scheme,
    tint,
    fontScale: fontScale(raw.fontScale),
    reduceMotion: flag(raw.reduceMotion),
    increaseContrast: flag(raw.increaseContrast),
    platform: oneOf(raw.platform, ['ios', 'android'], 'android'),
  };
}

function frozen(theme: WhimTheme): WhimTheme {
  Object.freeze(theme.colors);
  return Object.freeze(theme);
}

/** The built-in theme: the token module's light scheme with the `slate` tint, used whenever no
 *  theme (or an invalid one) is delivered. Frozen. */
export const DEFAULT_THEME: WhimTheme = frozen(sanitizeTheme(undefined));

// The shell design tokens (colour, status, radius, spacing, motion, type, `appColor`) live in
// the sibling module below and are re-exported here so every downstream file keeps importing
// from one surface (`../../sdk/theme`), same as before this redesign.
export * from './design-tokens';
