/**
 * theme — the launcher shell's named RN colors (v2; the v2 handoff README (removed by decision #75; in git history) "Two systems, not
 * one").
 *
 * The shell keeps its v2 palette, `SHELL_PALETTE` below, until it moves to `src/design/tokens.ts`
 * (design-system-v1): the values are pinned here, not derived from the SDK's `DEFAULT_THEME`,
 * which now resolves from the token module. There is no theme parameter anywhere in the
 * launcher: every shell color reads from this one constant.
 */

import { SHELL_COLORS, STATUS_COLORS } from '../../sdk/theme';

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

/** The shell's one fixed v2 palette — never recomputed, never parameterised by a theme. */
export const SHELL_PALETTE: ShellPalette = Object.freeze({
  bg: SHELL_COLORS.paper,
  card: SHELL_COLORS.surface,
  cardBorder: SHELL_COLORS.border,
  text: SHELL_COLORS.text,
  textMuted: SHELL_COLORS.muted,
  accent: SHELL_COLORS.accent,
  onAccent: '#ffffff',
  danger: STATUS_COLORS.broken,
});

/** A `#rrggbb` colour at `alpha`, as `rgba()`. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** `SHELL_COLORS.ink` at `alpha`, e.g. `inkAlpha(0.58)` -> `'rgba(23,23,26,0.58)'` — derived from
 *  the hex literal rather than a hand-typed rgb triple, so a caller that wants ink at some
 *  translucency (the orb's resting fill) can never drift from `ink` itself. */
export function inkAlpha(alpha: number): string {
  return withAlpha(SHELL_COLORS.ink, alpha);
}

/** A primary action's fill and edge. Takeable, it is the accent edge to edge (design README
 *  "Colour — the shell": accent is for primary actions; the mockup's CTAs, `Whim Mobile.dc.html:428`
 *  and `:527`, carry no border): a control that keeps a border for its disabled look wears it in the
 *  fill's own colour, so no ring shows. Not takeable, it is a card-coloured surface outlined by the
 *  hairline. */
export function primaryButtonColors(enabled: boolean): { backgroundColor: string; borderColor: string } {
  return enabled
    ? { backgroundColor: SHELL_PALETTE.accent, borderColor: SHELL_PALETTE.accent }
    : { backgroundColor: SHELL_PALETTE.card, borderColor: SHELL_PALETTE.cardBorder };
}

/** Selected text's highlight where the platform paints it in exactly the colour it is given (an
 *  Android field): the accent at 30%, so the text under it stays readable — the solid accent put
 *  it at about 2:1. `whim_accent_highlight` in `android/app/src/main/res/values/colors.xml` is the
 *  same colour, for the text Android selects under the app's theme. */
export const SELECTION_HIGHLIGHT = withAlpha(SHELL_PALETTE.accent, 0.3);
