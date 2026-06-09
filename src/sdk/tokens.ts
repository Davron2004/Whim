// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — design tokens (spec §5.2 / §5.3: components accept TOKENS, not values)
// ─────────────────────────────────────────────────────────────────────────────
// The load-bearing contract this file fixes is "tokens, not values": a mini-app says
// `<Text color="primary">` / `<Stack gap="lg">`, never a hex code or a pixel count. That
// indirection is what keeps the SDK render contract backend-agnostic (#11 / §4.6) — the
// same `gap="lg"` could later be resolved by a native reconciler instead of these CSS
// strings. v0.1 resolves them to CSS (React-to-DOM inside the WebView, hypothesis R1).
//
// These concrete VALUES are deliberately a placeholder, functional palette — NOT the
// finished visual language. The real color ramps / spacing scale / dark mode are a
// deferred SDK design-system change (design D6); only the token *names* (the contract) are
// durable here. Adding a value is cheap; renaming a token is a migration, so the names are
// the part to get right.

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
  | 'danger';
export type TextSizeToken = 'caption' | 'body' | 'subtitle' | 'title' | 'display';
export type WeightToken = 'regular' | 'medium' | 'semibold' | 'bold';

export const SPACE: Record<SpaceToken, string> = {
  none: '0',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '20px',
  xl: '32px',
};

export const RADIUS: Record<RadiusToken, string> = {
  none: '0',
  sm: '6px',
  md: '12px',
  lg: '20px',
  full: '999px',
};

export const COLOR: Record<ColorToken, string> = {
  text: '#0b1020',
  'text-muted': '#5b6472',
  primary: '#4f46e5',
  'on-primary': '#ffffff',
  bg: '#ffffff',
  surface: '#f4f5f7',
  border: '#d8dbe0',
  danger: '#dc2626',
};

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

// Resolvers — the single place a token becomes a value. A native-reconciler backend would
// swap this module for one that maps the same token names to native style primitives.
export const space = (t: SpaceToken = 'none'): string => SPACE[t] ?? SPACE.none;
export const radius = (t: RadiusToken = 'none'): string => RADIUS[t] ?? RADIUS.none;
export const color = (t: ColorToken = 'text'): string => COLOR[t] ?? COLOR.text;
export const weight = (t: WeightToken = 'regular'): number => WEIGHT[t] ?? WEIGHT.regular;
export const textSize = (t: TextSizeToken = 'body') => TEXT_SIZE[t] ?? TEXT_SIZE.body;
