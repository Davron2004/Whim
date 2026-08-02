/**
 * tiles — derived tile visuals for the home grid (launcher-shell / #5 D6). A monogram + a
 * deterministic color per app, derived from its name via the SDK's `appColor` (placement pin:
 * the grid, the tile fallback, and the Whim Syntax prose renderer's `app` spans all import this
 * one symbol, so a tile and every prose mention of that app always agree) — no icon assets, no
 * SDK Icon set yet (#3 may upgrade this later; cosmetic, non-contractual). Pure functions so
 * they are trivially unit-checkable.
 */

import { appColor } from '../../sdk/theme';

/** A deterministic tile color for an app name — delegates to the SDK's single `appColor`. */
export function tileColor(name: string): string {
  return appColor(name);
}

/**
 * The monogram for an app: the first letter of each of the first two whitespace-separated
 * words, uppercased ("Water Counter" → "WC"; "tip-splitter" → "T"). Falls back to "?".
 */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
