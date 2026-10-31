/**
 * App tints by name (`docs/design/system.md` §2.4): resolving a declared name, the id-hash
 * fallback, the host's assignment rules, and the colour maths they rest on (WCAG 2.2 contrast,
 * CIEDE2000 on sRGB → CIELAB D65, the same formulas as `docs/design/system-v1/palette-check.py`).
 * Pure functions over `tokens.ts`; no React Native, DOM or Node import.
 */

import { TINT_NAMES, TINTS, type TintName } from './tokens';

/** Names a model or an old record may use for a tint, and the tint each resolves to. */
export const TINT_ALIASES: Readonly<Record<string, TintName>> = {
  red: 'rose',
  pink: 'orchid',
  magenta: 'orchid',
  grape: 'purple',
  sky: 'blue',
  cyan: 'ocean',
  teal: 'ocean',
  green: 'ocean',
  mint: 'ocean',
  lime: 'ocean',
  navy: 'indigo',
  yellow: 'stone',
  orange: 'stone',
  amber: 'stone',
  brown: 'stone',
  cocoa: 'stone',
  gray: 'slate',
  grey: 'slate',
  graphite: 'slate',
  black: 'slate',
};

export function isTintName(value: unknown): value is TintName {
  return typeof value === 'string' && (TINT_NAMES as readonly string[]).includes(value);
}

/** A stable string hash (djb2), the one `appColor` uses: same id, same number, every run. */
function djb2(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = ((h << 5) + h + (text.codePointAt(i) ?? 0)) >>> 0;
  }
  return h;
}

/** The tint an app gets when it names none the system knows: djb2(app id) mod 10, table order. */
export function fallbackTint(appId: string): TintName {
  return TINT_NAMES[djb2(appId) % TINT_NAMES.length];
}

export interface TintResolution {
  readonly tint: TintName;
  /** Set when the name was not one of the ten (an alias, or unknown); never an error. */
  readonly diagnostic?: string;
}

/** Resolve a declared tint name: one of the ten as is, an alias to its tint, anything else to the
 *  app id's fallback. Case and surrounding space are ignored. */
export function resolveTint(name: unknown, appId: string): TintResolution {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (isTintName(key)) return { tint: key };
  const alias = Object.prototype.hasOwnProperty.call(TINT_ALIASES, key) ? TINT_ALIASES[key] : undefined;
  if (alias !== undefined) return { tint: alias, diagnostic: `tint "${key}" is not one of the ten; using "${alias}"` };
  const tint = fallbackTint(appId);
  return { tint, diagnostic: `unknown tint ${JSON.stringify(name)}; using "${tint}" from the app id` };
}

// ── Colour maths ─────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

/** CIELAB (D65) coordinates. */
export type Lab = readonly [number, number, number];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` or `#rrggbb` as sRGB channels in 0–1, or undefined. */
function channels(hex: string): Rgb | undefined {
  if (!HEX_RE.test(hex)) return undefined;
  const digits = hex.length === 4 ? [...hex.slice(1)].map((d) => d + d).join('') : hex.slice(1);
  const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
  return [byte(0), byte(2), byte(4)];
}

function strictChannels(hex: string): Rgb {
  const rgb = channels(hex);
  if (rgb === undefined) throw new Error(`not a hex colour: ${JSON.stringify(hex)}`);
  return rgb;
}

const linearize = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const [r, g, b] = strictChannels(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio of two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `a` at `weight` over `b` (sRGB channel mix, as CSS `color-mix(in srgb, a w, b)`), as `#RRGGBB`;
 *  mixed per 8-bit channel, ties rounding up (`palette-check.py` mixes the same way). */
export function mixHex(a: string, b: string, weight: number): string {
  const x = strictChannels(a);
  const y = strictChannels(b);
  const byte = (i: number) => {
    const mixed = Math.round(x[i] * 255) * weight + Math.round(y[i] * 255) * (1 - weight);
    return Math.max(0, Math.min(255, Math.floor(mixed + 0.5)));
  };
  return '#' + [0, 1, 2].map((i) => byte(i).toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** A hex colour in CIELAB (D65), via linear sRGB → XYZ. */
export function labFromHex(hex: string): Lab {
  const [r, g, b] = strictChannels(hex).map(linearize);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const hue = (b: number, a: number) => (deg(Math.atan2(b, a)) + 360) % 360;
const pow7 = (c: number) => c ** 7 / (c ** 7 + 25 ** 7);

function hueDifference(h1: number, h2: number, chromaProduct: number): number {
  if (chromaProduct === 0) return 0;
  const d = h2 - h1;
  if (d > 180) return d - 360;
  if (d < -180) return d + 360;
  return d;
}

function meanHue(h1: number, h2: number, chromaProduct: number): number {
  if (chromaProduct === 0) return h1 + h2;
  if (Math.abs(h1 - h2) <= 180) return (h1 + h2) / 2;
  return h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
}

/** CIEDE2000 colour difference (kL = kC = kH = 1). */
export function ciede2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const g = 0.5 * (1 - Math.sqrt(pow7((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1 = Math.hypot(a1p, b1);
  const c2 = Math.hypot(a2p, b2);
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);
  const dh = hueDifference(h1, h2, c1 * c2);
  const dL = l2 - l1;
  const dC = c2 - c1;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2));
  const lMean = (l1 + l2) / 2;
  const cMean = (c1 + c2) / 2;
  const hMean = meanHue(h1, h2, c1 * c2);
  const t =
    1 -
    0.17 * Math.cos(rad(hMean - 30)) +
    0.24 * Math.cos(rad(2 * hMean)) +
    0.32 * Math.cos(rad(3 * hMean + 6)) -
    0.2 * Math.cos(rad(4 * hMean - 63));
  const rotation = -Math.sin(rad(2 * 30 * Math.exp(-(((hMean - 275) / 25) ** 2)))) * 2 * Math.sqrt(pow7(cMean));
  const sL = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
  const sC = 1 + 0.045 * cMean;
  const sH = 1 + 0.015 * cMean * t;
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rotation * (dC / sC) * (dH / sH));
}

/** CIEDE2000 between two hex colours. */
export function deltaE(a: string, b: string): number {
  return ciede2000(labFromHex(a), labFromHex(b));
}

// ── Host assignment ──────────────────────────────────────────────────────────

/** The tint whose light value is nearest `hex` (an installed app's old hex `tileColor`), or
 *  undefined when `hex` is not a hex colour. */
export function nearestTint(hex: string): TintName | undefined {
  if (channels(hex) === undefined) return undefined;
  let best: TintName = TINT_NAMES[0];
  let bestDistance = Infinity;
  for (const name of TINT_NAMES) {
    const d = deltaE(hex, TINTS[name].light);
    if (d < bestDistance) {
      best = name;
      bestDistance = d;
    }
  }
  return best;
}

function tintCounts(used: readonly TintName[]): Map<TintName, number> {
  const counts = new Map<TintName, number>(TINT_NAMES.map((n) => [n, 0]));
  for (const t of used) if (counts.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/**
 * The tint the host gives a new app. `ranked` is the model's choice, best first (up to three);
 * `used` holds the tint of every installed app (repeats count). The first ranked tint no installed
 * app uses wins; else the least used tint of all ten, ties going to the model's order, then table
 * order.
 */
export function assignTint(ranked: readonly TintName[], used: readonly TintName[]): TintName {
  const counts = tintCounts(used);
  const free = ranked.find((t) => counts.get(t) === 0);
  if (free !== undefined) return free;
  const order = [...ranked.filter(isTintName), ...TINT_NAMES.filter((t) => !ranked.includes(t))];
  const least = Math.min(...counts.values());
  return order.find((t) => counts.get(t) === least) ?? TINT_NAMES[0];
}

/** The tint a copy of an app tinted `original` gets: among the least used tints, the one whose
 *  light value is farthest (CIEDE2000) from the original's; ties go to table order. */
export function farthestTint(original: TintName, used: readonly TintName[]): TintName {
  const counts = tintCounts(used);
  const least = Math.min(...counts.values());
  let best: TintName = TINT_NAMES[0];
  let bestDistance = -1;
  for (const name of TINT_NAMES) {
    if (counts.get(name) !== least) continue;
    const d = deltaE(TINTS[original].light, TINTS[name].light);
    if (d > bestDistance) {
      best = name;
      bestDistance = d;
    }
  }
  return best;
}
