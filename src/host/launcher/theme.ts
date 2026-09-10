/**
 * theme — the launcher shell's named RN colors (v2; docs/design/README.md "Two systems, not
 * one").
 *
 * The shell theme is now fixed (`DEFAULT_THEME` from the SDK) — there is no preset/accent/shape
 * picker left to persist a pref for (that surface is CUT, see `SettingsScreen.tsx`). This module
 * is now only `shellPalette()`: the one place the RN launcher derives its named colors from a
 * `WhimTheme` (D4) — the shell must never grow a second palette of its own hex literals.
 */

import { SHELL_COLORS, type WhimTheme } from '../../sdk/theme';

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

/** `SHELL_COLORS.ink` at `alpha`, e.g. `inkAlpha(0.58)` -> `'rgba(23,23,26,0.58)'` — derived from
 *  the hex literal rather than a hand-typed rgb triple, so a caller that wants ink at some
 *  translucency (the orb's resting fill) can never drift from `ink` itself. */
export function inkAlpha(alpha: number): string {
  const hex = SHELL_COLORS.ink;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
