// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — theme model (design sdk-design-system, decisions D1/D2/D3/D4).
// ─────────────────────────────────────────────────────────────────────────────
// Pure data + pure functions. NO React import, NO DOM access, NO side effects — this
// file is imported directly by BOTH sides of the sandbox boundary: the mini-app SDK
// (tokens.ts resolves color()/radius() through it) and the RN launcher shell
// (src/host/launcher/theme.ts derives shellPalette() from the same WhimTheme), so the
// two halves can never grow a second, drifted palette (D4 — one source file, two hosts).
//
// D1 — the ONLY untrusted input this module ever touches is `globalThis.__WHIM_THEME__`,
// installed by the loader from the trusted `__whimHostInit` frame before a bundle mounts.
// `sanitizeTheme` IS the trust boundary: it treats that global as attacker-controlled (a
// mini-app shares the iframe realm and can mutate it) and never throws — worst case a
// hostile mutation mis-themes the mutating realm itself, nothing else (constraint #2 stays
// untouched; this is inert data, not a capability).

export type ThemeShape = 'sharp' | 'soft' | 'round';

export interface WhimTheme {
  name: string; // preset id it was resolved from
  dark: boolean; // drives status-bar style + WebView bg host-side
  shape: ThemeShape;
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

export interface ThemePref {
  preset: string;
  accent?: string;
  shape?: ThemeShape;
}

// Recursively Object.freeze a value tree. Local to this module — every exported constant
// below (PRESETS, ACCENTS, RADIUS_SCALE, DEFAULT_THEME) is deep-frozen so neither side of
// the sandbox boundary can mutate shared theme data in place.
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

interface PresetDefinition {
  dark: boolean;
  shape: ThemeShape;
  colors: WhimTheme['colors'];
}

const DEFAULT_PRESET_ID = 'paper';

// The 6 presets (design "The theme model" table — values copied verbatim).
export const PRESETS: Record<string, PresetDefinition> = deepFreeze({
  paper: {
    dark: false,
    shape: 'soft',
    colors: {
      bg: '#fbfaf8',
      surface: '#f1efea',
      text: '#1c1917',
      'text-muted': '#6b6560',
      border: '#e0dcd4',
      primary: '#4f46e5',
      'on-primary': '#ffffff',
      danger: '#dc2626',
      positive: '#16a34a',
      warning: '#b45309',
    },
  },
  ink: {
    dark: true,
    shape: 'soft',
    colors: {
      bg: '#0b1020',
      surface: '#171d31',
      text: '#e7eaf3',
      'text-muted': '#8a93a8',
      border: '#2a3149',
      primary: '#8ab4ff',
      'on-primary': '#0b1020',
      danger: '#f87171',
      positive: '#4ade80',
      warning: '#fbbf24',
    },
  },
  neon: {
    dark: true,
    shape: 'round',
    colors: {
      bg: '#0a0a0f',
      surface: '#16121f',
      text: '#f2eefc',
      'text-muted': '#9a8fb8',
      border: '#2d2440',
      primary: '#d946ef',
      'on-primary': '#14041a',
      danger: '#fb7185',
      positive: '#34d399',
      warning: '#facc15',
    },
  },
  meadow: {
    dark: false,
    shape: 'soft',
    colors: {
      bg: '#f6faf4',
      surface: '#eaf3e6',
      text: '#1a2416',
      'text-muted': '#5f6f58',
      border: '#d5e3cf',
      primary: '#15803d',
      'on-primary': '#ffffff',
      danger: '#dc2626',
      positive: '#16a34a',
      warning: '#ca8a04',
    },
  },
  sunset: {
    dark: false,
    shape: 'round',
    colors: {
      bg: '#fff8f2',
      surface: '#ffeede',
      text: '#33201a',
      'text-muted': '#8a6f63',
      border: '#f3ddc9',
      primary: '#ea580c',
      'on-primary': '#ffffff',
      danger: '#be123c',
      positive: '#16a34a',
      warning: '#b45309',
    },
  },
  mono: {
    dark: false,
    shape: 'sharp',
    colors: {
      bg: '#ffffff',
      surface: '#f5f5f5',
      text: '#111111',
      'text-muted': '#666666',
      border: '#e2e2e2',
      primary: '#111111',
      'on-primary': '#ffffff',
      danger: '#dc2626',
      positive: '#16a34a',
      warning: '#b45309',
    },
  },
});

// The 10 curated accent pairs (design "Accent pairs" table) — contrast is guaranteed by
// curation, not runtime math (D3). An accent override swaps exactly `primary`/`on-primary`
// on the resolved preset; every other role stays the preset's.
export const ACCENTS: Record<string, { primary: string; 'on-primary': string }> = deepFreeze({
  indigo: { primary: '#4f46e5', 'on-primary': '#ffffff' },
  blue: { primary: '#2563eb', 'on-primary': '#ffffff' },
  sky: { primary: '#0284c7', 'on-primary': '#ffffff' },
  teal: { primary: '#0d9488', 'on-primary': '#ffffff' },
  green: { primary: '#16a34a', 'on-primary': '#ffffff' },
  amber: { primary: '#b45309', 'on-primary': '#ffffff' },
  rose: { primary: '#e11d48', 'on-primary': '#ffffff' },
  fuchsia: { primary: '#c026d3', 'on-primary': '#ffffff' },
  violet: { primary: '#7c3aed', 'on-primary': '#ffffff' },
  slate: { primary: '#334155', 'on-primary': '#ffffff' },
});

interface ShapeRadiusScale {
  none: string;
  sm: string;
  md: string;
  lg: string;
  full: string;
}

// Shape → radius px scale (design "Shape → radius scales" table). `tokens.ts#radius()`
// maps a RadiusToken through the ACTIVE theme's shape via this table.
export const RADIUS_SCALE: Record<ThemeShape, ShapeRadiusScale> = deepFreeze({
  sharp: { none: '0', sm: '2px', md: '4px', lg: '8px', full: '12px' },
  soft: { none: '0', sm: '6px', md: '12px', lg: '20px', full: '999px' },
  round: { none: '0', sm: '10px', md: '16px', lg: '26px', full: '999px' },
});

/** Pure: unknown preset id → `paper`; unknown accent id → ignored; an explicit `shape`
 *  overrides the resolved preset's own shape. */
export function resolveTheme(pref: ThemePref): WhimTheme {
  const presetId = Object.hasOwn(PRESETS, pref.preset)
    ? pref.preset
    : DEFAULT_PRESET_ID;
  const preset = PRESETS[presetId];
  const shape: ThemeShape = pref.shape && RADIUS_SCALE[pref.shape] ? pref.shape : preset.shape;
  const accent = pref.accent ? ACCENTS[pref.accent] : undefined;
  return {
    name: presetId,
    dark: preset.dark,
    shape,
    colors: accent
      ? { ...preset.colors, primary: accent.primary, 'on-primary': accent['on-primary'] }
      : { ...preset.colors },
  };
}

/** `resolveTheme({preset: 'paper'})`, frozen — the hard fallback every consumer lands on
 *  when a theme is absent or fails to sanitize. */
export const DEFAULT_THEME: WhimTheme = deepFreeze(resolveTheme({ preset: DEFAULT_PRESET_ID }));

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

/** The iframe-side trust boundary (D1): `input` is untrusted (an attacker-reachable global
 *  read straight off `globalThis`). Field-by-field — every color must match
 *  `/^#[0-9a-f]{6}$/i` else it falls back to `DEFAULT_THEME`'s value for that field;
 *  `shape` must be one of the three enum values else `'soft'`; `dark` is coerced with `!!`.
 *  Never throws, regardless of what shape `input` takes. */
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

  const shape: ThemeShape =
    raw.shape === 'sharp' || raw.shape === 'soft' || raw.shape === 'round' ? raw.shape : 'soft';
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : DEFAULT_THEME.name;

  return {
    name,
    dark: !!raw.dark,
    shape,
    colors,
  };
}
