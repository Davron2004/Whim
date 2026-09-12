/**
 * theme — the launcher shell's named RN colors (v2; docs/design/README.md "Two systems, not
 * one").
 *
 * The shell has one fixed theme, `DEFAULT_THEME` from the SDK, and one derived palette,
 * `SHELL_PALETTE` below — there is no theme parameter anywhere in the launcher, and no second
 * palette of hex literals: every shell color reads from this one constant.
 */

import { DEFAULT_THEME, SHELL_COLORS } from '../../sdk/theme';

/** The launcher shell's named RN colors, the type of `SHELL_PALETTE` below. */
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

/** The shell's one fixed palette, derived once from `DEFAULT_THEME` — never recomputed, never
 *  parameterised by a theme. */
export const SHELL_PALETTE: ShellPalette = Object.freeze({
  bg: DEFAULT_THEME.colors.bg,
  card: DEFAULT_THEME.colors.surface,
  cardBorder: DEFAULT_THEME.colors.border,
  text: DEFAULT_THEME.colors.text,
  textMuted: DEFAULT_THEME.colors['text-muted'],
  accent: DEFAULT_THEME.colors.primary,
  onAccent: DEFAULT_THEME.colors['on-primary'],
  danger: DEFAULT_THEME.colors.danger,
});

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
