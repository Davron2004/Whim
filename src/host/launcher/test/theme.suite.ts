/**
 * theme Node suite (v2; docs/design/README.md "Two systems, not one"). The theme preset/accent/
 * shape model and its persisted `ThemePref` are CUT — the shell theme is now a single fixed
 * `DEFAULT_THEME`. This suite now exercises only what's left: `shellPalette()`'s color-role
 * mapping against that fixed theme, and (as a launcher-side cross-check) the SDK's
 * `sanitizeTheme`/`appColor` behavior it depends on.
 */

import { Harness } from './harness';
import { shellPalette } from '../theme';
import { appColor, DEFAULT_THEME, sanitizeTheme } from '../../../sdk/theme';

export async function runThemeTests(h: Harness): Promise<void> {
  // shellPalette — maps every key from the correct color role, against the one fixed theme.
  await h.test('theme shellPalette: maps every key from the correct color role', async () => {
    const t = DEFAULT_THEME;
    const p = shellPalette(t);
    h.eq(p.bg, t.colors.bg, 'bg <- colors.bg');
    h.eq(p.card, t.colors.surface, 'card <- colors.surface');
    h.eq(p.cardBorder, t.colors.border, 'cardBorder <- colors.border');
    h.eq(p.text, t.colors.text, 'text <- colors.text');
    h.eq(p.textMuted, t.colors['text-muted'], 'textMuted <- colors[text-muted]');
    h.eq(p.accent, t.colors.primary, 'accent <- colors.primary');
    h.eq(p.onAccent, t.colors['on-primary'], 'onAccent <- colors[on-primary]');
    h.eq(p.danger, t.colors.danger, 'danger <- colors.danger');
  });

  await h.test('theme shellPalette: is a pure function of its input (no hidden preset state)', async () => {
    const a = shellPalette(DEFAULT_THEME);
    const b = shellPalette(DEFAULT_THEME);
    h.eq(a, b, 'two calls against the same theme produce the same palette');
  });

  // sanitizeTheme — the mini-app-side trust boundary, now theme-shape-free.
  await h.test('theme sanitizeTheme: a valid theme round-trips unchanged', async () => {
    h.eq(sanitizeTheme(DEFAULT_THEME), DEFAULT_THEME, 'valid theme round-trips through sanitizeTheme');
  });

  await h.test('theme sanitizeTheme: a bad hex color falls back per-field only', async () => {
    const tampered = { colors: { ...DEFAULT_THEME.colors, primary: 'not-a-color', danger: '#zzzzzz' } };
    const s = sanitizeTheme(tampered);
    h.eq(s.colors.primary, DEFAULT_THEME.colors.primary, 'bad primary hex falls back to DEFAULT_THEME');
    h.eq(s.colors.danger, DEFAULT_THEME.colors.danger, 'bad danger hex falls back to DEFAULT_THEME');
    h.eq(s.colors.bg, DEFAULT_THEME.colors.bg, 'untouched valid fields survive');
    h.eq(s.colors.surface, DEFAULT_THEME.colors.surface, 'untouched valid fields survive');
  });

  await h.test('theme sanitizeTheme: non-object input yields the DEFAULT_THEME shape', async () => {
    h.eq(sanitizeTheme(undefined), DEFAULT_THEME, 'undefined -> DEFAULT_THEME');
    h.eq(sanitizeTheme(null), DEFAULT_THEME, 'null -> DEFAULT_THEME');
    h.eq(sanitizeTheme('a string'), DEFAULT_THEME, 'string -> DEFAULT_THEME');
  });

  await h.test('theme sanitizeTheme: never throws on garbage input', async () => {
    const garbage: Array<{ description: string; value: unknown }> = [
      { description: 'a number', value: 42 },
      { description: 'an empty array', value: [] },
      { description: 'a numeric array', value: [1, 2, 3] },
      { description: 'a non-object colors value', value: { colors: 'nope' } },
      { description: 'a null colors value', value: { colors: null } },
      { description: 'invalid nested color values', value: { colors: { primary: 123, bg: {} } } },
      { description: 'a nested object containing a function', value: { deep: { junk: { goes: { here: [1, { x: () => {} }] } } } } },
      { description: 'a function', value: () => {} },
      { description: 'a symbol', value: Symbol('x') },
    ];
    for (const { description, value } of garbage) {
      let threw = false;
      try {
        sanitizeTheme(value);
      } catch {
        threw = true;
      }
      h.ok(!threw, `sanitizeTheme must not throw on ${description}`);
    }
  });

  // appColor — the launcher's grid/tile fallback is the direct consumer (tiles.ts#tileColor).
  await h.test('theme appColor: same name always resolves to the same colour', async () => {
    h.eq(appColor('Water Counter'), appColor('Water Counter'), 'stable across repeated calls');
    h.eq(appColor(''), appColor(''), 'stable even for an empty name');
  });

  await h.test('theme appColor: different names can resolve to different colours', async () => {
    const names = ['Water Counter', 'Tip Splitter', 'Habit Tracker', 'Recipe Box', 'Countdown', 'Budget', 'Timer'];
    const colours = new Set(names.map(appColor));
    h.ok(colours.size > 1, 'a spread of app names does not all collapse to one colour');
  });
}
