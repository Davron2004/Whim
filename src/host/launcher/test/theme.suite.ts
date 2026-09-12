/**
 * theme Node suite (v2; docs/design/README.md "Two systems, not one"). The theme preset/accent/
 * shape model and its persisted `ThemePref` are CUT — the shell theme is one fixed `DEFAULT_THEME`
 * and one derived constant, `SHELL_PALETTE`. This suite exercises `SHELL_PALETTE`'s color-role
 * mapping against `DEFAULT_THEME`, (as a launcher-side cross-check) the SDK's
 * `sanitizeTheme`/`appColor` behavior it depends on, and a tripwire that the launcher never grows
 * a theme parameter back.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { inkAlpha, SHELL_PALETTE } from '../theme';
import { appColor, DEFAULT_THEME, sanitizeTheme } from '../../../sdk/theme';

/** Every file under `src/`, recursively — no exclusions: `invariants/` (the owner-authored
 *  negative-control fixtures) lives OUTSIDE `src/`, so there is nothing to carve out here. */
function everySourceFile(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...everySourceFile(full));
    else files.push(full);
  }
  return files;
}

// The one file this check itself must name the retired values in, to look for them — excluded
// from its own scan by path (never by content), the same way `invariants/`'s negative control is
// exempted by living outside `src/` rather than by pattern.
const SELF = path.join(process.cwd(), 'src/host/launcher/test/theme.suite.ts');

const LAUNCHER_ROOT = path.join(process.cwd(), 'src/host/launcher');
const THEME_TS = path.join(LAUNCHER_ROOT, 'theme.ts');

/** Every `.ts`/`.tsx` file directly under the launcher, excluding `test/` (suites are allowed to
 *  name the retired shapes in order to assert their absence). */
function everyLauncherSourceFile(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue;
      files.push(...everyLauncherSourceFile(path.join(dir, entry.name)));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

export async function runThemeTests(h: Harness): Promise<void> {
  // ── the retired indigo and the retired face are gone from source (sdk-design-system
  // "The retired indigo is gone from source" / "Three faces carry the whole type system") ──────
  await h.test('theme: `#4f46e5` and `Space Grotesk` appear nowhere under src/', async () => {
    const root = path.join(process.cwd(), 'src');
    let hexHits = 0;
    let fontHits = 0;
    for (const file of everySourceFile(root)) {
      if (file === SELF) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (/#4f46e5/i.test(text)) hexHits++;
      if (text.includes('Space Grotesk')) fontHits++;
    }
    h.eq(hexHits, 0, 'the retired framework-default indigo #4f46e5 must not be reintroduced under src/');
    h.eq(fontHits, 0, 'the retired face Space Grotesk must not be reintroduced under src/');
  });

  // SHELL_PALETTE — maps every key from the correct color role, against the one fixed theme.
  await h.test('theme SHELL_PALETTE: maps every key from the correct color role', async () => {
    const t = DEFAULT_THEME;
    const p = SHELL_PALETTE;
    h.eq(p.bg, t.colors.bg, 'bg <- colors.bg');
    h.eq(p.card, t.colors.surface, 'card <- colors.surface');
    h.eq(p.cardBorder, t.colors.border, 'cardBorder <- colors.border');
    h.eq(p.text, t.colors.text, 'text <- colors.text');
    h.eq(p.textMuted, t.colors['text-muted'], 'textMuted <- colors[text-muted]');
    h.eq(p.accent, t.colors.primary, 'accent <- colors.primary');
    h.eq(p.onAccent, t.colors['on-primary'], 'onAccent <- colors[on-primary]');
    h.eq(p.danger, t.colors.danger, 'danger <- colors.danger');
  });

  // inkAlpha — SHELL_COLORS.ink derived to an rgba string, so a caller never hand-types its digits.
  await h.test('theme inkAlpha: derives SHELL_COLORS.ink’s rgba at the given alpha', async () => {
    h.eq(inkAlpha(0.58), 'rgba(23,23,26,0.58)', 'ink (#17171a) at 0.58 alpha');
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
        // eslint-disable-next-line no-restricted-syntax -- intentional: the assertion IS "did it throw" for each garbage input; the thrown value is deliberately discarded and h.ok below reports the outcome
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

  // ── fixed-theme tripwire: the launcher never re-grows a theme parameter ─────
  // `ShellPalette` is only reachable by importing it from `./theme` — so instead of pattern-
  // matching the many syntactic positions a type can appear in (`as ShellPalette`,
  // `Readonly<ShellPalette>`, `Pick<ShellPalette, ...>`, a bare type import, ...), the rule is the
  // bare word `\bShellPalette\b` anywhere outside `theme.ts` itself. Inside `theme.ts`, the two
  // occurrences the module needs (the interface declaration and the constant's own annotation) are
  // stripped by exact text before the same bare-word rule applies to what's left — so `theme.ts`
  // cannot grow a second, palette-typed parameter either.
  const THEME_TS_ALLOWED_SNIPPETS = [
    'export interface ShellPalette {',
    'export const SHELL_PALETTE: ShellPalette = Object.freeze({',
  ];

  await h.test(
    'theme: launcher source never names ShellPalette outside theme.ts, a theme context/hook/pref, shellPalette(), or a theme picker',
    async () => {
      const patterns: Array<{ re: RegExp; label: string }> = [
        { re: /theme picker/i, label: 'mentions a theme picker' },
        { re: /\buseTheme\b/, label: 'references useTheme' },
        { re: /ThemeProvider/, label: 'references ThemeProvider' },
        { re: /ThemePref/, label: 'references ThemePref' },
        { re: /shellPalette\(/, label: 'calls the retired shellPalette() function' },
      ];

      const scanned = everyLauncherSourceFile(LAUNCHER_ROOT);
      // Non-vacuity: the walk itself must actually be walking the launcher, not silently
      // returning an empty or truncated list.
      h.ok(scanned.length > 10, `theme tripwire walk found only ${scanned.length} file(s) under src/host/launcher — the walk is misconfigured`);
      h.ok(scanned.includes(path.join(LAUNCHER_ROOT, 'LauncherRoot.tsx')), 'theme tripwire walk must include LauncherRoot.tsx');
      h.ok(scanned.includes(path.join(LAUNCHER_ROOT, 'HomeScreen.tsx')), 'theme tripwire walk must include HomeScreen.tsx');

      for (const file of scanned) {
        const text = fs.readFileSync(file, 'utf8');
        const rel = path.relative(process.cwd(), file);
        for (const { re, label } of patterns) {
          h.ok(!re.test(text), `${rel} ${label} — the shell theme is fixed by spec, a palette is never passed in`);
        }
        if (file === THEME_TS) {
          let stripped = text;
          for (const snippet of THEME_TS_ALLOWED_SNIPPETS) {
            h.ok(stripped.includes(snippet), `theme.ts is missing its expected "${snippet}" — this allowlist has drifted from the source`);
            stripped = stripped.replace(snippet, '');
          }
          h.ok(
            !/\bShellPalette\b/.test(stripped),
            'theme.ts names ShellPalette somewhere beyond its own interface declaration and the SHELL_PALETTE annotation — it must never grow a second palette-typed parameter',
          );
        } else {
          h.ok(
            !/\bShellPalette\b/.test(text),
            `${rel} names ShellPalette — the type is only reachable by importing it from ./theme, and nothing outside theme.ts may read one in; use SHELL_PALETTE directly instead`,
          );
        }
      }

      // Non-vacuity: every scan fires on the shape it is meant to catch.
      h.ok(/theme picker/i.test('a future theme picker'), 'the theme-picker scan matches its phrase');
      h.ok(/\buseTheme\b/.test('const { theme } = useTheme();'), 'the useTheme scan matches a call');
      h.ok(/ThemeProvider/.test('<ThemeProvider>'), 'the ThemeProvider scan matches a tag');
      h.ok(/ThemePref/.test('type ThemePref ='), 'the ThemePref scan matches a type name');
      h.ok(/shellPalette\(/.test('shellPalette(theme)'), 'the shellPalette() scan matches a call');
      h.ok(/\bShellPalette\b/.test('const q = {} as ShellPalette;'), 'the bare-word scan matches an `as` cast');
      h.ok(/\bShellPalette\b/.test('Readonly<ShellPalette>'), 'the bare-word scan matches a generic type argument');
      h.ok(/\bShellPalette\b/.test("import type { ShellPalette } from './theme';"), 'the bare-word scan matches a type-only import');
    },
  );
}
