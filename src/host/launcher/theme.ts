/**
 * theme — launcher-shell theme state (design sdk-design-system, D4/D7).
 *
 * `ThemePref` persists as JSON under a fixed key (`whim.theme:v1`) in the same `whim.launcher`
 * KVBackend as `AppIndex` (app-index.ts's `SEED_KEY` precedent) — tolerant read, so a corrupted
 * or hand-edited value can never crash the launcher: absent key, invalid JSON, wrong field
 * types, or unknown preset/accent ids all resolve to a safe pref rather than throwing. Unknown
 * `accent`/`shape` are dropped individually (the rest of the pref survives); an unknown
 * `preset` falls back to `'paper'` (the pref's only always-required field).
 *
 * `shellPalette()` is the one place the RN launcher derives its named colors from a resolved
 * `WhimTheme` (D4) — the shell must never grow a second palette of its own hex literals.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import { ACCENTS, PRESETS, ThemePref, ThemeShape, WhimTheme } from '../../sdk/theme';

const THEME_KEY = 'whim.theme:v1';
const SHAPES: ReadonlySet<string> = new Set<ThemeShape>(['sharp', 'soft', 'round']);

/** The pref every consumer lands on when nothing usable is stored. */
export const DEFAULT_THEME_PREF: ThemePref = { preset: 'paper' };

/** Field-by-field sanitization of an arbitrary parsed value into a safe `ThemePref`. Never
 *  throws. `preset` falls back to `'paper'` when missing/unknown; `accent`/`shape` are simply
 *  omitted when missing/unknown rather than forcing the whole pref back to default. */
function sanitizePref(input: unknown): ThemePref {
  const raw = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const preset =
    typeof raw.preset === 'string' && Object.hasOwn(PRESETS, raw.preset)
      ? raw.preset
      : DEFAULT_THEME_PREF.preset;

  const pref: ThemePref = { preset };

  if (typeof raw.accent === 'string' && Object.hasOwn(ACCENTS, raw.accent)) {
    pref.accent = raw.accent;
  }
  if (typeof raw.shape === 'string' && SHAPES.has(raw.shape)) {
    pref.shape = raw.shape as ThemeShape;
  }

  return pref;
}

/** Read the persisted theme pref. Tolerant: an absent key, invalid JSON, a non-object value,
 *  or unknown preset/accent/shape ids all resolve to a safe pref — never throws. */
export function loadThemePref(kv: KVBackend): ThemePref {
  const raw = kv.getString(THEME_KEY);
  if (!raw) return { ...DEFAULT_THEME_PREF };
  try {
    return sanitizePref(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_THEME_PREF };
  }
}

/** Persist a theme pref as JSON under the fixed key. */
export function saveThemePref(kv: KVBackend, pref: ThemePref): void {
  kv.set(THEME_KEY, JSON.stringify(pref));
}

/** The launcher shell's named RN colors, derived from a resolved `WhimTheme` (D4) — the shell
 *  never grows its own second palette. */
export interface ShellPalette {
  bg: string;
  card: string;
  cardBorder: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
}

export function shellPalette(theme: WhimTheme): ShellPalette {
  return {
    bg: theme.colors.bg,
    card: theme.colors.surface,
    cardBorder: theme.colors.border,
    text: theme.colors.text,
    textMuted: theme.colors['text-muted'],
    accent: theme.colors.primary,
    onAccent: theme.colors['on-primary'],
    danger: theme.colors.danger,
  };
}
