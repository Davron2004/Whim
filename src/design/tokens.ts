/**
 * Whim design tokens: every design value of `docs/design/system.md` §2 and §4.2, defined once
 * (decision #75, design-system-v1 D1). Pure data with no React Native, DOM or Node import, so the
 * shell, the SDK (bundled into the runtime) and the build tools read the same values.
 *
 * `npm run tokens` regenerates from this file the token tables in `system.md`, the mockup's token
 * block, the palette proof's input (`docs/design/system-v1/palette.json`), the runtime page's
 * background (`generated/page.mjs`) and the sampled springs (`generated/springs.ts`);
 * `npm run tokens -- --check` (run by the fast gate) fails when any of them drifts. Prose fields
 * (`use`) are the text of those tables.
 */

export type Scheme = 'light' | 'dark';

export const SCHEMES: readonly Scheme[] = ['light', 'dark'];

/** One value per scheme. */
export interface Pair<T = string> {
  readonly light: T;
  readonly dark: T;
}

/** A colour role row: its value per scheme, what it is for, and an optional material note shown
 *  beside the value in the docs (e.g. "+ `shadow-raised`"). */
interface RoleSpec extends Pair {
  readonly use: string;
  readonly material?: Pair;
}

// ── §2.1 Neutrals and roles ──────────────────────────────────────────────────

export const NEUTRAL_ROLES = {
  bg: { light: '#F6F4F1', dark: '#100E0D', use: 'Screen canvas; runtime page, iframe, SDK `Screen`, opening container' },
  surface: { light: '#FFFFFF', dark: '#1B1917', use: 'Cards, list groups, inputs on the canvas' },
  sheet: { light: '#F6F4F1', dark: '#1B1917', use: 'Content sheets (making, Whim sheet, consent, failure, SDK `Modal`)' },
  'sheet-group': { light: '#FFFFFF', dark: '#252220', use: 'Groups, question groups, plan rows, cards inside a sheet' },
  raised: {
    light: '#FFFFFF',
    dark: '#252220',
    use: 'Menus, toasts, popovers, the orb, the composer',
    material: { light: '+ `shadow-raised`', dark: '+ top highlight' },
  },
  fill: { light: '#EBE9E6', dark: '#2E2B28', use: 'Secondary buttons, segmented track, chips' },
  'fill-strong': { light: '#E0DDDA', dark: '#3C3936', use: 'Pressed fills, skeletons, tracks' },
  thumb: {
    light: '#FFFFFF',
    dark: '#3C3936',
    use: 'Segmented thumb, slider thumb, switch knob when off',
    material: { light: '+ `shadow-raised`', dark: '' },
  },
  separator: { light: '#E2DFDB', dark: '#34312F', use: 'Hairlines between rows (holds no edge: 1.21:1)' },
  border: { light: '#908B86', dark: '#6E6862', use: 'Input and outlined-control edges' },
  text: { light: '#1A1614', dark: '#F2F0EC', use: 'Primary text' },
  'text-2': { light: '#6D6660', dark: '#ADA8A3', use: 'Secondary text, placeholders, waiting steps' },
  'text-3': { light: '#908B86', dark: '#78746E', use: '**Disabled only**' },
  ink: { light: '#1A1614', dark: '#F2F0EC', use: "The system's prominent fill" },
  'on-ink': { light: '#FFFFFF', dark: '#1A1614', use: 'Label on `ink`' },
  scrim: { light: 'rgba(26,22,20,0.32)', dark: 'rgba(0,0,0,0.60)', use: 'Behind sheets and menus' },
} as const satisfies Record<string, RoleSpec>;

export type NeutralRole = keyof typeof NEUTRAL_ROLES;

// ── §2.2 Ember ───────────────────────────────────────────────────────────────

export const EMBER_ROLES = {
  ember: { light: '#C14900', dark: '#F99549', use: "Fill of Whim's buttons; the current-step marker and 8 pt dots" },
  'on-ember': { light: '#FFFFFF', dark: '#1A1614', use: 'Label on `ember`' },
  'ember-text': { light: '#B14200', dark: '#F99549', use: 'Text and icons' },
  'ember-soft': { light: '#FDEBDA', dark: '#3F2313', use: 'Washes: a tile being made, picked "Decide for me"' },
} as const satisfies Record<string, RoleSpec>;

export type EmberRole = keyof typeof EMBER_ROLES;

/** The light itself: the same in both schemes. Never carries text, never marks state. `halo` is the
 *  colour of the mark's halo and of `glow-ember`'s outer shadow. */
export const GLOW = {
  core: '#FFC96A',
  mid: '#FF9127',
  edge: '#F25914',
  halo: 'rgba(255,145,39,0.45)',
} as const;

// ── §2.3 Status (reserved hues) ──────────────────────────────────────────────

export const STATUS_NAMES = ['positive', 'danger', 'warning'] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

/** A status hue in its four forms: the fill (marks), the label on that fill, the readable text form,
 *  and the soft wash (badges, notices). `icon` always accompanies it: status hues never stand alone. */
interface StatusSpec {
  readonly fill: Pair;
  readonly on: Pair;
  readonly text: Pair;
  readonly soft: Pair;
  readonly icon: string;
  readonly use: { readonly fill: string; readonly text: string; readonly soft: string };
}

export const STATUS = {
  positive: {
    fill: { light: '#1E8347', dark: '#5BCC80' },
    on: { light: '#FFFFFF', dark: '#1A1614' },
    text: { light: '#1A763F', dark: '#5BCC80' },
    soft: { light: '#DEF6E3', dark: '#193521' },
    icon: 'check',
    use: { fill: 'It worked', text: 'Positive text and icons', soft: 'Positive badge' },
  },
  danger: {
    fill: { light: '#C9292F', dark: '#F66C6D' },
    on: { light: '#FFFFFF', dark: '#1A1614' },
    text: { light: '#C22630', dark: '#F66C6D' },
    soft: { light: '#FFE7E5', dark: '#472020' },
    icon: 'circle-alert',
    use: { fill: 'Status marks only, never a button fill', text: 'Danger buttons, rows and text', soft: 'The danger button’s capsule, danger notices' },
  },
  warning: {
    fill: { light: '#F3BA25', dark: '#ECBD3A' },
    on: { light: '#1A1614', dark: '#1A1614' },
    text: { light: '#8A6000', dark: '#ECBD3A' },
    soft: { light: '#FDF2D0', dark: '#382C0C' },
    icon: 'triangle-alert',
    use: { fill: 'Caution marks', text: 'Warning text and icons', soft: 'Warning badge' },
  },
} as const satisfies Record<StatusName, StatusSpec>;

export type StatusRole = StatusName | `on-${StatusName}` | `${StatusName}-text` | `${StatusName}-soft`;

// ── §2.4 App tints ───────────────────────────────────────────────────────────

/** The ten tints, in table order (the order the id-hash fallback indexes). */
export const TINT_NAMES = ['slate', 'stone', 'ocean', 'blue', 'indigo', 'violet', 'purple', 'orchid', 'berry', 'rose'] as const;
export type TintName = (typeof TINT_NAMES)[number];

/** Light value: fill, text, marks and tile plate in light mode (white label), and the tile plate in
 *  dark mode. Dark value: fill, text and marks in dark mode (ink label). */
export const TINTS: Readonly<Record<TintName, Pair>> = {
  slate: { light: '#535E6F', dark: '#B0B8C5' },
  stone: { light: '#52443F', dark: '#B0A19A' },
  ocean: { light: '#00445A', dark: '#A1CCDC' },
  blue: { light: '#0852CB', dark: '#9DC7FE' },
  indigo: { light: '#1E20A3', dark: '#909DEF' },
  violet: { light: '#6758B4', dark: '#C1BBFC' },
  purple: { light: '#662A8D', dark: '#C290F5' },
  orchid: { light: '#9D469E', dark: '#FD91EC' },
  berry: { light: '#661258', dark: '#E4B1DB' },
  rose: { light: '#7C3856', dark: '#BD98AA' },
};

/** The label, check and knob colour on a tint fill: white in light, ink in dark. */
export const ON_TINT: Pair = { light: '#FFFFFF', dark: '#1A1614' };

/** The tile glyph: white on the light value, in both schemes. */
export const ON_PLATE = '#FFFFFF';

/** Soft tint (badges, selected rows): the scheme's tint value at `alpha` over the role `over`. */
export const TINT_SOFT: Pair<{ readonly alpha: number; readonly over: NeutralRole }> = {
  light: { alpha: 0.12, over: 'surface' },
  dark: { alpha: 0.18, over: 'raised' },
};

/** Dark-mode tile rim: mix(dark value, light value, `TILE_RIM.mix`), `TILE_RIM.width` px inside. */
export const TILE_RIM = { mix: 0.5, width: 1.5 } as const;

// ── Flattened colour roles per scheme ───────────────────────────────────────

export type ColorRole = NeutralRole | EmberRole | StatusRole;

function statusRoles(scheme: Scheme): Record<StatusRole, string> {
  const out = {} as Record<StatusRole, string>;
  for (const name of STATUS_NAMES) {
    const s = STATUS[name];
    out[name] = s.fill[scheme];
    out[`on-${name}`] = s.on[scheme];
    out[`${name}-text`] = s.text[scheme];
    out[`${name}-soft`] = s.soft[scheme];
  }
  return out;
}

function schemeColors(scheme: Scheme): Readonly<Record<ColorRole, string>> {
  const out = {} as Record<ColorRole, string>;
  for (const [role, spec] of Object.entries(NEUTRAL_ROLES)) out[role as NeutralRole] = spec[scheme];
  for (const [role, spec] of Object.entries(EMBER_ROLES)) out[role as EmberRole] = spec[scheme];
  return Object.freeze(Object.assign(out, statusRoles(scheme)));
}

/** Every colour role, resolved for each scheme. */
export const COLORS: Readonly<Record<Scheme, Readonly<Record<ColorRole, string>>>> = {
  light: schemeColors('light'),
  dark: schemeColors('dark'),
};

/** A WCAG 2.2 floor: `fg` on each of `on` reaches `floor`:1 in both schemes. */
export interface ContrastRule {
  readonly fg: ColorRole;
  readonly on: readonly ColorRole[];
  readonly floor: number;
}

const TEXT_SURFACES: readonly ColorRole[] = ['bg', 'surface', 'sheet', 'sheet-group', 'fill'];

/** Every pair §2 specifies a contrast floor for (text 4.5:1, non-text edges 3:1). `text-3` is
 *  disabled-only and exempt. */
export const CONTRAST_RULES: readonly ContrastRule[] = [
  { fg: 'border', on: ['surface'], floor: 3 },
  { fg: 'text', on: TEXT_SURFACES, floor: 4.5 },
  { fg: 'text-2', on: TEXT_SURFACES, floor: 4.5 },
  { fg: 'on-ink', on: ['ink'], floor: 4.5 },
  { fg: 'on-ember', on: ['ember'], floor: 4.5 },
  { fg: 'ember-text', on: ['bg', 'surface', 'fill', 'ember-soft'], floor: 4.5 },
  ...STATUS_NAMES.flatMap((name): ContrastRule[] => [
    { fg: `on-${name}`, on: [name], floor: 4.5 },
    { fg: `${name}-text`, on: [...TEXT_SURFACES, `${name}-soft`], floor: 4.5 },
  ]),
];

/** The §2.4 tint floors, per tint: white on light ≥ `onTint` (light), ink on dark ≥ `onTint`
 *  (dark), the scheme value on that scheme's `fill` and on its soft tint ≥ `text`, and the dark rim
 *  on dark `bg` ≥ `rim` (non-text). */
export const TINT_CONTRAST_FLOORS = { onTint: 4.5, text: 4.5, rim: 3 } as const;

/** The §2.4 separation floors (CIEDE2000, normal vision) the gate holds; the CVD floors are the
 *  palette proof's (`palette-check.py`). */
export const TINT_SEPARATION_FLOORS = { reserved: 20, tint: 10 } as const;

// ── §2.7 Type ────────────────────────────────────────────────────────────────

export type TypeToken = 'display' | 'largeTitle' | 'title1' | 'title2' | 'title3' | 'headline' | 'body' | 'callout' | 'footnote' | 'caption';

/** SDK `Text size` names. */
export type SdkTextSize = 'display' | 'title' | 'subtitle' | 'body' | 'caption';

interface TypeSpec {
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: number;
  /** Section headers in this size take this weight. */
  readonly headerWeight?: number;
  /** Letter spacing in em. */
  readonly tracking: number;
  readonly use: string;
  readonly sdk?: SdkTextSize;
}

export const TYPE_SCALE: Readonly<Record<TypeToken, TypeSpec>> = {
  display: { size: 40, lineHeight: 44, weight: 700, tracking: -0.02, use: 'Hero numbers in apps', sdk: 'display' },
  largeTitle: { size: 34, lineHeight: 40, weight: 700, tracking: -0.016, use: 'Root titles (Your apps, Settings)' },
  title1: { size: 28, lineHeight: 34, weight: 700, tracking: -0.012, use: 'Step headlines, Ready, failure, pushed screens', sdk: 'title' },
  title2: { size: 22, lineHeight: 28, weight: 700, tracking: -0.008, use: 'Sheet titles' },
  title3: { size: 20, lineHeight: 25, weight: 600, tracking: -0.004, use: 'Card titles, questions, the quoted hero', sdk: 'subtitle' },
  headline: { size: 17, lineHeight: 22, weight: 600, tracking: 0, use: 'Buttons, row titles' },
  body: { size: 17, lineHeight: 24, weight: 400, tracking: 0, use: 'Prose, plans, inputs', sdk: 'body' },
  callout: { size: 15, lineHeight: 20, weight: 400, tracking: 0.004, use: 'Secondary lines, helper text' },
  footnote: { size: 13, lineHeight: 18, weight: 400, headerWeight: 600, tracking: 0.008, use: 'Meta, section headers', sdk: 'caption' },
  caption: { size: 12, lineHeight: 16, weight: 500, tracking: 0.012, use: 'Tile names, badges in the shell' },
};

// ── §2.8 Space and layout ────────────────────────────────────────────────────

/** The 4-pt grid: step → pt. */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** The SDK's five space names, on the same grid. */
export const SDK_SPACE = { xs: SPACE[1], sm: SPACE[2], md: SPACE[3], lg: SPACE[5], xl: SPACE[8] } as const;

export const LAYOUT = {
  gutter: 20,
  cardPadding: 16,
  cardPaddingHero: 20,
  listRowMinHeight: 52,
  listRowPaddingVertical: 12,
  listRowPaddingHorizontal: 16,
  separatorInset: 16,
  separatorInsetWithIcon: 52,
  gapInGroup: 12,
  gapBetweenGroups: 24,
  gapBetweenSections: 32,
  gapTitleToSubtitle: 4,
  gapTitleToContent: 20,
  actionAreaTop: 16,
  actionAreaBottom: 12,
  actionAreaBottomNoInset: 20,
  buttonHeight: { large: 52, medium: 44, small: 34 },
  touchTarget: { ios: 44, android: 48 },
  minHitVisual: 36,
  smallTargetGap: 12,
  headerRowHeight: 44,
} as const;

// ── §2.9 Shape ───────────────────────────────────────────────────────────────

export const RADII = {
  xs: { radius: 6, use: 'Badges, small tags, chart bar tops' },
  sm: { radius: 10, use: 'Small controls, checkboxes' },
  md: { radius: 14, use: 'Inputs, menu rows, notices' },
  lg: { radius: 20, use: 'Cards, list groups, context menu' },
  xl: { radius: 28, use: 'Sheet tops' },
  full: { radius: 999, use: 'Buttons, pills, switches, the orb' },
} as const;

/** SDK `radius` names. */
export const SDK_RADII = { sm: RADII.sm.radius, md: RADII.md.radius, lg: RADII.lg.radius } as const;

export const SHAPE = {
  /** Concentric rule: inner radius = outer − inset, never below this. */
  minConcentricRadius: 6,
  /** iOS draws radii at or above this with `borderCurve: 'continuous'`. */
  continuousCurveFrom: 10,
  /** Tile superellipse corner, as a fraction of the side. */
  tileCorner: 0.225,
} as const;

// ── §2.10 Shadows ────────────────────────────────────────────────────────────

/** RN `boxShadow` and CSS `box-shadow` strings. */
export const SHADOWS = {
  'shadow-raised': {
    light: '0 1px 2px rgba(26,22,20,0.08), 0 8px 24px rgba(26,22,20,0.12)',
    dark: '0 1px 2px rgba(0,0,0,0.40), 0 8px 24px rgba(0,0,0,0.50)',
  },
  'shadow-floating': {
    light: '0 2px 6px rgba(26,22,20,0.12), 0 12px 32px rgba(26,22,20,0.16)',
    dark: '0 2px 6px rgba(0,0,0,0.50), 0 12px 32px rgba(0,0,0,0.60)',
  },
  'glow-ember': {
    light: '0 0 0 1px rgba(255,145,39,0.35), 0 6px 28px rgba(255,145,39,0.45)',
    dark: '0 0 0 1px rgba(255,145,39,0.35), 0 6px 28px rgba(255,145,39,0.45)',
  },
} as const satisfies Record<string, Pair>;

/** The 1 px top highlight on raised surfaces (dark only). */
export const TOP_HIGHLIGHT: Pair = { light: 'transparent', dark: 'rgba(255,255,255,0.06)' };

// ── §4.2 Springs and timings ─────────────────────────────────────────────────

export type SpringName = 'instant' | 'snappy' | 'smooth' | 'fling' | 'morph' | 'spark';

/** A spring in Apple's terms (response in seconds, damping ratio ζ) plus the mass-1 physics
 *  constants Reanimated takes: stiffness = (2π/response)², damping = 4π·ζ/response. */
export interface Spring {
  readonly response: number;
  readonly dampingRatio: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly use: string;
}

function spring(response: number, dampingRatio: number, use: string): Spring {
  return {
    response,
    dampingRatio,
    stiffness: ((2 * Math.PI) / response) ** 2,
    damping: (4 * Math.PI * dampingRatio) / response,
    use,
  };
}

export const SPRINGS: Readonly<Record<SpringName, Spring>> = {
  instant: spring(0.12, 1, 'Press-in'),
  snappy: spring(0.28, 1, 'Press-out, toggles, selection, checkmarks'),
  smooth: spring(0.4, 1, 'Push/pop, tapped sheets, step changes, reflow, closing morphs'),
  fling: spring(0.35, 0.8, 'Anything released from a drag, with its velocity'),
  morph: spring(0.5, 0.9, 'Opening container transforms'),
  spark: spring(0.55, 0.55, 'Rare celebrations'),
};

/** Durations in ms. */
export const TIMINGS = {
  fadeIn: 160,
  fadeOut: 120,
  fadeEasing: 'cubic-bezier(0.23, 1, 0.32, 1)',
  color: 150,
  colorEasing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  staggerPerItem: 30,
  staggerFirst: 6,
  breatheCycle: 1900,
  breatheOpacity: { from: 0.34, to: 0.72 },
  breatheDelay: 300,
} as const;
