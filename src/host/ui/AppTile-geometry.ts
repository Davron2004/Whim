/**
 * AppTile geometry — the numbers a tile and the home grid are drawn with (system.md §3.2 Tiles,
 * §7.1 App tile; design-system-v1 task 11.4), exported so the home skeleton draws exactly the cells
 * the grid will. No React Native import: Node suites and the skeleton read it directly. Tile states
 * are not here.
 */

import { LAYOUT, SHAPE, SPACE, TYPE_SCALE } from '../../design/tokens';

export type TileSize = 'inline' | 'menu' | 'grid' | 'hero';

/** A tile's side per use: 24 inline, 40 in sheets, headers and the menu, 64 on the grid, 96 hero
 *  (Ready, History). No others. */
export const TILE_SIDE: Readonly<Record<TileSize, number>> = { inline: 24, menu: 40, grid: 64, hero: 96 };

export const TILE = {
  /** The squircle's corner, as a share of the side. */
  corner: SHAPE.tileCorner,
  /** The glyph's share of the side, centred, stroke 2 on the 24 grid. */
  glyph: 0.5,
  glyphStroke: 2,
  /** The badge at the top-trailing corner (failed, change failed). */
  badge: 18,
} as const;

export const GRID = {
  columns: 4,
  /** From 135% text. */
  largeTextColumns: 3,
  /** From 135% text the grid has 3 columns; from 200% it is a list of rows with the 40 tile. */
  largeTextFrom: 1.35,
  listFrom: 2,
  /** Between the tile and its label. */
  labelGap: SPACE[1],
  /** The label's two lines and side padding. */
  labelLines: 2,
  labelSidePadding: SPACE[1],
  /** Between a label and the next tile below. */
  rowGap: SPACE[5],
  /** The smallest touch area a cell gives. */
  minTouch: { width: 64, height: 84 },
} as const;

export type GridLayout =
  | { kind: 'grid'; columns: number; columnWidth: number; tile: number; cellHeight: number; rowGap: number; gutter: number }
  | { kind: 'list'; tile: number; rowHeight: number; gutter: number };

/** The home grid for a screen `width` wide at text size `fontScale`: four columns of
 *  `(width − 40) / 4` with the 64 tile and a two-line `caption` label; three from 135%; a list of
 *  rows with the 40 tile from 200%. Heights grow with the label's text size. */
export function gridLayout(width: number, fontScale: number): GridLayout {
  const scale = Math.max(1, fontScale);
  if (scale >= GRID.listFrom) {
    const line = TYPE_SCALE.body.lineHeight * scale;
    return { kind: 'list', tile: TILE_SIDE.menu, rowHeight: Math.max(LAYOUT.listRowMinHeight, line + 2 * LAYOUT.listRowPaddingVertical), gutter: LAYOUT.gutter };
  }
  const columns = scale >= GRID.largeTextFrom ? GRID.largeTextColumns : GRID.columns;
  const label = GRID.labelLines * TYPE_SCALE.caption.lineHeight * scale;
  const cellHeight = Math.max(GRID.minTouch.height, TILE_SIDE.grid + GRID.labelGap + label);
  return {
    kind: 'grid',
    columns,
    columnWidth: (width - 2 * LAYOUT.gutter) / columns,
    tile: TILE_SIDE.grid,
    cellHeight,
    rowGap: GRID.rowGap,
    gutter: LAYOUT.gutter,
  };
}
