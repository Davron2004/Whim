// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — internal helpers the components share (docs/design/system.md §2.7, §2.8, §6, §7.2)
// ─────────────────────────────────────────────────────────────────────────────
// Not part of the public `vc-sdk` surface: `index.tsx` never re-exports this module. Everything
// here reads the active theme at render time, never at module load.
import * as React from 'react';
import { COLORS, LAYOUT, SHADOWS, TINT_SOFT, TOP_HIGHLIGHT, TYPE_SCALE, type TypeToken } from '../design/tokens';
import { mixHex } from '../design/tints';
import { activeTheme, color, type PaintRole } from './tokens';

/** From this text scale, paired buttons and labelled controls stack (system.md §6). */
export const STACK_FONT_SCALE = 1.35;

/** Whether the active text scale stacks paired buttons and labelled controls. */
export function stacks(): boolean {
  return activeTheme().fontScale >= STACK_FONT_SCALE;
}

/** The platform's touch target in px: 44 on iOS, 48 on Android (system.md §2.8). */
export function touchTarget(): number {
  return LAYOUT.touchTarget[activeTheme().platform];
}

function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

export interface TypeStyle {
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  fontWeight: number;
}

/** A system type token (`headline`, `callout`, `title2`, …, including those with no SDK `Text`
 *  size) as inline style: size and line height times `fontScale`, its tracking and weight. */
export function typeStyle(token: TypeToken, fontWeight?: number): TypeStyle {
  const spec = TYPE_SCALE[token];
  const scale = activeTheme().fontScale;
  return {
    fontSize: px(spec.size * scale),
    lineHeight: px(spec.lineHeight * scale),
    letterSpacing: `${spec.tracking}em`,
    fontWeight: fontWeight ?? spec.weight,
  };
}

/** The soft form of the app's tint (badges, selected rows): its value at 12% over `surface` in
 *  light, at 18% over `raised` in dark (system.md §2.4). */
export function tintSoft(): string {
  const { scheme } = activeTheme();
  const { alpha, over } = TINT_SOFT[scheme];
  return mixHex(color('primary'), COLORS[scheme][over], alpha);
}

/** A raised element's shadow for the active scheme, with the dark scheme's top highlight. */
export function raisedShadow(kind: 'shadow-raised' | 'shadow-floating' = 'shadow-raised'): string {
  const { scheme } = activeTheme();
  return scheme === 'dark' ? `${SHADOWS[kind].dark}, inset 0 1px 0 ${TOP_HIGHLIGHT.dark}` : SHADOWS[kind].light;
}

// ── Inside a Modal ────────────────────────────────────────────────────────────
// Groups, cards and fields paint `sheet-group` inside a `Modal` and `surface` elsewhere (system.md
// §2.5). Created on first use, like the chrome inset context, so nothing calls React at load.
let sheetContext: React.Context<boolean> | undefined;

export function inSheetContext(): React.Context<boolean> {
  sheetContext ??= React.createContext(false);
  return sheetContext;
}

/** The role a group or field paints here: `sheet-group` inside a `Modal`, else `surface`. */
export function useGroupSurface(): PaintRole {
  return React.useContext(inSheetContext()) ? 'sheet-group' : 'surface';
}
