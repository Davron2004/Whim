/**
 * grid-composition Node suite (launcher-ghost-tiles, task 3.5). Exercises the pure logic that
 * decides what the home grid renders: ghost ordering (newest-first, straight from `pending`),
 * dedupe-by-id with the pending/ghost entry winning (spec "Grid composition dedupes pending and
 * installed entries by id, pending wins"), and rebuild flagging — a record carrying
 * `editingAppId` attaches to its target's installed tile instead of spawning its own ghost (spec
 * "Rebuilding an existing app marks its installed tile as building, spawning no ghost").
 *
 * `HomeScreen.tsx`/`app-tile.tsx` are RN components (not renderable under Node, same idiom as
 * `tile-colour.suite.ts`), so their wiring onto this pure logic is checked against production
 * source text instead — this suite's weight is on `composeGrid` itself.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { composeGrid, GridTile } from '../grid-composition';
import { ghostStateCaption } from '../copy';
import { tilePillFor, TILE_PILL } from '../tile-pill';
import type { InstalledApp } from '../app-index';
import type { PendingBuildRecord } from '../pending-builds';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

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

  // ── red-check aid: state on the record survives verbatim (building/failed/interrupted) ──
  await h.test('composeGrid: a ghost tile carries its record’s state verbatim', async () => {
    for (const state of ['building', 'failed', 'interrupted'] as const) {
      const tiles = composeGrid([pendingRecord(`p-${state}`, { state })], []);
      h.eq((tiles[0] as Extract<GridTile, { kind: 'ghost' }>).rec.state, state, `ghost state ${state} is not rewritten`);
    }
  });

  // ── ghostStateCaption (copy.ts) — every state names itself, distinctly ────
  await h.test('ghostStateCaption: every state has its own, non-empty caption', async () => {
    const captions = (['building', 'failed', 'interrupted'] as const).map(ghostStateCaption);
    h.eq(new Set(captions).size, 3, 'three distinct captions — no state borrows another’s wording');
    for (const c of captions) h.ok(c.length > 0, `"${c}" is non-empty`);
  });

  await h.test('ghostStateCaption: failed and interrupted are each distinct from building’s neutral caption', async () => {
    h.ok(ghostStateCaption('failed') !== ghostStateCaption('building'), 'failed reads differently from building');
    h.ok(ghostStateCaption('interrupted') !== ghostStateCaption('building'), 'interrupted reads differently from building');
  });

  // ── production-source checks (RN components, not renderable under Node) ───
  await h.test('HomeScreen: composes the grid through composeGrid, never re-deriving dedupe/ordering itself', async () => {
    const src = read('HomeScreen.tsx');
    h.ok(/composeGrid\(pending \?\? \[\], apps\)/.test(src), 'the grid is composed from `pending` (defaulted) and `apps`');
    h.ok(!/\.sort\(/.test(src), 'HomeScreen never re-sorts — ordering is composeGrid’s job alone');
  });

  await h.test('HomeScreen: a ghost tile taps onOpenPending, never onOpen — no mini-app realm opens from a ghost', async () => {
    const src = read('HomeScreen.tsx');
    const ghostTileFn = src.slice(src.indexOf('function GhostGridTile'), src.indexOf('function GhostActionRow'));
    h.ok(ghostTileFn.length > 0, 'the GhostGridTile slice is non-empty — a future rename must fail loudly, not test an empty string');
    h.ok(ghostTileFn.includes('onOpenPending?.(rec)'), 'tapping a ghost calls onOpenPending');
    h.ok(!ghostTileFn.includes('onOpen('), 'and never the installed-app onOpen — spec "A ghost tile does not launch an app"');
  });

  await h.test('HomeScreen: the ghost tile’s colour is ghostTileColorFor(rec.id), fed through AppTile’s declared-colour path', async () => {
    const src = read('HomeScreen.tsx');
    // This pins the GHOST end only: the grid hashes the launcher id and hands it to `AppTile` as a
    // declared colour, so no second resolver exists. That the DELIVERED tile then keeps the same
    // hue is a property of delivery, not of this line — it is pinned in `build-lifecycle.suite.ts`
    // ("colour: a delivered new install keeps the exact hue its ghost had").
    h.ok(
      /manifest=\{\{ tileColor: ghostTileColorFor\(rec\.id\) \}\}/.test(src),
      'the ghost’s colour is the launcher-id hash, passed through the one declared-colour-wins path AppTile resolves through',
    );
  });

  await h.test('HomeScreen: the ghost tile’s label is workingTitle — never the prompt or the id', async () => {
    const src = read('HomeScreen.tsx');
    const ghostTileFn = src.slice(src.indexOf('function GhostGridTile'), src.indexOf('function GhostActionRow'));
    h.ok(ghostTileFn.length > 0, 'the GhostGridTile slice is non-empty — a future rename must fail loudly, not test an empty string');
    h.ok(ghostTileFn.includes('name={rec.workingTitle}'), 'the label is the precomputed working title');
    h.ok(!ghostTileFn.includes('rec.prompt'), 'never re-derived from the raw prompt');
  });

  await h.test('AppTile: the ghost prop greys the tile and never adds a cancel/dismiss control on its face', async () => {
    const src = read('app-tile.tsx');
    h.ok(/ghost\?: 'building' \| 'failed' \| 'interrupted';/.test(src), 'the ghost prop is the exact three-state union');
    h.ok(/tileGhost: \{ opacity: /.test(src), 'a ghost tile is rendered at reduced opacity (greyed/desaturated)');
    h.ok(!/onCancelPending|onDismissPending/.test(src), 'AppTile never wires a cancel/dismiss control of its own — that stays the long-press sheet’s job');
    // Exactly one `onPress={...}` wire may exist in this file: the pill's own (design D8's
    // failed/interrupted pill, `TilePill` in `tile-pill-view.tsx`) — orthogonal to `ghost` and
    // asserted behaviorally elsewhere (the `TILE_PILL` test below). Matching the `onPress=`
    // ASSIGNMENT (never the bare word, which also turns up in the prop's type and doc comment)
    // keeps the original invariant alive: a future SECOND hand-wired control on the tile face
    // (e.g. a stray `onPress` on the ghost caption) still trips this.
    h.eq((src.match(/onPress=/g) ?? []).length, 1, 'exactly one onPress={...} wire in this file — the pill’s, and nothing else');
    h.ok(src.includes('onPress={pill.onPress}'), 'and that one wire is the pill’s own onPress, not a second ad hoc control');
    h.ok(/\{!isDone && ghost && \(\s*<Text style=\{ghostCaptionStyle\}/.test(src), 'the ghost caption renders as plain text on the tile face, never a tap target');
  });

  await h.test('AppTile: failed/interrupted carry a shared alert accent distinct from building’s neutral one', async () => {
    const src = read('app-tile.tsx');
    h.ok(/function isAlertGhost\(ghost: AppTileProps\['ghost'\]\): boolean \{\s*return ghost === 'failed' \|\| ghost === 'interrupted';/.test(src), 'failed and interrupted share one predicate — building is excluded from it');
    h.ok(/tileGhostAlert: \{ borderColor: STATUS_COLORS\.broken \}/.test(src), 'the alert accent is the reserved "broken" status hue');
    h.ok(/ghostCaptionAlert: \{ color: STATUS_COLORS\.broken \}/.test(src), 'and the caption text takes the same alert hue');
  });

  await h.test('HomeScreen: a ghost/rebuild long-press offers Cancel xor Dismiss, never both at once', async () => {
    const src = read('HomeScreen.tsx');
    const rowFn = src.slice(src.indexOf('function GhostActionRow'), src.indexOf('function SheetRow'));
    // Structural guarantee, not just a string check: an `if (...) { return <Cancel row>; }`
    // followed by an unconditional `return <Dismiss row>;` can only ever return exactly one.
    h.ok(/if \(rec\.state === 'building'\) \{/.test(rowFn), 'building takes the early-return branch');
    h.ok(rowFn.includes('COPY.actionCancelBuild'), 'building offers Cancel');
    h.ok(rowFn.includes('COPY.actionDismissBuild'), 'every other state offers Dismiss');
    h.eq((rowFn.match(/return \(/g) ?? []).length, 2, 'exactly two return sites — a row is always exactly one of the two, never both');
  });

  await h.test('a building rebuild shows a passive badge; failed/interrupted is its own tap target', async () => {
    h.ok(!TILE_PILL.building.tappable, 'building is passive — no dedicated tap target');
    h.ok(TILE_PILL.failed.tappable, 'failed is its own tap target');
    h.ok(TILE_PILL.interrupted.tappable, 'interrupted is its own tap target');
    h.eq(TILE_PILL.example.tone, 'neutral', 'example is the neutral tone');
    h.eq(TILE_PILL.building.tone, 'neutral', 'building is the neutral tone');
    h.eq(TILE_PILL.failed.tone, 'alert', 'failed is the alert tone');
    h.eq(TILE_PILL.interrupted.tone, 'alert', 'interrupted is the alert tone');

    // What the table itself cannot pin: that HomeScreen actually wires a tappable pill's press
    // through to `onOpenPending`, rather than computing the table right and then dropping the
    // wire at the render site.
    const src = read('HomeScreen.tsx');
    h.ok(/TILE_PILL\[pillKind\]\.tappable[\s\S]{0,40}onOpenPending\?\.\(rebuild\)/.test(src), 'HomeScreen wires a tappable pill’s press to onOpenPending');
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
