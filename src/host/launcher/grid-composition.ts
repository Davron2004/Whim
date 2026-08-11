/**
 * grid-composition — the home grid's pure composition logic (launcher-ghost-tiles, tasks
 * 3.1/3.3). Free of `react-native`, so the dedupe/ordering/rebuild-flagging correctness is
 * Node-testable — the same split `home-grid.ts` makes for the grid's geometry, and for the same
 * reason: `HomeScreen.tsx` imports `react-native` at module scope, so the Node acceptance harness
 * (which esbuild-bundles the whole import graph) cannot load it.
 *
 * Three invariants this module exists to hold (`handoff/ghost-handlers.md`,
 * `handoff/pending-store.md`):
 *   - `pending` arrives already NEWEST-FIRST from `PendingBuildStore.list()` — never re-sorted
 *     here. Ghosts render before installed apps (design D1).
 *   - A record carrying `editingAppId` is a rebuild attempt and spawns NO ghost tile; it attaches
 *     to the installed tile of that id instead (design D8) — `editingAppId === id` for these
 *     records.
 *   - An id present in both a ghost candidate and an installed record (a delivery race — delete +
 *     refresh is not atomic with a render) dedupes to exactly one tile: the pending/ghost entry
 *     wins, and the installed entry for that id is dropped until the pending record is deleted.
 */
import type { InstalledApp } from './app-index';
import type { PendingBuildRecord } from './pending-builds';

export interface GhostTile {
  readonly kind: 'ghost';
  readonly rec: PendingBuildRecord;
}

export interface InstalledTile {
  readonly kind: 'app';
  readonly app: InstalledApp;
  /** Present when a pending record with `editingAppId === app.id` exists: a rebuild attempt
   *  in-flight or terminally failed/interrupted on this already-installed app (design D8). */
  readonly rebuild?: PendingBuildRecord;
}

export type GridTile = GhostTile | InstalledTile;

/**
 * Composes the home grid from the pending-build records and the installed apps: ghosts
 * (newest-first, in `pending`'s own order) before installed apps, an id present in both lists
 * rendering exactly once — as the ghost/pending entry — and any `editingAppId` record attached to
 * its target installed tile's `rebuild` field instead of spawning its own ghost.
 */
export function composeGrid(
  pending: readonly PendingBuildRecord[],
  apps: readonly InstalledApp[],
): GridTile[] {
  const rebuildByAppId = new Map<string, PendingBuildRecord>();
  const ghosts: GhostTile[] = [];
  for (const rec of pending) {
    if (rec.editingAppId) {
      rebuildByAppId.set(rec.editingAppId, rec);
    } else {
      ghosts.push({ kind: 'ghost', rec });
    }
  }

  const ghostIds = new Set(ghosts.map((g) => g.rec.id));
  const seenAppIds = new Set<string>();
  const installed: InstalledTile[] = [];
  for (const app of apps) {
    // Dedupe by id, pending wins (a transmute race can list the same id in both `apps` and a
    // still-present ghost for one frame); also guards defensively against a duplicate `apps` id.
    if (ghostIds.has(app.id) || seenAppIds.has(app.id)) continue;
    seenAppIds.add(app.id);
    const rebuild = rebuildByAppId.get(app.id);
    installed.push({ kind: 'app', app, ...(rebuild ? { rebuild } : {}) });
  }

  return [...ghosts, ...installed];
}
