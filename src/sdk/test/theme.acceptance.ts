// Node acceptance suite for the v2 theme model (docs/design/README.md "Design tokens" / "Two
// systems, not one"). Auto-discovered by `src/sdk/test/run.mjs` (every `*.acceptance.ts(x)`
// under this directory) — no shared harness import, following the `chart-geometry.acceptance.ts`
// idiom of local `fail`/`equal`/`ok` helpers.
import {
  appColor,
  DEFAULT_THEME,
  sanitizeTheme,
  SHELL_COLORS,
  STATUS_COLORS,
  STATUS_COLORS_ON_INK,
  RADIUS,
  SPACING,
  MOTION,
  TYPE_SCALE,
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

{
  const names = ['Water Counter', 'Tip Splitter', 'Habit Tracker', 'Recipe Box', 'Countdown', 'Budget'];
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
  }
}

// A denser sweep, purely to exercise the hash across many inputs without asserting a fixed
// distribution (only that every result stays a hex colour outside the reserved set).
{
  const reserved = new Set(
    [
      STATUS_COLORS.working,
      STATUS_COLORS.broken,
      STATUS_COLORS.waiting,
      STATUS_COLORS_ON_INK.working,
      STATUS_COLORS_ON_INK.broken,
      SHELL_COLORS.accent,
      SHELL_COLORS.yours,
      SHELL_COLORS.yoursOnDark,
    ].map((hex) => hex.toLowerCase()),
  );
  for (let i = 0; i < 200; i++) {
    const name = `app-${i}`;
    const color = appColor(name);
    ok(!reserved.has(color.toLowerCase()), `appColor(${name}): "${color}" must not be a reserved hue`);
    equal(appColor(name), color, `appColor(${name}): repeat call is stable`);
  }
}

// ── DEFAULT_THEME / sanitizeTheme (v2: one fixed theme, no presets) ────────────

equal(DEFAULT_THEME.colors.bg, SHELL_COLORS.paper, 'DEFAULT_THEME.colors.bg <- SHELL_COLORS.paper');
equal(DEFAULT_THEME.colors.surface, SHELL_COLORS.surface, 'DEFAULT_THEME.colors.surface <- SHELL_COLORS.surface');
equal(DEFAULT_THEME.colors.text, SHELL_COLORS.text, 'DEFAULT_THEME.colors.text <- SHELL_COLORS.text');
equal(DEFAULT_THEME.colors['text-muted'], SHELL_COLORS.muted, 'DEFAULT_THEME.colors[text-muted] <- SHELL_COLORS.muted');
equal(DEFAULT_THEME.colors.border, SHELL_COLORS.border, 'DEFAULT_THEME.colors.border <- SHELL_COLORS.border');
equal(DEFAULT_THEME.colors.primary, SHELL_COLORS.accent, 'DEFAULT_THEME.colors.primary <- SHELL_COLORS.accent');
equal(DEFAULT_THEME.colors.danger, STATUS_COLORS.broken, 'DEFAULT_THEME.colors.danger <- STATUS_COLORS.broken');
equal(DEFAULT_THEME.colors.positive, STATUS_COLORS.working, 'DEFAULT_THEME.colors.positive <- STATUS_COLORS.working');
equal(DEFAULT_THEME.colors.warning, STATUS_COLORS.waiting, 'DEFAULT_THEME.colors.warning <- STATUS_COLORS.waiting');

ok(Object.isFrozen(DEFAULT_THEME), 'DEFAULT_THEME is frozen');
ok(Object.isFrozen(DEFAULT_THEME.colors), 'DEFAULT_THEME.colors is frozen');

for (const bad of [undefined, null, 'a string', 42, [], () => {}, Symbol('x')]) {
  let threw = false;
  try {
    sanitizeTheme(bad);
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

// ── every shell/status hex, pinned literally against docs/design/README.md's tables ─────────────
// (shape-checked above; this is the byte-exact pin the design doc's fidelity note asks for —
// values copied from the design doc, never from the code under test).

equal(SHELL_COLORS.paper, '#fbfaf8', 'SHELL_COLORS.paper');
equal(SHELL_COLORS.surface, '#f1efea', 'SHELL_COLORS.surface');
equal(SHELL_COLORS.border, '#e0dcd4', 'SHELL_COLORS.border');
equal(SHELL_COLORS.ink, '#17171a', 'SHELL_COLORS.ink');
equal(SHELL_COLORS.text, '#1c1917', 'SHELL_COLORS.text');
equal(SHELL_COLORS.muted, '#6b6560', 'SHELL_COLORS.muted');
equal(SHELL_COLORS.faint, '#a8a29a', 'SHELL_COLORS.faint');
equal(SHELL_COLORS.accent, '#3f3d8f', 'SHELL_COLORS.accent');
equal(SHELL_COLORS.yours, '#a15c07', 'SHELL_COLORS.yours');
equal(SHELL_COLORS.yoursOnDark, '#e0a75e', 'SHELL_COLORS.yoursOnDark');

equal(STATUS_COLORS.working, '#0d9488', 'STATUS_COLORS.working');
equal(STATUS_COLORS.done, '#0d9488', 'STATUS_COLORS.done');
equal(STATUS_COLORS.broken, '#b91c1c', 'STATUS_COLORS.broken');
equal(STATUS_COLORS.waiting, '#c9c3b8', 'STATUS_COLORS.waiting');

equal(STATUS_COLORS_ON_INK.working, '#2dd4bf', 'STATUS_COLORS_ON_INK.working');
equal(STATUS_COLORS_ON_INK.done, '#2dd4bf', 'STATUS_COLORS_ON_INK.done');
equal(STATUS_COLORS_ON_INK.broken, '#f87171', 'STATUS_COLORS_ON_INK.broken');
equal(STATUS_COLORS_ON_INK.waiting, '#c9c3b8', 'STATUS_COLORS_ON_INK.waiting');

equal(RADIUS.chip, 999, 'RADIUS.chip');
equal(RADIUS.field, 14, 'RADIUS.field');
equal(RADIUS.card, 18, 'RADIUS.card');
equal(RADIUS.tile, 22, 'RADIUS.tile');
equal(RADIUS.sheet, 28, 'RADIUS.sheet');

equal(SPACING.xs, 8, 'SPACING.xs');
equal(SPACING.sm, 12, 'SPACING.sm');
equal(SPACING.md, 16, 'SPACING.md');
equal(SPACING.lg, 22, 'SPACING.lg');
equal(SPACING.xl, 34, 'SPACING.xl');

equal(MOTION.breathe.durationMs, 1900, 'MOTION.breathe.durationMs');
equal(MOTION.breathe.opacityFrom, 0.34, 'MOTION.breathe.opacityFrom');
equal(MOTION.breathe.opacityTo, 0.72, 'MOTION.breathe.opacityTo');
equal(MOTION.sheetRise.durationMs, 260, 'MOTION.sheetRise.durationMs');
// No wheel geometry exists in this change (review fix-pass, shell-redesign-v2 — `app-launcher`
// negative requirement): `MOTION.orbWheel` is deleted, not just unused, and there is nothing here
// to pin.
equal('orbWheel' in MOTION, false, 'MOTION carries no wheel-geometry entry');

equal(TYPE_SCALE.quote.color, SHELL_COLORS.yours, 'TYPE_SCALE.quote is coloured yours (the only face the doc pins a colour to)');
equal(TYPE_SCALE.quote.fontStyle, 'italic', 'TYPE_SCALE.quote is italic');

console.log('SDK theme (v2) acceptance: PASS');
