// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — theme model v2 (docs/design/README.md "Design tokens" / "Two systems, not one").
// ─────────────────────────────────────────────────────────────────────────────
// Pure data + pure functions. NO React import, NO DOM access, NO side effects — this file is
// imported directly by BOTH sides of the sandbox boundary: the mini-app SDK (tokens.ts resolves
// color()/radius() through it) and the RN launcher shell (src/host/launcher/theme.ts derives
// shellPalette() from the same WhimTheme), so the two halves can never grow a second, drifted
// palette (D4 — one source file, two hosts).
//
// v2: the six theme presets, the accent picker, and the shape picker are CUT (design doc "Two
// systems, not one" — "the shell is fixed... not themeable, not configurable, identical on every
// device"). `WhimTheme` is now a single resolved value (`DEFAULT_THEME` below), never a family
// resolved from a `ThemePref`. Zero migration: because the SDK is tokens-not-values (#13), every
// existing mini-app re-renders under these fixed values automatically — no per-app pinning, no
// frozen-palette fallback.
//
// The SDK's own color-role vocabulary (`bg`/`surface`/`text`/`text-muted`/`border`/`primary`/
// `on-primary`/`danger`/`positive`/`warning`) is UNCHANGED so `tokens.ts#color()` and
// `charts.tsx` (sdk-charts spec: "Colors derive from the active theme's existing roles... MUST
// introduce no new color tokens") keep working with no edits — only the VALUES those roles
// resolve to change, mapped onto the v2 shell palette/status hues (`design-tokens.ts`).
//
// D1 (unchanged) — the ONLY untrusted input this module ever touches is
// `globalThis.__WHIM_THEME__`, installed by the loader from the trusted `__whimHostInit` frame
// before a bundle mounts. `sanitizeTheme` IS the trust boundary: it treats that global as
// attacker-controlled (a mini-app shares the iframe realm and can mutate it) and never throws —
// worst case a hostile mutation mis-themes the mutating realm itself, nothing else (constraint #2
// stays untouched; this is inert data, not a capability).

import { SHELL_COLORS, STATUS_COLORS } from './design-tokens';

export interface WhimTheme {
  colors: {
    bg: string;
    surface: string;
    text: string;
    'text-muted': string;
    border: string;
    primary: string;
    'on-primary': string;
    danger: string;
    positive: string;
    warning: string;
  };
}

// Recursively Object.freeze a value tree.
function deepFreeze<T>(value: T): T {
  Object.freeze(value);
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
        deepFreeze(child);
      }
    }
  }
  return value;
}

/** The shell's fixed v2 theme (design doc "Colour — the shell" / "Colour — status"), mapped onto
 *  the SDK's existing role vocabulary: `primary` <- `accent`, `on-primary` <- white (accent is
 *  dark enough to need it), `danger` <- `broken`, `positive` <- `working`/`done`, `warning` <-
 *  `waiting`. Frozen — every consumer lands on this SAME object; there is no other theme to
 *  resolve to. */
export const DEFAULT_THEME: WhimTheme = deepFreeze({
  colors: {
    bg: SHELL_COLORS.paper,
    surface: SHELL_COLORS.surface,
    text: SHELL_COLORS.text,
    'text-muted': SHELL_COLORS.muted,
    border: SHELL_COLORS.border,
    primary: SHELL_COLORS.accent,
    'on-primary': '#ffffff',
    danger: STATUS_COLORS.broken,
    positive: STATUS_COLORS.working,
    warning: STATUS_COLORS.waiting,
  },
});

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = [
  'bg',
  'surface',
  'text',
  'text-muted',
  'border',
  'primary',
  'on-primary',
  'danger',
  'positive',
  'warning',
] as const;

/** The iframe-side trust boundary (D1): `input` is untrusted (an attacker-reachable global read
 *  straight off `globalThis`). Field-by-field — every color must match `/^#[0-9a-f]{6}$/i` else
 *  it falls back to `DEFAULT_THEME`'s value for that field. Never throws, regardless of what
 *  shape `input` takes. */
export function sanitizeTheme(input: unknown): WhimTheme {
  const raw = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rawColors =
    raw.colors !== null && typeof raw.colors === 'object' ? (raw.colors as Record<string, unknown>) : {};

  const colors = {} as WhimTheme['colors'];
  for (const key of COLOR_KEYS) {
    const candidate = rawColors[key];
    colors[key] =
      typeof candidate === 'string' && HEX_COLOR_RE.test(candidate) ? candidate : DEFAULT_THEME.colors[key];
  }

  return { colors };
}

// The shell design tokens (colour, status, radius, spacing, motion, type, `appColor`) live in
// the sibling module below and are re-exported here so every downstream file keeps importing
// from one surface (`../../sdk/theme`), same as before this redesign.
export * from './design-tokens';
