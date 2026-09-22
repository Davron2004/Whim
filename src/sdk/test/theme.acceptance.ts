// Node acceptance suite for the v2 theme model (docs/design/README.md "Design tokens" / "Two
// systems, not one"). Auto-discovered by `src/sdk/test/run.mjs` (every `*.acceptance.ts(x)`
// under this directory) — no shared harness import, following the `chart-geometry.acceptance.ts`
// idiom of local `fail`/`equal`/`ok` helpers.
import fs from 'node:fs';
import path from 'node:path';
import {
  appColor,
  DEFAULT_THEME,
  sanitizeTheme,
  SHELL_COLORS,
  STATUS_COLORS,
  STATUS_COLORS_ON_INK,
  TYPE_SCALE,
  FONT_FAMILY,
} from '../theme';

function fail(message: string): never {
  throw new Error(message);
}

function describe(value: unknown): string {
  return JSON.stringify(value);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) fail(`${message} (expected ${describe(expected)}, received ${describe(actual)})`);
}

function ok(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

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

// ── DEFAULT_THEME / sanitizeTheme (v2: one fixed theme, no presets) ────────────

ok(Object.isFrozen(DEFAULT_THEME), 'DEFAULT_THEME is frozen');
ok(Object.isFrozen(DEFAULT_THEME.colors), 'DEFAULT_THEME.colors is frozen');

for (const bad of [undefined, null, 'a string', 42, [], () => {}, Symbol('x')]) {
  let threw = false;
  try {
    sanitizeTheme(bad);
  // eslint-disable-next-line no-restricted-syntax -- intentional: this test asserts sanitizeTheme never throws, so the catch only flips `threw` for the assertion below
  } catch {
    threw = true;
  }
  ok(!threw, `sanitizeTheme must not throw on ${describe(String(bad))}`);
}

{
  const s = sanitizeTheme(undefined);
  equal(JSON.stringify(s), JSON.stringify(DEFAULT_THEME), 'sanitizeTheme(undefined) -> DEFAULT_THEME');
}

{
  const tampered = { colors: { ...DEFAULT_THEME.colors, primary: 'not-a-color', danger: '#zzzzzz' } };
  const s = sanitizeTheme(tampered);
  equal(s.colors.primary, DEFAULT_THEME.colors.primary, 'bad primary hex falls back to DEFAULT_THEME');
  equal(s.colors.danger, DEFAULT_THEME.colors.danger, 'bad danger hex falls back to DEFAULT_THEME');
  equal(s.colors.bg, DEFAULT_THEME.colors.bg, 'untouched valid fields survive');
}

{
  const valid = { colors: { ...DEFAULT_THEME.colors, primary: '#123456' } };
  const s = sanitizeTheme(valid);
  equal(s.colors.primary, '#123456', 'a valid hex round-trips through sanitizeTheme');
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

// Every font name must correspond to a .ttf that ACTUALLY EXISTS ON DISK. RN/Android resolves
// `fontFamily` by exact file base name, so naming a weight variant that was never bundled falls
// back to the system font SILENTLY — no crash, no warning, wrong render on device. Checking
// `TYPE_SCALE` against `FONT_FAMILY` alone would not catch it: both live in one module, so adding
// a bogus `monoSemiBold: 'IBMPlexMono-SemiBold'` entry and pointing a face at it would still pass.
// Hence this reads `assets/fonts/` and checks BOTH tables against the directory listing.
// (Reading repo files from a suite is an established idiom here — see
// `src/host/launcher/test/history-logic.suite.ts`, which reads a `.tsx` as source.)
{
  // The suite is bundled to a temp file before it runs, so no source path survives — derive the
  // repo root by walking up for the `package.json` that owns `assets/fonts/`, rather than trusting
  // the CWD. A miss throws instead of quietly checking an empty set.
  function findRepoRoot(from: string): string {
    let dir = from; // `process.cwd()` is always absolute, so no resolve step is needed.
    for (;;) {
      if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'assets', 'fonts'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) fail(`could not locate the repo root (no ancestor of "${from}" holds package.json + assets/fonts)`);
      dir = parent;
    }
  }

  const fontsDir = path.join(findRepoRoot(process.cwd()), 'assets', 'fonts');
  const onDisk = new Set(
    fs
      .readdirSync(fontsDir)
      .filter((name) => name.toLowerCase().endsWith('.ttf'))
      .map((name) => name.slice(0, -'.ttf'.length)),
  );
  ok(onDisk.size > 0, `assets/fonts/ holds no .ttf files — the shipped-font check would be vacuous (${fontsDir})`);

  for (const [key, family] of Object.entries(FONT_FAMILY)) {
    ok(onDisk.has(family), `FONT_FAMILY.${key} = "${family}" has no ${family}.ttf in assets/fonts/ (on disk: ${describe([...onDisk])})`);
  }
  for (const [role, face] of Object.entries(TYPE_SCALE)) {
    ok(
      onDisk.has(face.fontFamily),
      `TYPE_SCALE.${role}.fontFamily "${face.fontFamily}" has no ${face.fontFamily}.ttf in assets/fonts/ (on disk: ${describe([...onDisk])})`,
    );
  }
}

console.log('SDK theme (v2) acceptance: PASS');
