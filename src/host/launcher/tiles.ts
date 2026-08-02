/**
 * tiles — derived tile visuals for the home grid (launcher-shell / #5 D6, shell-redesign-v2
 * chain-F). A monogram + a deterministic color per app, derived from its name via the SDK's
 * `appColor` (placement pin: the grid, the history header, and the Whim Syntax prose renderer's
 * `app` spans all import this one symbol, so a tile and every prose mention of that app always
 * agree) — no icon assets, no SDK Icon set yet (#3 may upgrade this later; cosmetic,
 * non-contractual). Pure functions so they are trivially unit-checkable.
 */

import { appColor, SHELL_COLORS, STATUS_COLORS, STATUS_COLORS_ON_INK } from '../../sdk/theme';
import type { AppManifest } from '../bridge/contract';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** The reserved shell hues a declared tile colour may never claim (app-launcher "A tile's colour
 *  is the app's declared colour, with a deterministic fallback"; sdk-design-system "An app
 *  declares its one tile colour"). Built from the same exported tokens `appColor`'s own palette
 *  excludes — no second reserved-hue list, just a validity gate over those values. */
const RESERVED_TILE_HUES: ReadonlySet<string> = new Set(
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

/**
 * The one path every surface resolves an app's tile colour through (app-launcher: "Every surface
 * that shows an app's colour ... SHALL resolve it through this one path"). `manifest` is the
 * host-held record's manifest — never anything the running bundle reports about itself — read for
 * its declared `tileColor`. The declared colour wins when it is present, a valid `#rrggbb` hex,
 * and not a reserved status/shell hue; otherwise this falls back to `appColor(name)`, the single
 * deterministic name->hue mapping. `manifest` is optional so existing call sites that only have a
 * name (a pre-declaration app, or a preview with no record yet) keep working unchanged.
 */
export function tileColor(name: string, manifest?: Pick<AppManifest, 'tileColor'>): string {
  const declared = manifest?.tileColor;
  if (declared && HEX_COLOR_RE.test(declared) && !RESERVED_TILE_HUES.has(declared.toLowerCase())) {
    return declared;
  }
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
