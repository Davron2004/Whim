/**
 * tiles — derived tile visuals for the home grid (launcher-shell / #5 D6). A monogram + a
 * deterministic color per app, derived from its name — no icon assets, no SDK Icon set yet
 * (#3 may upgrade this later; cosmetic, non-contractual). Pure functions (no RN imports) so
 * they are trivially unit-checkable.
 */

/** A small, legible palette (dark-surface friendly). Index chosen deterministically by name. */
export const TILE_COLORS = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
];

/** A stable string hash (djb2). Same name → same number, every run. */
function hash(s: string): number {
  let h = 5381;
  // eslint-disable-next-line no-bitwise
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + (s.codePointAt(i) ?? 0)) >>> 0;
  return h;
}

/** A deterministic tile color for an app name. */
export function tileColor(name: string): string {
  return TILE_COLORS[hash(name) % TILE_COLORS.length];
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
