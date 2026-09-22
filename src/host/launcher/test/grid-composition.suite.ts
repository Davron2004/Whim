/**
 * grid-composition Node suite (launcher-ghost-tiles, task 3.5). Exercises the pure logic that
 * decides what the home grid renders: ghost ordering (newest-first, straight from `pending`),
 * dedupe-by-id with the pending/ghost entry winning (spec "Grid composition dedupes pending and
 * installed entries by id, pending wins"), and rebuild flagging — a record carrying
 * `editingAppId` attaches to its target's installed tile instead of spawning its own ghost (spec
 * "Rebuilding an existing app marks its installed tile as building, spawning no ghost").
 * What the rendered grid does with it is in `home-grid-ui.suite.tsx`.
 */

import { Harness } from './harness';
import { composeGrid, GridTile } from '../grid-composition';
import { ghostStateCaption } from '../copy';
import { tilePillFor } from '../tile-pill';
import type { InstalledApp } from '../app-index';
import type { PendingBuildRecord } from '../pending-builds';


let nextTime = 1;

/** A minimal, Tier-0 installed app — no capabilities, no storage, no fork/group fields (same
 *  shape `build-lifecycle.suite.ts#APP` already uses). */
function app(id: string, name = id): InstalledApp {
  const createdAt = nextTime++;
  return {
    id,
    name,
    createdAt,
    record: { appId: id, name, manifest: { capabilities: [] } },
    lineageId: 'main',
  };
}

/** A minimal pending-build record. `state` defaults to `building`; pass `editingAppId` to mark a
 *  rebuild attempt. */
function pendingRecord(
  id: string,
  opts: { state?: PendingBuildRecord['state']; editingAppId?: string; workingTitle?: string } = {},
): PendingBuildRecord {
  const now = nextTime++;
  return {
    id,
    prompt: `prompt for ${id}`,
    workingTitle: opts.workingTitle ?? `Title ${id}`,
    state: opts.state ?? 'building',
    createdAt: now,
    updatedAt: now,
    ...(opts.editingAppId ? { editingAppId: opts.editingAppId } : {}),
  };
}

function ghostIds(tiles: readonly GridTile[]): string[] {
  return tiles.filter((t): t is Extract<GridTile, { kind: 'ghost' }> => t.kind === 'ghost').map((t) => t.rec.id);
}

function appIds(tiles: readonly GridTile[]): string[] {
  return tiles.filter((t): t is Extract<GridTile, { kind: 'app' }> => t.kind === 'app').map((t) => t.app.id);
}

export async function runGridCompositionTests(h: Harness): Promise<void> {
  // ── ordering (design D1) ────────────────────────────────────────────────────
  await h.test('composeGrid: ghosts render before installed apps', async () => {
    const tiles = composeGrid([pendingRecord('p1')], [app('a1')]);
    h.eq(tiles.map((t) => t.kind), ['ghost', 'app'], 'the one ghost precedes the one installed app');
  });

  await h.test('composeGrid: ghosts are never re-sorted — they keep `pending`’s own (already newest-first) order', async () => {
    // `pending.list()` hands them over newest-first; composeGrid must NOT re-sort by createdAt or
    // anything else — it must reproduce the caller's own order verbatim.
    const oldest = pendingRecord('p-old');
    const newest = pendingRecord('p-new');
    const tiles = composeGrid([newest, oldest], []); // caller already put newest first
    h.eq(ghostIds(tiles), ['p-new', 'p-old'], 'ghost order mirrors the input order exactly');
  });

  await h.test('composeGrid: installed apps keep the order the caller passed', async () => {
    const tiles = composeGrid([], [app('a1'), app('a2'), app('a3')]);
    h.eq(appIds(tiles), ['a1', 'a2', 'a3'], 'installed order is preserved, not re-derived');
  });

  await h.test('composeGrid: no pending and no apps composes an empty grid', async () => {
    h.eq(composeGrid([], []), [], 'nothing to render');
  });

  // ── dedupe by id, pending wins (spec "Grid composition dedupes...") ────────
  await h.test('composeGrid: an id present in both lists renders exactly once, as the ghost', async () => {
    // The transmute race: delivery has written the installed app but not yet deleted the pending
    // record (store first, index second, pending record deleted LAST) — for one frame both lists
    // carry the same id.
    const tiles = composeGrid([pendingRecord('shared')], [app('shared')]);
    h.eq(tiles.length, 1, 'exactly one tile for the shared id');
    h.eq(tiles[0].kind, 'ghost', 'the ghost/pending entry wins, not the installed one');
  });

  await h.test('composeGrid: dedupe does not affect unrelated ids either direction', async () => {
    const tiles = composeGrid([pendingRecord('shared'), pendingRecord('p-only')], [app('shared'), app('a-only')]);
    h.eq(ghostIds(tiles), ['shared', 'p-only'], 'both ghosts render');
    h.eq(appIds(tiles), ['a-only'], 'the non-colliding installed app renders; the colliding one does not');
  });

  await h.test('composeGrid: a duplicate id within `apps` itself is defensively deduped (first wins)', async () => {
    const first = app('dup');
    const second = app('dup');
    second.name = 'Second Dup'; // distinguishable, so the survivor is checkable
    const tiles = composeGrid([], [first, second]);
    h.eq(tiles.length, 1, 'only one tile for the duplicated id');
    h.eq(appIds(tiles), ['dup'], 'the id renders once');
  });

  // ── rebuild flagging (design D8) — spawns no ghost, attaches to the installed tile ──
  await h.test('composeGrid: a record with editingAppId spawns NO ghost tile', async () => {
    const tiles = composeGrid([pendingRecord('rebuild-1', { editingAppId: 'installed-1' })], [app('installed-1')]);
    h.eq(ghostIds(tiles), [], 'no ghost for the rebuild attempt');
    h.eq(tiles.length, 1, 'only the installed tile renders');
  });

  await h.test('composeGrid: the rebuild record attaches to its target installed tile’s `rebuild` field', async () => {
    const rec = pendingRecord('rebuild-1', { editingAppId: 'installed-1', state: 'failed' });
    const tiles = composeGrid([rec], [app('installed-1')]);
    const installed = tiles.find((t): t is Extract<GridTile, { kind: 'app' }> => t.kind === 'app');
    h.ok(installed != null, 'the installed tile renders');
    h.eq(installed?.rebuild, rec, 'carrying the exact rebuild record');
  });

  await h.test('composeGrid: an installed app with no matching rebuild record carries no `rebuild` field', async () => {
    const tiles = composeGrid([], [app('a1')]);
    const installed = tiles.find((t): t is Extract<GridTile, { kind: 'app' }> => t.kind === 'app');
    h.eq(installed?.rebuild, undefined, 'no rebuild attached');
  });

  await h.test('composeGrid: a rebuild record for an app not in `apps` attaches to nothing and renders no tile', async () => {
    // Defensive: the app it targets is gone (deleted mid-flight) — the record should not conjure
    // either a ghost or a phantom installed tile.
    const tiles = composeGrid([pendingRecord('rebuild-orphan', { editingAppId: 'missing-app' })], []);
    h.eq(tiles, [], 'nothing renders for an orphaned rebuild record');
  });

  await h.test('composeGrid: a real (non-rebuild) ghost and an unrelated rebuild coexist correctly', async () => {
    const ghost = pendingRecord('g1');
    const rebuild = pendingRecord('rebuild-1', { editingAppId: 'a1', state: 'interrupted' });
    const tiles = composeGrid([ghost, rebuild], [app('a1'), app('a2')]);
    h.eq(ghostIds(tiles), ['g1'], 'only the true new-install attempt gets a ghost');
    h.eq(appIds(tiles), ['a1', 'a2'], 'both installed apps still render, in their given order');
    const rebuiltTile = tiles.find((t): t is Extract<GridTile, { kind: 'app' }> => t.kind === 'app' && t.app.id === 'a1');
    h.eq(rebuiltTile?.rebuild, rebuild, 'a1 carries the rebuild record');
  });

  // ── ghostStateCaption (copy.ts) — every state names itself, distinctly ────
  await h.test('ghostStateCaption: every state has its own, non-empty caption', async () => {
    const captions = (['building', 'failed', 'interrupted'] as const).map(ghostStateCaption);
    h.eq(new Set(captions).size, 3, 'three distinct captions — no state borrows another’s wording');
    for (const c of captions) h.ok(c.length > 0, `"${c}" is non-empty`);
  });

  // ── tilePillFor precedence ───────────────────────────────────────────────────
  await h.test('tilePillFor: an example app with no rebuild shows the example pill', () => {
    h.eq(tilePillFor({ example: true }, null), 'example', 'no rebuild in flight — the example pill is the only candidate');
  });

  await h.test('tilePillFor: an example app with an interrupted rebuild shows interrupted, not example', () => {
    const rec = pendingRecord('p1', { state: 'interrupted', editingAppId: 'a1' });
    h.eq(tilePillFor({ example: true }, rec), 'interrupted', 'a rebuild record’s state wins over `example`');
  });

  await h.test('tilePillFor: an example app with a building rebuild shows building, not example', () => {
    const rec = pendingRecord('p1', { state: 'building', editingAppId: 'a1' });
    h.eq(tilePillFor({ example: true }, rec), 'building', 'a rebuild record’s state wins over `example`');
  });

  await h.test('tilePillFor: a plain app with no rebuild shows no pill', () => {
    h.eq(tilePillFor({ example: false }, null), null, 'nothing to show');
    h.eq(tilePillFor({}, undefined), null, 'nothing to show, `example` omitted entirely');
  });

  await h.test('tilePillFor: a plain app with a failed rebuild shows failed', () => {
    const rec = pendingRecord('p1', { state: 'failed', editingAppId: 'a1' });
    h.eq(tilePillFor({ example: false }, rec), 'failed', 'the rebuild record’s state, not the plain app’s lack of one');
  });
}
