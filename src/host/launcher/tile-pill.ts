/**
 * tile-pill — the home grid tile's one overlay pill, picked from a closed set of kinds
 * (`launcher-ghost-tiles` design D8; product-verbs guard). Pure logic only: this module imports
 * no `react-native`, so `tilePillFor` and its spec table are exercisable under Node
 * (`grid-composition.suite.ts`) the same way `composeGrid` is.
 *
 * Previously the grid rendered two ad hoc pills as siblings at the render site — an inline
 * "Example" pill and a separate `RebuildBadge` — kept mutually exclusive only by the expression
 * `app.example && !rebuild`. This module collapses that into one picker (`tilePillFor`) feeding
 * one component (`TilePill` in `tile-pill-view.tsx`) through one slot (`AppTile`'s `pill` prop).
 */
import { COPY, ghostStateCaption } from './copy';
import type { InstalledApp } from './app-index';
import type { PendingBuildRecord } from './pending-builds';

/** The closed set of pills a tile can show. There is never more than one on a tile at a time —
 *  `tilePillFor` is the single place that picks. */
export type TilePillKind = 'example' | 'building' | 'failed' | 'interrupted';

/** Picks the tile's pill, if any. Precedence: a rebuild record's state always wins over
 *  `example` (a seeded example being rebuilt shows the rebuild's own state, never "Example");
 *  with no rebuild, an example app shows `'example'` and every other app shows none. */
export function tilePillFor(
  app: Pick<InstalledApp, 'example'>,
  rebuild: PendingBuildRecord | null | undefined,
): TilePillKind | null {
  if (rebuild) return rebuild.state;
  if (app.example) return 'example';
  return null;
}

export interface TilePillSpec {
  label: string;
  tone: 'neutral' | 'alert';
  /** Whether the pill is its own tap target (`failed`/`interrupted`, opening the failure screen)
   *  or purely informational (`example`/`building`). */
  tappable: boolean;
}

/** The label/tone/tappable table for every pill kind. `COPY` is a plain literal object resolved
 *  once at module init (no theme/locale indirection — see `copy.ts`), so a top-level `const`
 *  table is safe to read it eagerly rather than needing a lazy function. Labels are never
 *  restated: `'example'` reads `COPY.exampleBadge` and the three rebuild states read
 *  `ghostStateCaption`, the same caption `GhostGridTile`'s own ghost caption uses. */
export const TILE_PILL: Record<TilePillKind, TilePillSpec> = {
  example: { label: COPY.exampleBadge, tone: 'neutral', tappable: false },
  building: { label: ghostStateCaption('building'), tone: 'neutral', tappable: false },
  failed: { label: ghostStateCaption('failed'), tone: 'alert', tappable: true },
  interrupted: { label: ghostStateCaption('interrupted'), tone: 'alert', tappable: true },
};
