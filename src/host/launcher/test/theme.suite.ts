/**
 * theme Node suite (task 5.3, design sdk-design-system D4/D7). Exercises the theme model
 * (`resolveTheme`/`sanitizeTheme` from the SDK, re-verified against launcher-side consumption)
 * plus the launcher-only pieces: pref persistence (`loadThemePref`/`saveThemePref`) over a
 * `MapKVBackend`, and `shellPalette`'s color-role mapping.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { loadThemePref, saveThemePref, shellPalette, DEFAULT_THEME_PREF } from '../theme';
import { ACCENTS, DEFAULT_THEME, PRESETS, resolveTheme, sanitizeTheme, ThemePref } from '../../../sdk/theme';

export async function runThemeTests(h: Harness): Promise<void> {
  // resolveTheme — every preset resolves its own colors + shape, name is the preset id.
  await h.test('theme resolveTheme: every preset resolves its own colors verbatim', async () => {
    for (const id of Object.keys(PRESETS)) {
      const t = resolveTheme({ preset: id });
      h.eq(t.name, id, `preset ${id}: name is the preset id`);
      h.eq(t.colors, PRESETS[id].colors, `preset ${id}: colors match verbatim`);
      h.eq(t.shape, PRESETS[id].shape, `preset ${id}: shape matches the preset's own`);
      h.ok(t.dark === PRESETS[id].dark, `preset ${id}: dark matches the preset's own`);
    }
  });

  // accent override — swaps exactly primary/on-primary, every other role untouched.
  await h.test('theme resolveTheme: accent override swaps exactly primary/on-primary', async () => {
    for (const accentId of Object.keys(ACCENTS)) {
      const base = resolveTheme({ preset: 'paper' });
      const t = resolveTheme({ preset: 'paper', accent: accentId });
      h.eq(t.colors.primary, ACCENTS[accentId].primary, `accent ${accentId}: primary swapped`);
      h.eq(t.colors['on-primary'], ACCENTS[accentId]['on-primary'], `accent ${accentId}: on-primary swapped`);
      for (const key of Object.keys(base.colors) as (keyof typeof base.colors)[]) {
        if (key === 'primary' || key === 'on-primary') continue;
        h.eq(t.colors[key], base.colors[key], `accent ${accentId}: role ${key} unchanged`);
      }
      h.eq(t.shape, base.shape, `accent ${accentId}: shape unchanged`);
      h.ok(t.dark === base.dark, `accent ${accentId}: dark unchanged`);
    }
  });

  // shape override — changes only shape.
  await h.test('theme resolveTheme: explicit shape overrides the preset default, nothing else', async () => {
    const base = resolveTheme({ preset: 'paper' }); // paper's own shape is 'soft'
    const t = resolveTheme({ preset: 'paper', shape: 'sharp' });
    h.eq(t.shape, 'sharp', 'shape overridden');
    h.eq(t.colors, base.colors, 'colors unchanged by a shape override');
    h.ok(t.dark === base.dark, 'dark unchanged by a shape override');
    h.eq(t.name, base.name, 'name unchanged by a shape override');
  });

  await h.test('theme resolveTheme: unknown preset falls back to paper', async () => {
    const t = resolveTheme({ preset: 'does-not-exist' });
    h.eq(t.name, 'paper', 'unknown preset resolves to paper');
    h.eq(t.colors, PRESETS.paper.colors, 'paper colors used');
  });

  await h.test('theme resolveTheme: unknown accent is ignored (preset colors kept)', async () => {
    const base = resolveTheme({ preset: 'ink' });
    const t = resolveTheme({ preset: 'ink', accent: 'does-not-exist' });
    h.eq(t.colors, base.colors, 'unknown accent has no effect');
  });

  // sanitizeTheme
  await h.test('theme sanitizeTheme: a valid theme passes through unchanged', async () => {
    const valid = resolveTheme({ preset: 'neon', accent: 'teal', shape: 'sharp' });
    h.eq(sanitizeTheme(valid), valid, 'valid theme round-trips through sanitizeTheme');
  });

  await h.test('theme sanitizeTheme: a bad hex color falls back per-field only', async () => {
    const valid = resolveTheme({ preset: 'mono' });
    const tampered = { ...valid, colors: { ...valid.colors, primary: 'not-a-color', danger: '#zzzzzz' } };
    const s = sanitizeTheme(tampered);
    h.eq(s.colors.primary, DEFAULT_THEME.colors.primary, 'bad primary hex falls back to DEFAULT_THEME');
    h.eq(s.colors.danger, DEFAULT_THEME.colors.danger, 'bad danger hex falls back to DEFAULT_THEME');
    h.eq(s.colors.bg, valid.colors.bg, 'untouched valid fields survive');
    h.eq(s.colors.surface, valid.colors.surface, 'untouched valid fields survive');
  });

  await h.test('theme sanitizeTheme: unknown shape falls back to soft', async () => {
    const valid = resolveTheme({ preset: 'sunset' });
    const s = sanitizeTheme({ ...valid, shape: 'triangular' });
    h.eq(s.shape, 'soft', 'unknown shape value falls back to soft');
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
      { description: 'invalid shape, dark, and name values', value: { shape: {}, dark: 'yes', name: 42 } },
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

  // loadThemePref / saveThemePref
  await h.test('theme loadThemePref: virgin backend resolves to the default pref', async () => {
    const kv = new MapKVBackend();
    h.eq(loadThemePref(kv), DEFAULT_THEME_PREF, 'no stored key -> default pref');
  });

  await h.test('theme loadThemePref/saveThemePref: round-trip on MapKVBackend', async () => {
    const kv = new MapKVBackend();
    const pref: ThemePref = { preset: 'neon', accent: 'rose', shape: 'round' };
    saveThemePref(kv, pref);
    h.eq(loadThemePref(kv), pref, 'saved pref reads back verbatim');
  });

  await h.test('theme loadThemePref: survives a restart over the same backing map', async () => {
    const map = new Map<string, string>();
    const pref: ThemePref = { preset: 'meadow', shape: 'soft' };
    saveThemePref(new MapKVBackend(map), pref);
    const reloaded = loadThemePref(new MapKVBackend(map)); // fresh instance, same map
    h.eq(reloaded, pref, 'pref survives a fresh KVBackend over the same map');
  });

  await h.test('theme loadThemePref: corrupted JSON resolves to the default pref', async () => {
    const kv = new MapKVBackend();
    kv.set('whim.theme:v1', '{not valid json');
    h.eq(loadThemePref(kv), DEFAULT_THEME_PREF, 'corrupted JSON -> default pref');
  });

  await h.test('theme loadThemePref: a non-object stored value resolves to the default pref', async () => {
    const kv = new MapKVBackend();
    kv.set('whim.theme:v1', JSON.stringify('just a string'));
    h.eq(loadThemePref(kv), DEFAULT_THEME_PREF, 'non-object JSON -> default pref');
    const kv2 = new MapKVBackend();
    kv2.set('whim.theme:v1', JSON.stringify(42));
    h.eq(loadThemePref(kv2), DEFAULT_THEME_PREF, 'number JSON -> default pref');
  });

  await h.test('theme loadThemePref: unknown preset falls back to paper, valid accent/shape kept', async () => {
    const kv = new MapKVBackend();
    kv.set('whim.theme:v1', JSON.stringify({ preset: 'does-not-exist', accent: 'teal', shape: 'sharp' }));
    h.eq(loadThemePref(kv), { preset: 'paper', accent: 'teal', shape: 'sharp' }, 'preset defaults, other valid fields kept');
  });

  await h.test('theme loadThemePref: bad accent is dropped, good preset kept', async () => {
    const kv = new MapKVBackend();
    kv.set('whim.theme:v1', JSON.stringify({ preset: 'ink', accent: 'not-an-accent' }));
    h.eq(loadThemePref(kv), { preset: 'ink' }, 'unknown accent dropped, preset survives');
  });

  await h.test('theme loadThemePref: bad shape is dropped, good preset + accent kept', async () => {
    const kv = new MapKVBackend();
    kv.set('whim.theme:v1', JSON.stringify({ preset: 'sunset', accent: 'blue', shape: 'triangular' }));
    h.eq(loadThemePref(kv), { preset: 'sunset', accent: 'blue' }, 'unknown shape dropped, rest survives');
  });

  await h.test('theme loadThemePref: wrong-typed fields are dropped, not fatal', async () => {
    const kv = new MapKVBackend();
    kv.set('whim.theme:v1', JSON.stringify({ preset: 42, accent: [], shape: {} }));
    h.eq(loadThemePref(kv), DEFAULT_THEME_PREF, 'non-string fields all fall back / drop cleanly');
  });

  // shellPalette
  await h.test('theme shellPalette: maps every key from the correct color role', async () => {
    const t = resolveTheme({ preset: 'ink' });
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
}
