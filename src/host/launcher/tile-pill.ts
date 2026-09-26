/**
 * tile-pill — the home grid tile's one overlay pill, picked from a closed set of kinds
 * (`launcher-ghost-tiles` design D8; product-verbs guard). Pure logic only: this module imports
 * no `react-native`, so `tilePillFor` and its spec table are exercisable under Node
 * (`grid-composition.suite.ts`) the same way `composeGrid` is.
 *
 * Only an in-flight rebuild of an installed app gets a pill. A seeded example is no longer one of
 * them (beta-1 R16): its pill sat on the tile art and overlapped the watermark, so it is now a
 * caption under the tile's name (`AppTile`'s `example`), outside the art at every tile width.
 */
import { ghostStateCaption } from './copy';
import type { PendingBuildRecord } from './pending-builds';

/** The closed set of pills a tile can show. There is never more than one on a tile at a time —
 *  `tilePillFor` is the single place that picks. */
export type TilePillKind = 'building' | 'failed' | 'interrupted';

/** Picks the tile's pill, if any: the state of a rebuild in flight for this installed app, and
 *  none otherwise. */
export function tilePillFor(rebuild: PendingBuildRecord | null | undefined): TilePillKind | null {
  return rebuild ? rebuild.state : null;
}

export interface TilePillSpec {
  label: string;
  tone: 'neutral' | 'alert';
  /** Whether the pill is its own tap target (`failed`/`interrupted`, opening the failure screen)
   *  or purely informational (`building`). */
  tappable: boolean;
}

/** The label/tone/tappable table for every pill kind. `COPY` is a plain literal object resolved
 *  once at module init (no theme/locale indirection — see `copy.ts`), so a top-level `const`
 *  table is safe to read it eagerly rather than needing a lazy function. Labels are never
 *  restated: the three rebuild states read `ghostStateCaption`, the same caption
 *  `GhostGridTile`'s own ghost caption uses. */
export const TILE_PILL: Record<TilePillKind, TilePillSpec> = {
  building: { label: ghostStateCaption('building'), tone: 'neutral', tappable: false },
  failed: { label: ghostStateCaption('failed'), tone: 'alert', tappable: true },
  interrupted: { label: ghostStateCaption('interrupted'), tone: 'alert', tappable: true },
};
