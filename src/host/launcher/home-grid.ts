// ─────────────────────────────────────────────────────────────────────────────
// home-grid — the `2a` home grid's geometry, and the one derivation that turns a frame width into
// a tile width (fix-design-conformance lane L2, finding V3).
// ─────────────────────────────────────────────────────────────────────────────
// Split out of `HomeScreen.tsx` for exactly one reason: `HomeScreen.tsx` imports `react-native` at
// module scope, and the Node acceptance harness esbuild-bundles the whole import graph, so RN's
// Flow source fails to parse before a single assertion runs (the constraint `tile-colour.suite.ts`
// already records for `AppTile`). The arithmetic below is the load-bearing part of V3 — it decides
// whether the grid wraps — so it lives where it can actually be tested.
//
// **This module must import NO react-native, directly or transitively.** `../../sdk/theme` is safe:
// it is pure data and re-exports only `./design-tokens`, which imports nothing at all.
import { SPACING } from '../../sdk/theme';

/** The grid's own geometry. Tile size itself is `AppTile`'s exported constant, never restated. */
export const HOME_GRID_COLUMNS = 3;
export const HOME_GRID_COLUMN_GAP = 14;
export const HOME_GRID_ROW_GAP = 18;

/** The horizontal padding the scroll wrapper puts either side of the grid (design html:388
 *  `padding:4px 22px 0`). Exported rather than left as a bare `SPACING.lg` at the style so the
 *  derivation below and the style it must agree with read from one place — if they drift, the row
 *  overflows and the grid wraps to two columns. */
export const HOME_GRID_SIDE_PADDING = SPACING.lg;

/**
 * How wide one tile stands on a frame this wide.
 *
 * The design is `grid-template-columns:repeat(3,1fr)` (html:388) — the grid FILLS the frame, so a
 * tile is not the fixed 88 the implementation shipped. One row is the frame minus the wrapper's
 * side padding on both edges, minus the two column gaps, split three ways. The design's 390pt
 * frame yields exactly the 106 the mockup renders.
 *
 * **Rounding: floored to whole dp.** RN accepts fractional dp, but three fractional tiles plus two
 * gaps can exceed the row by a sub-pixel under IEEE-754 rounding (`x/3*3 > x` is reachable), and
 * the grid is `flexWrap: 'wrap'` — an overflow of any size drops the third tile onto its own row.
 * Flooring gives up at most 2dp of slack at the right edge, which is invisible, and can never
 * wrap. It also costs nothing on the sizes that matter: 390 and 411 both divide exactly.
 *
 * `fallbackWidth` is injected rather than imported because the value callers pass is
 * `APP_TILE_SIZE`, which lives in `app-tile.tsx` — an RN module this one may not touch. It is
 * returned verbatim for any degenerate frame: 0 before the first layout pass, `NaN`/`Infinity`
 * from a window-dimensions read that has not resolved, or a device narrower than the chrome being
 * subtracted. The function therefore never returns a value that is not a finite positive number.
 */
export function homeGridCellWidth(frameWidth: number, fallbackWidth: number): number {
  const gutters = 2 * HOME_GRID_SIDE_PADDING + (HOME_GRID_COLUMNS - 1) * HOME_GRID_COLUMN_GAP;
  const cell = Math.floor((frameWidth - gutters) / HOME_GRID_COLUMNS);
  return Number.isFinite(cell) && cell > 0 ? cell : fallbackWidth;
}
