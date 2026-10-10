/**
 * customize-tile — what the Customize tile sheet offers and how its search reads (app-launcher
 * "Customize tile changes an app's tint and glyph"; system.md §3.2). Pure; no React import.
 */
import { GLYPH_GROUPS, GLYPH_NAMES, type GlyphName } from '../../design/icons/names';

/** A glyph's name as a person says it: "glass-water" is "glass water". */
export function glyphLabel(glyph: string): string {
  return glyph.replace(/-/g, ' ');
}

const GROUP_OF: ReadonlyMap<GlyphName, string> = new Map(
  Object.entries(GLYPH_GROUPS).flatMap(([group, glyphs]) => (glyphs as readonly GlyphName[]).map((g): [GlyphName, string] => [g, group.toLowerCase()])),
);

/** The glyphs whose name or group contains every word of `query` (any case); all of them for an
 *  empty query. Table order is kept, so the grid does not jump as the person types. */
export function filterGlyphs(query: string): readonly GlyphName[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return GLYPH_NAMES;
  return GLYPH_NAMES.filter((glyph) => {
    const haystack = `${glyphLabel(glyph)} ${GROUP_OF.get(glyph) ?? ''}`;
    return words.every((word) => haystack.includes(word));
  });
}

/** A tint's name for the swatch's screen-reader label: "Ocean". */
export function tintLabel(tint: string): string {
  return tint.charAt(0).toUpperCase() + tint.slice(1);
}
