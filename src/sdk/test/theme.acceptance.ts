// Node acceptance suite for the theme a mini-app renders under (docs/design/system.md §2.5, §7.2;
// sdk-design-system "The host-supplied theme is inert, sanitized data", "Components resolve semantic
// tokens through the active theme") and for the v2 shell tokens `theme.ts` still re-exports.
// Auto-discovered by `src/sdk/test/run.mjs` (every `*.acceptance.ts(x)` under this directory).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import {
  appColor,
  DEFAULT_THEME,
  sanitizeTheme,
  SHELL_COLORS,
  STATUS_COLORS,
  STATUS_COLORS_ON_INK,
  TYPE_SCALE,
  type WhimTheme,
} from '../theme';
import {
  resolveColor,
  resolveTextColor,
  resolveTextSize,
  space,
  radius,
  type RadiusToken,
  type SpaceToken,
  type TextColorToken,
  type TextSizeToken,
} from '../tokens';
import { Text } from '../index';
import { COLORS, ON_TINT, TINT_NAMES, TINTS } from '../../design/tokens';

// The theme the loader installs from the host's init frame. Set before anything renders: the SDK
// reads it once, at its first resolution.
const DELIVERED = {
  colors: { ...COLORS.dark, primary: '#123456' },
  scheme: 'dark',
  tint: 'purple',
  fontScale: 1.5,
  reduceMotion: true,
  increaseContrast: false,
  platform: 'ios',
  chromeInsetBottom: 84,
};
(globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__ = DELIVERED;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function describe(value: unknown): string {
  return JSON.stringify(value);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert.deepStrictEqual(actual, expected, message);
}

function ok(condition: boolean, message: string): void {
  assert.ok(condition, message);
}

function fail(message: string): never {
  throw new Error(message);
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

// The suite is bundled to a temp file before it runs, so no source path survives — derive the repo
// root by walking up for the `package.json` that owns `marker`, rather than trusting the CWD. A miss
// throws instead of quietly checking an empty set.
function findRepoRoot(from: string, marker: string): string {
  let dir = from; // `process.cwd()` is always absolute, so no resolve step is needed.
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) fail(`could not locate the repo root (no ancestor of "${from}" holds package.json + ${marker})`);
    dir = parent;
  }
}

const SYSTEM_MD_PATH = path.join('docs', 'design', 'system.md');
const SYSTEM_MD = fs.readFileSync(path.join(findRepoRoot(process.cwd(), SYSTEM_MD_PATH), SYSTEM_MD_PATH), 'utf8').split('\n');

// ── appColor ─────────────────────────────────────────────────────────────────

equal(appColor('Water Counter'), appColor('Water Counter'), 'appColor: same name -> same colour');
equal(appColor(''), appColor(''), 'appColor: empty-string name is still deterministic');

// One sweep over the named apps plus a denser hash exercise (purely to cover many inputs, never
// asserting a fixed distribution): every result is a hex colour, deterministic on repeat, and
// outside the FULL reserved set (a merge of the two sweeps this replaces — the second one's own
// reserved set had silently dropped STATUS_COLORS.done).
{
  const names = [
    'Water Counter', 'Tip Splitter', 'Habit Tracker', 'Recipe Box', 'Countdown', 'Budget',
    ...Array.from({ length: 200 }, (_, i) => `app-${i}`),
  ];
  const reserved = new Set(
    [
      STATUS_COLORS.working,
      STATUS_COLORS.done,
      STATUS_COLORS.broken,
      STATUS_COLORS.waiting,
      STATUS_COLORS_ON_INK.working,
      STATUS_COLORS_ON_INK.broken,
      SHELL_COLORS.accent,
      SHELL_COLORS.yours,
      SHELL_COLORS.yoursOnDark,
    ].map((hex) => hex.toLowerCase()),
  );
  for (const name of names) {
    const color = appColor(name);
    ok(HEX_RE.test(color), `appColor(${name}): result "${color}" is a hex colour`);
    ok(!reserved.has(color.toLowerCase()), `appColor(${name}): result "${color}" must not be a reserved hue`);
    equal(appColor(name), color, `appColor(${name}): repeat call is stable`);
  }
}

// ── sanitizeTheme: every field validated, every invalid one defaulted ─────────

equal(
  { scheme: DEFAULT_THEME.scheme, tint: DEFAULT_THEME.tint, fontScale: DEFAULT_THEME.fontScale },
  { scheme: 'light', tint: 'slate', fontScale: 1 },
  'the built-in theme is the light scheme with the slate tint at text scale 1',
);
equal(
  [DEFAULT_THEME.reduceMotion, DEFAULT_THEME.increaseContrast, DEFAULT_THEME.platform],
  [false, false, 'android'],
  'the built-in theme has motion and normal contrast on Android',
);
ok(Object.isFrozen(DEFAULT_THEME) && Object.isFrozen(DEFAULT_THEME.colors), 'DEFAULT_THEME and its colours are frozen');
equal(sanitizeTheme(undefined), DEFAULT_THEME, 'no theme at all sanitizes to DEFAULT_THEME');

// The default colours are the token module's light roles under their SDK names, and the tint.
{
  const c = DEFAULT_THEME.colors;
  const light = COLORS.light;
  equal(
    [c.bg, c.surface, c.sheet, c['sheet-group'], c.thumb, c.text, c['text-muted'], c.border],
    [light.bg, light.surface, light.sheet, light['sheet-group'], light.thumb, light.text, light['text-2'], light.border],
    'neutral roles default to the light token values (text-muted is text-2)',
  );
  equal([c.danger, c.positive, c.warning], [light.danger, light.positive, light.warning], 'status roles default to the light fills');
  equal([c.primary, c['on-primary']], [TINTS.slate.light, ON_TINT.light], 'primary is the slate tint, on-primary its label');
}

for (const bad of [undefined, null, 'a string', 42, [], () => {}, Symbol('x'), { colors: 'x', scheme: {}, tint: 7 }]) {
  let threw = false;
  try {
    sanitizeTheme(bad);
  // eslint-disable-next-line no-restricted-syntax -- intentional: this test asserts sanitizeTheme never throws, so the catch only flips `threw` for the assertion below
  } catch {
    threw = true;
  }
  ok(!threw, `sanitizeTheme must not throw on ${describe(String(bad))}`);
}

// The spec's malformed theme: a non-hex colour, an unknown scheme and tint, an out-of-range scale.
{
  const s = sanitizeTheme({ colors: { bg: 'red' }, scheme: 'sepia', tint: 'chartreuse', fontScale: 9 });
  equal([s.colors.bg, s.scheme, s.tint, s.fontScale], [COLORS.light.bg, 'light', 'slate', 2], 'each bad field takes its default; the scale clamps to 2');
}

for (const [given, want] of [
  [0.5, 0.85],
  [0.85, 0.85],
  [1.35, 1.35],
  [2.5, 2],
  [Number.NaN, 1],
  [Number.POSITIVE_INFINITY, 1],
  ['1.5', 1],
  [undefined, 1],
] as const) {
  equal(sanitizeTheme({ fontScale: given }).fontScale, want, `fontScale ${String(given)} sanitizes to ${want}`);
}

{
  const flags = sanitizeTheme({ reduceMotion: 'true', increaseContrast: 1, platform: 'web' });
  equal([flags.reduceMotion, flags.increaseContrast, flags.platform], [false, false, 'android'], 'non-boolean flags are false, an unknown platform is android');
  const set = sanitizeTheme({ reduceMotion: true, increaseContrast: true, platform: 'ios' });
  equal([set.reduceMotion, set.increaseContrast, set.platform], [true, true, 'ios'], 'valid flags and platform pass through');
}

// A dark theme with a tint: every missing colour is the DARK value, the tint is the dark tint.
for (const tint of TINT_NAMES) {
  const s = sanitizeTheme({ scheme: 'dark', tint });
  equal(s.colors.primary, TINTS[tint].dark, `${tint} in dark: primary is the tint's dark value`);
  equal(s.colors['on-primary'], ON_TINT.dark, `${tint} in dark: on-primary is ink`);
  equal([s.colors.bg, s.colors['sheet-group']], [COLORS.dark.bg, COLORS.dark['sheet-group']], `${tint} in dark: missing roles take the dark values`);
}

// Delivered colours win for the roles the frame carries; the tint, not a delivered colour, decides
// primary; nothing outside the theme's own fields survives.
{
  const s = sanitizeTheme(DELIVERED);
  equal(s.colors.sheet, COLORS.dark.sheet, 'a delivered valid colour is used');
  equal(s.colors.primary, TINTS.purple.dark, 'a delivered primary does not override the tint');
  equal(
    Object.keys(s).sort((a, b) => a.localeCompare(b)),
    ['colors', 'fontScale', 'increaseContrast', 'platform', 'reduceMotion', 'scheme', 'tint'],
    'the sanitized theme holds exactly its own fields (no chromeInsetBottom)',
  );
  const custom = sanitizeTheme({ colors: { bg: '#2A1B3C', surface: '#12345' } });
  equal([custom.colors.bg, custom.colors.surface], ['#2A1B3C', COLORS.light.surface], 'a valid hex is kept, a malformed one defaults');
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

function themed(input: Record<string, unknown>): WhimTheme {
  return sanitizeTheme(input);
}

{
  const dark = themed({ scheme: 'dark', tint: 'blue' });
  const light = themed({ scheme: 'light', tint: 'blue' });
  equal(resolveTextColor(dark, 'primary'), TINTS.blue.dark, 'primary text in dark is the tint\'s dark value');
  equal(resolveTextColor(light, 'primary'), TINTS.blue.light, 'primary text in light is the tint\'s light value');
  equal(resolveColor(dark, 'on-primary'), ON_TINT.dark, 'the label on the tint fill is ink in dark');
  for (const status of ['positive', 'danger', 'warning'] as const) {
    for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
      equal(resolveColor(theme, status), COLORS[name][status], `${status} paints its fill in ${name}`);
      equal(resolveTextColor(theme, status), COLORS[name][`${status}-text`], `${status} text is its text form in ${name}`);
    }
  }
  ok(resolveTextColor(light, 'danger') !== resolveColor(light, 'danger'), 'danger text and danger fill are different forms in light');
  equal(resolveColor(dark, 'fill'), COLORS.dark.fill, 'a system role with no SDK name resolves for the scheme');
  equal(resolveColor(light, 'danger-soft'), COLORS.light['danger-soft'], 'status soft forms resolve for the scheme');
}

{
  const normal = themed({});
  const contrast = themed({ increaseContrast: true });
  equal(resolveTextColor(normal, 'text-muted'), COLORS.light['text-2'], 'text-muted is text-2 normally');
  equal(resolveTextColor(contrast, 'text-muted'), COLORS.light.text, 'Increase Contrast maps text-muted to text');
  equal(resolveColor(contrast, 'text-muted'), COLORS.light.text, 'the fill resolver honours it too');
}

// An installed bundle's Text colour outside the narrowed set still renders readably.
{
  const theme = themed({ scheme: 'dark' });
  for (const [legacy, want] of [
    ['on-primary', COLORS.dark.text],
    ['bg', COLORS.dark.text],
    ['surface', COLORS.dark.text],
    ['border', COLORS.dark['text-2']],
    ['constructor', COLORS.dark.text],
  ] as const) {
    equal(resolveTextColor(theme, legacy as unknown as TextColorToken), want, `an old Text color="${legacy}" renders readable`);
  }
}

// SDK text sizes follow system.md §7.2's Text row, scaled by fontScale; tracking is em.
{
  const row = SYSTEM_MD.find((l) => l.startsWith('| `Text` |'));
  ok(row !== undefined, 'system.md §7.2 has a Text row');
  const sizes = [...row!.matchAll(/`(caption|body|subtitle|title|display)` (\d+)\/(\d+)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])] as const);
  equal(sizes.length, 5, `system.md's Text row names five sizes (got ${describe(sizes)})`);
  const base = themed({});
  const scaled = themed({ fontScale: 1.5 });
  for (const [token, size, line] of sizes) {
    const t = resolveTextSize(base, token as TextSizeToken);
    equal([t.size, t.line], [`${size}px`, `${line}px`], `Text size ${token} is ${size}/${line} at scale 1`);
    const big = resolveTextSize(scaled, token as TextSizeToken);
    equal([big.size, big.line, big.tracking], [`${size * 1.5}px`, `${line * 1.5}px`, t.tracking], `Text size ${token} scales by fontScale, tracking stays em`);
    ok(/^-?\d+(?:\.\d+)?em$/.test(t.tracking), `Text size ${token} tracks in em (${t.tracking})`);
  }
}

// Space names sit on the grid where system.md §2.8's space table puts them; radii are §2.9's.
{
  const cells = (label: string): string[] =>
    (SYSTEM_MD.find((l) => l.startsWith(`| ${label} |`)) ?? fail(`system.md has no "${label}" row in its space table`))
      .split('|')
      .slice(2, -1)
      .map((c) => c.trim().replaceAll('`', ''));
  const pts = cells('pt');
  const names = cells('SDK');
  const documented = names.flatMap((name, i) => (name ? [[name, `${pts[i]}px`] as const] : []));
  equal(documented.map(([name]) => name), ['xs', 'sm', 'md', 'lg', 'xl'], 'system.md places the five SDK space names');
  for (const [name, want] of documented) equal(space(name as SpaceToken), want, `space("${name}") is system.md's ${want}`);

  const radii = SYSTEM_MD.join('\n').match(/SDK `sm`\/`md`\/`lg` radii become (\d+)\/(\d+)\/(\d+)/);
  ok(radii !== null, 'system.md §2.9 states the SDK radii');
  equal(['sm', 'md', 'lg'].map((t) => radius(t as RadiusToken)), radii!.slice(1).map((n) => `${n}px`), 'SDK radii are system.md\'s');
  equal([space('none'), radius('none')], ['0', '0'], 'none is 0');
  equal([space('constructor' as SpaceToken), radius('toString' as RadiusToken)], ['0', '0'], 'an unknown name is 0, never a prototype member');
}

// ── The delivered theme reaches rendered components, once ─────────────────────

async function renderedTextStyle(element: React.ReactElement): Promise<Record<string, unknown>> {
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(element);
  });
  const span = renderer!.root.find((node: ReactTestInstance) => node.type === 'span');
  const style = span.props.style as Record<string, unknown>;
  await act(async () => renderer!.unmount());
  return style;
}

{
  const style = await renderedTextStyle(React.createElement(Text, { color: 'primary', size: 'body' }, 'tinted'));
  equal(style.color, TINTS.purple.dark, 'a delivered dark purple theme renders Text color="primary" in purple\'s dark value');
  equal(style.fontSize, '25.5px', 'the delivered fontScale 1.5 scales body (17px) text');

  // The SDK read the theme once: replacing the global after mount changes nothing.
  (globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__ = { ...DELIVERED, scheme: 'light', tint: 'rose' };
  const again = await renderedTextStyle(React.createElement(Text, { color: 'primary' }, 'tinted'));
  equal(again.color, TINTS.purple.dark, 'a theme global replaced after mount is never re-read');
}

// ── shell tokens exist and are hex/well-formed (v2 exactness) ──────────────────

for (const [key, value] of Object.entries(SHELL_COLORS)) {
  ok(HEX_RE.test(value), `SHELL_COLORS.${key} = "${value}" is a hex colour`);
}
for (const [key, value] of Object.entries(STATUS_COLORS)) {
  ok(HEX_RE.test(value), `STATUS_COLORS.${key} = "${value}" is a hex colour`);
}
for (const [key, value] of Object.entries(STATUS_COLORS_ON_INK)) {
  ok(HEX_RE.test(value), `STATUS_COLORS_ON_INK.${key} = "${value}" is a hex colour`);
}

// ── standing invariants on the type-role vocabulary ───────────────────────────
// These pin the SHAPE of the scale, never the mockups' numbers: `kindBadge`/`metaPlain`/
// `metaWide`/`body` sizes are still under review (findings.md rulings R4/R5, decided in the
// on-device screenshot pass), so asserting their pixel values here would fight that pass.

// R2: the history screen's four mono microcopy roles are four DISTINCT design faces. They were
// once collapsed onto a single over-weighted, over-spaced `eyebrow`; nothing but this assertion
// stops that from recurring the next time someone "tidies" near-identical entries together.
{
  const microcopy = ['eyebrow', 'kindBadge', 'metaPlain', 'metaWide'] as const;
  const signatures = new Set(
    microcopy.map((role) => {
      const face = TYPE_SCALE[role];
      return [face.fontSize, face.letterSpacing, face.textTransform ?? 'none', face.fontWeight ?? 'none'].join('/');
    }),
  );
  equal(
    signatures.size,
    microcopy.length,
    `the mono microcopy roles must stay distinguishable faces (${microcopy.join(', ')} collapsed to ${describe([...signatures])})`,
  );
}

console.log('SDK theme acceptance: PASS');
