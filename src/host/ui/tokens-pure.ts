/**
 * tokens-pure — the shell's view of the design tokens (docs/design/system.md §2, §4; design-system-v1
 * D2), with no React Native import so the launcher's Node suites can load it. `tokens.ts` adds the
 * one hook (`useTokens`) that feeds the phone's settings into `resolveTokens` here.
 *
 * Every value comes from `src/design/tokens.ts`; this module only selects per scheme and setting,
 * and holds the few component rules system.md states outside the token tables (press scales,
 * reduced forms, the ember's honest light).
 */

import {
  COLORS,
  LAYOUT,
  SHADOWS,
  SPACE,
  SPRINGS,
  TIMINGS,
  TINTS,
  ON_TINT,
  TOP_HIGHLIGHT,
  TYPE_SCALE,
  type ColorRole,
  type Scheme,
  type SpringName,
  type TintName,
  type TypeToken,
} from '../../design/tokens';

export type ShellPlatform = 'ios' | 'android';

/** What the phone says, as `useTokens` reads it. `scheme` is RN's `useColorScheme()` value, so it
 *  may be null or unspecified; `platform` is `Platform.OS`. */
export interface ShellEnvironment {
  scheme: string | null | undefined;
  increaseContrast: boolean;
  reduceMotion: boolean;
  fontScale: number;
  platform: string;
}

/** Everything a shell component styles from, for one combination of the phone's settings. */
export interface ShellTokens {
  /** Identity of this combination; equal keys are the same object. */
  readonly key: string;
  readonly scheme: Scheme;
  /** The token module's roles for `scheme`; under Increase Contrast `text-2` is `text` (§6). */
  readonly colors: Readonly<Record<ColorRole, string>>;
  readonly shadows: { readonly raised: string; readonly floating: string; readonly glow: string };
  /** The 1 px top highlight of raised surfaces ('transparent' in light). */
  readonly topHighlight: string;
  readonly increaseContrast: boolean;
  readonly reduceMotion: boolean;
  readonly fontScale: number;
  /** Text at or past 135%: paired buttons stack, the 128 ember drops to 64 (§6). */
  readonly largeText: boolean;
  readonly platform: ShellPlatform;
  /** The minimum touch target: 44 pt iOS, 48 dp Android (§2.8). */
  readonly touchTarget: number;
  /** Status-bar content that reads on `bg`. */
  readonly barStyle: 'dark-content' | 'light-content';
}

/** §6: "From 135%" the large-text layouts apply. */
export const LARGE_TEXT_FROM = 1.35;

const resolved = new Map<string, ShellTokens>();

/** The tokens for `env`, one frozen object per distinct combination, so a style cache keyed by it
 *  hits across components. An unknown or missing scheme is light; any platform but iOS is Android. */
export function resolveTokens(env: Readonly<ShellEnvironment>): ShellTokens {
  const scheme: Scheme = env.scheme === 'dark' ? 'dark' : 'light';
  const platform: ShellPlatform = env.platform === 'ios' ? 'ios' : 'android';
  const fontScale = Number.isFinite(env.fontScale) && env.fontScale > 0 ? env.fontScale : 1;
  const key = `${scheme}|${env.increaseContrast ? 'hc' : '-'}|${env.reduceMotion ? 'rm' : '-'}|${fontScale}|${platform}`;
  const hit = resolved.get(key);
  if (hit) return hit;
  const base = COLORS[scheme];
  const colors = Object.freeze(env.increaseContrast ? { ...base, 'text-2': base.text } : base);
  const tokens: ShellTokens = Object.freeze({
    key,
    scheme,
    colors,
    shadows: Object.freeze({
      raised: SHADOWS['shadow-raised'][scheme],
      floating: SHADOWS['shadow-floating'][scheme],
      glow: SHADOWS['glow-ember'][scheme],
    }),
    topHighlight: TOP_HIGHLIGHT[scheme],
    increaseContrast: env.increaseContrast,
    reduceMotion: env.reduceMotion,
    fontScale,
    largeText: fontScale >= LARGE_TEXT_FROM,
    platform,
    touchTarget: LAYOUT.touchTarget[platform],
    barStyle: scheme === 'dark' ? 'light-content' : 'dark-content',
  });
  resolved.set(key, tokens);
  return tokens;
}

/** A style builder memoised per token combination: `factory` runs once for each distinct
 *  `ShellTokens` it is called with, and the same object comes back every later time. Call it at
 *  module scope; call the result with `useTokens()` in the component. */
export function makeStyles<T>(factory: (t: ShellTokens) => T): (t: ShellTokens) => T {
  const cache = new Map<string, T>();
  return (t) => {
    let styles = cache.get(t.key);
    if (styles === undefined) {
      styles = factory(t);
      cache.set(t.key, styles);
    }
    return styles;
  };
}

// ── Type ─────────────────────────────────────────────────────────────────────

type FontWeight = '400' | '500' | '600' | '700';

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  /** Tracking in pt: the token's em value × size. */
  letterSpacing: number;
}

/** A type-scale size as an RN text style. `header` takes the size's header weight (footnote 600
 *  for section headers), where it has one. */
export function typeStyle(token: TypeToken, header = false): TypeStyle {
  const spec = TYPE_SCALE[token];
  const weight = header && spec.headerWeight !== undefined ? spec.headerWeight : spec.weight;
  return {
    fontSize: spec.size,
    lineHeight: spec.lineHeight,
    fontWeight: String(weight) as FontWeight,
    letterSpacing: Math.round(spec.tracking * spec.size * 1000) / 1000,
  };
}

/** Tabular figures for counting and ticking numbers (§2.7). */
export const TABULAR = { fontVariant: ['tabular-nums' as const] };

/** §2.7: text scales to 200%. */
export const MAX_FONT_SCALE = 2;

// ── Motion ───────────────────────────────────────────────────────────────────

/** Mass of every token spring: tokens.ts derives stiffness and damping for mass 1 (§4.2), and
 *  Reanimated's own default mass is not 1. */
const SPRING_MASS = 1;

export interface PhysicsSpring {
  mass: number;
  stiffness: number;
  damping: number;
}

/** A named spring as Reanimated physics-mode config (never its duration mode, §4.2). */
export function springConfig(name: SpringName): PhysicsSpring {
  const { stiffness, damping } = SPRINGS[name];
  return { mass: SPRING_MASS, stiffness, damping };
}

/** A spring with the token module's derivation (stiffness = (2π/response)², damping =
 *  4π·ζ/response), for the one smoothing spring system.md §4.6 defines outside the named set. */
function physicsSpring(response: number, dampingRatio: number): PhysicsSpring {
  return { mass: SPRING_MASS, stiffness: ((2 * Math.PI) / response) ** 2, damping: (4 * Math.PI * dampingRatio) / response };
}

/** The four control points of a `cubic-bezier(…)` token string. */
export function bezierOf(easing: string): [number, number, number, number] {
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(easing);
  if (!m) throw new Error(`not a cubic-bezier easing: ${easing}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

export type TimingName = 'fadeIn' | 'fadeOut' | 'color';

/** A token timing: its duration and its curve's control points. */
export function timingOf(name: TimingName): { duration: number; bezier: [number, number, number, number] } {
  if (name === 'color') return { duration: TIMINGS.color, bezier: bezierOf(TIMINGS.colorEasing) };
  return { duration: TIMINGS[name], bezier: bezierOf(TIMINGS.fadeEasing) };
}

export type PressKind = 'button' | 'chip' | 'icon';

/** §4.3 rule 5: the scale a control presses to on touch-down. */
export const PRESS_SCALE: Readonly<Record<PressKind, number>> = { button: 0.97, chip: 0.96, icon: 0.92 };

/** §4.5: under Reduce Motion a press is opacity 0.7 over 100 ms instead of a scale. */
export const REDUCED_PRESS = { opacity: 0.7, duration: 100 } as const;

/** §4.3 rule 5: 10 pt off the control cancels the press. */
export const PRESS_RETENTION = 10;

/** The `hitSlop` that grows a `visual`-pt control to the platform's touch target on each side. */
export function hitSlopFor(visual: number, t: Pick<ShellTokens, 'touchTarget'>): number {
  return Math.max(0, Math.ceil((t.touchTarget - visual) / 2));
}

// ── Colour helpers ───────────────────────────────────────────────────────────

/** `hex` (#RRGGBB) with each channel lowered by `amount` (0–1): §7.1's pressed fill, "filled
 *  variants darken 8%". */
export function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const channel = (at: number) =>
    Math.round(Number.parseInt(m[1].slice(at, at + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`.toUpperCase();
}

/** §7.1 Button: "filled variants darken 8%" when pressed. */
export const PRESSED_DARKEN = 0.08;

/** A tint's fill and the label on it, for the scheme. */
export function tintColors(t: Pick<ShellTokens, 'scheme'>, tint: TintName): { fill: string; on: string } {
  return { fill: TINTS[tint][t.scheme], on: ON_TINT[t.scheme] };
}

// ── Button ───────────────────────────────────────────────────────────────────

export type ButtonVariant = 'ember' | 'ink' | 'tint' | 'secondary' | 'plain' | 'plain-ember' | 'danger';
export type ButtonSize = 'large' | 'medium' | 'small';

export interface ButtonColors {
  /** Background, or 'transparent' for the plain variants. */
  fill: string;
  /** Background while pressed. */
  pressedFill: string;
  label: string;
}

/** §7.1 Button's fill and label per variant, and the disabled look (`fill` + `text-3`, never a
 *  lowered opacity). A `tint` button without a tint name is slate, the default tint. */
export function buttonColors(t: ShellTokens, variant: ButtonVariant, disabled: boolean, tint: TintName = 'slate'): ButtonColors {
  const c = t.colors;
  const plain = variant === 'plain' || variant === 'plain-ember';
  if (disabled) {
    const fill = plain ? 'transparent' : c.fill;
    return { fill, pressedFill: fill, label: c['text-3'] };
  }
  const pair = (fill: string, label: string): ButtonColors => ({ fill, pressedFill: darken(fill, PRESSED_DARKEN), label });
  switch (variant) {
    case 'ember':
      return pair(c.ember, c['on-ember']);
    case 'ink':
      return pair(c.ink, c['on-ink']);
    case 'tint': {
      const { fill, on } = tintColors(t, tint);
      return pair(fill, on);
    }
    case 'secondary':
      return pair(c.fill, c.text);
    case 'danger':
      return pair(c['danger-soft'], c['danger-text']);
    case 'plain':
      return { fill: 'transparent', pressedFill: 'transparent', label: c.text };
    case 'plain-ember':
      return { fill: 'transparent', pressedFill: 'transparent', label: c['ember-text'] };
  }
}

/** §2.8 button heights and the label size: `callout` 600 when small, `headline` otherwise. */
export function buttonMetrics(size: ButtonSize): { height: number; type: TypeToken; paddingHorizontal: number } {
  const height = LAYOUT.buttonHeight[size];
  if (size === 'small') return { height, type: 'callout', paddingHorizontal: SPACE[4] };
  return { height, type: 'headline', paddingHorizontal: size === 'large' ? SPACE[6] : SPACE[5] };
}

// ── Chip ─────────────────────────────────────────────────────────────────────

export type ChipKind = 'choice' | 'decide' | 'suggestion';

/** §7.1 Chip: 36 high, 14 pt side padding, a 16 pt check when selected. */
export const CHIP = { height: 36, paddingHorizontal: 14, check: 16 } as const;

/** §7.1 Chip's fill and label: unselected `fill`/`text`, selected `ink`/`on-ink`; "Decide for me"
 *  keeps `ember-text` and turns `ember-soft` when picked; a suggestion is never selected. */
export function chipColors(t: ShellTokens, kind: ChipKind, selected: boolean): { fill: string; label: string; check: boolean } {
  const c = t.colors;
  const on = selected && kind !== 'suggestion';
  if (kind === 'decide') return { fill: on ? c['ember-soft'] : c.fill, label: c['ember-text'], check: on };
  if (on) return { fill: c.ink, label: c['on-ink'], check: true };
  return { fill: c.fill, label: c.text, check: false };
}

// ── Icon button ──────────────────────────────────────────────────────────────

/** §7.1 Icon button: a 44 × 44 control; `filled` draws a 36 pt `fill` circle. */
export const ICON_BUTTON = { size: 44, filledDisc: 36 } as const;

// ── Notice ───────────────────────────────────────────────────────────────────

export type NoticeTone = 'neutral' | 'danger';

/** §7.1 Notice: `fill` with `info`, or `danger-soft` with `circle-alert`. */
export function noticeLook(t: ShellTokens, tone: NoticeTone): { fill: string; icon: 'info' | 'circle-alert'; iconColor: string } {
  const c = t.colors;
  if (tone === 'danger') return { fill: c['danger-soft'], icon: 'circle-alert', iconColor: c['danger-text'] };
  return { fill: c.fill, icon: 'info', iconColor: c['text-2'] };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/** §4.4 M19 / §4.5: a skeleton waits `breatheDelay`, then breathes between the two opacities over
 *  one `breatheCycle`; under Reduce Motion it sits still at 0.6. */
export const SKELETON = {
  delay: TIMINGS.breatheDelay,
  halfCycle: TIMINGS.breatheCycle / 2,
  from: TIMINGS.breatheOpacity.from,
  to: TIMINGS.breatheOpacity.to,
  reduced: 0.6,
} as const;

// ── Ember ────────────────────────────────────────────────────────────────────

export type EmberState = 'working' | 'stuck' | 'out';
export type EmberSize = 20 | 24 | 48 | 96 | 128;

/** §4.6 Honest light: intensity `0.55 + 0.45·ã`, `ã` smoothed by a critically damped spring of
 *  response 0.6 s; stuck eases to 0.35 over 1.5 s and holds still. */
export const HONEST_LIGHT = { base: 0.55, gain: 0.45, stuck: 0.35, stuckEaseMs: 1500 } as const;

/** The spring `ã` follows (§4.6). */
export const ACTIVITY_SMOOTHING: PhysicsSpring = physicsSpring(0.6, 1);

/** §3.3: the 128 ember drops to 64 from 135% text. */
export function emberSize(size: EmberSize, t: Pick<ShellTokens, 'largeText'>): number {
  return size === 128 && t.largeText ? 64 : size;
}

export const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** The mark's layers for a state at (smoothed) activity `a`: the body's opacity (the intensity),
 *  the halo's, and whether the stuck body sits on a `fill-strong` silhouette. Out draws neither:
 *  only the outline (§3.3). */
export function emberLook(state: EmberState, a: number): { body: number; halo: number; base: boolean } {
  if (state === 'out') return { body: 0, halo: 0, base: false };
  if (state === 'stuck') return { body: HONEST_LIGHT.stuck, halo: 0.12, base: true };
  const s = clamp01(a);
  return { body: HONEST_LIGHT.base + HONEST_LIGHT.gain * s, halo: 0.3 + 0.7 * s, base: false };
}

/** The out state's outline: 1.5 pt at any size, in 48-grid units. */
export function emberOutlineWidth(size: number): number {
  return (1.5 * 48) / size;
}

/** M10: the done flare peaks at 1.18. */
export const SPARK_PEAK = 1.18;

/** The ambient light at activity `a` (the mockup's `ambient`): its gradient is drawn once at full
 *  strength (centre `glow-mid` at 0.40, `glow-core` at 0.16 by 55%), and the layer's opacity carries
 *  the signal, so the centre lands where the mockup puts it: (0.5 + 0.5·a) × (0.14 + 0.26·a). */
export const AMBIENT_STOPS = { centre: 0.4, mid: 0.16 } as const;

export function ambientOpacity(a: number): number {
  const s = clamp01(a);
  return ((0.5 + 0.5 * s) * (0.14 + 0.26 * s)) / AMBIENT_STOPS.centre;
}
