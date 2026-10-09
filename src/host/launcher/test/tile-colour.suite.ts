/**
 * tile-colour Node suite (design-system-v1 chain-12, task 12.5). An installed app's tile identity —
 * its tint and glyph (`tile-identity.ts`): what a manifest declares, the seeded examples' fixed
 * tiles, the #127 guard, the read path for records from before tints, the override's validation —
 * and the transitional `tiles.ts#tileColor` the current screens still paint with, which now always
 * lands on a tint. Assignment against a real index, rebuilds and copies are in
 * `store-access.suite.ts` and `build-lifecycle.suite.ts`. Also the home grid cell width.
 */

import { Harness } from './harness';
import { tileColor } from '../tiles';
import { liftManifestTileColor } from '../manifest-tile-color';
import {
  HOME_GRID_COLUMNS,
  HOME_GRID_COLUMN_GAP,
  HOME_GRID_SIDE_PADDING,
  homeGridCellWidth,
} from '../home-grid';
import { TINT_NAMES, TINTS } from '../../../design/tokens';
import { isTintName, nearestTint } from '../../../design/tints';
import { GLYPH_NAMES } from '../../../design/icons/names';
import { reservedColors } from '../../../../scripts/lib/design-tokens';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess } from '../store-access';
import { seedFirstRun, type SeedSpec } from '../seed';
import { EXAMPLE_TILES, declaredTile, tileOf, type TileIdentity } from '../tile-identity';
import type { AppManifest } from '../../bridge/contract';

/** The three examples `LauncherRoot.tsx#defaultSeeds()` installs on first run. */
const SEEDED_IDS = ['tip-splitter', 'water-counter', 'style-gallery'];

const TINT_LIGHTS: ReadonlySet<string> = new Set(TINT_NAMES.map((t) => TINTS[t].light));
const RESERVED: readonly string[] = [...Object.values(reservedColors('light')), ...Object.values(reservedColors('dark'))];

const BUNDLE = 'var __WHIM_APP_MODULE__ = (() => ({}))();';

function rig() {
  const index = new AppIndex(new MapKVBackend());
  let t = 1000;
  const access = new StoreAccess({ store: createMemoryStore({ autoCompact: false }), index, now: () => (t += 1000) });
  return { index, access };
}

/** The real first-run seeds, built the way `defaultSeeds()` builds them: the shipped records and
 *  bundles the build extracts from the example fixtures. */
function shippedSeeds(): SeedSpec[] {
  return SEEDED_IDS.map((id) => ({
    id,
    name: APP_RECORDS[id]?.name ?? id,
    prompt: `Example: ${id}`,
    record: APP_RECORDS[id],
    bundleSource: APP_BUNDLES[id],
  }));
}

function sameTile(a: TileIdentity, b: TileIdentity): boolean {
  return a.tint === b.tint && a.icon === b.icon;
}

export async function runTileColourTests(h: Harness): Promise<void> {
  // ── tileColor — the transitional reader, always a tint ────────────────────
  await h.test('tileColor: every result is a tint’s light value, whatever the record declares', async () => {
    const declared = [
      ...TINT_NAMES.flatMap((t) => [TINTS[t].light, TINTS[t].dark]),
      ...RESERVED,
      '#2f6feb',
      '#fff',
      'not-a-hex',
      '',
    ];
    for (const hex of declared) {
      const colour = tileColor('Pour Timer', { tileColor: hex });
      h.ok(TINT_LIGHTS.has(colour), `"${hex}" paints a tint (got ${colour})`);
    }
    h.ok(TINT_LIGHTS.has(tileColor('Pour Timer')), 'no manifest paints a tint too');
    for (const reserved of RESERVED) {
      h.ok(tileColor('Budget', { tileColor: reserved }) !== reserved, `reserved colour ${reserved} is never painted as a tile`);
    }
  });

  await h.test('tileColor: a tint’s own value, in any case, paints that tint', async () => {
    for (const t of TINT_NAMES) {
      h.eq(tileColor('Any', { tileColor: TINTS[t].light }), TINTS[t].light, `${t} light value`);
      h.eq(tileColor('Any', { tileColor: TINTS[t].light.toLowerCase() }), TINTS[t].light, `${t} light value, lower case`);
    }
  });

  await h.test('tileColor: a malformed or absent colour paints what no colour paints, spread over the tints by name', async () => {
    for (const bad of ['not-a-hex', '#zzzzzz', 'ffaa00', '#12345', '']) {
      h.eq(tileColor('Water Counter', { tileColor: bad }), tileColor('Water Counter'), `"${bad}" falls back like no colour`);
    }
    h.eq(tileColor('Recipe Box', {}), tileColor('Recipe Box'), 'an absent field falls back like no manifest');
    h.eq(tileColor('Recipe Box'), tileColor('Recipe Box'), 'the fallback is stable for a name');
    const reached = new Set(Array.from({ length: 200 }, (_, i) => tileColor(`My App ${i}`)));
    h.ok(reached.size >= 5, `the name fallback spreads over the tints, not one colour (reached ${reached.size})`);
  });

  // ── liftManifestTileColor — the wire -> host-record lift, no re-validation ─
  await h.test('liftManifestTileColor: a string tileColor is lifted verbatim', async () => {
    h.eq(liftManifestTileColor({ tileColor: '#2f6feb' }), { tileColor: '#2f6feb' }, 'string value round-trips');
    h.eq(liftManifestTileColor({ tileColor: 'NotEvenHex' }), { tileColor: 'NotEvenHex' }, 'no re-validation performed here');
  });

  await h.test('liftManifestTileColor: a missing or non-string tileColor lifts nothing', async () => {
    h.eq(liftManifestTileColor({}), {}, 'no key at all');
    h.eq(liftManifestTileColor({ tileColor: 42 }), {}, 'a number is dropped');
    h.eq(liftManifestTileColor({ tileColor: null }), {}, 'null is dropped');
    h.eq(liftManifestTileColor({ tileColor: undefined }), {}, 'undefined is dropped');
    h.eq(liftManifestTileColor({ capabilities: ['x'] }), {}, 'an unrelated manifest key is ignored');
  });

  await h.test('liftManifestTileColor: a lifted reserved colour still paints a tint downstream', async () => {
    const reserved = reservedColors('light').danger;
    const lifted = liftManifestTileColor({ tileColor: reserved });
    h.eq(lifted, { tileColor: reserved }, 'lift is a straight passthrough');
    h.ok(TINT_LIGHTS.has(tileColor('Budget', lifted)) && tileColor('Budget', lifted) !== reserved, 'the reader maps it onto a tint');
  });

  // ── the seeded examples — from the shipped build output ───────────────────
  await h.test('examples: the shipped records’ colours land on distinct tints, each the example’s fixed tile', async () => {
    // Reads the real producer (the generated APP_RECORDS build.mjs#extractAppRecord emits), so the
    // current screens' colour for an example and its fixed tile can never drift apart.
    const tints = SEEDED_IDS.map((id) => {
      const record = APP_RECORDS[id];
      h.ok(typeof record?.manifest.tileColor === 'string', `${id}: the shipped manifest declares a colour`);
      h.ok(Object.hasOwn(EXAMPLE_TILES, id), `${id}: has a fixed tile`);
      const painted = tileColor(record?.name ?? id, record?.manifest);
      h.eq(painted, TINTS[EXAMPLE_TILES[id].tint].light, `${id}: the current screens paint its fixed tint`);
      return nearestTint(record?.manifest.tileColor ?? '');
    });
    h.eq(new Set(tints).size, SEEDED_IDS.length, `three distinct tints (got ${JSON.stringify(tints)})`);
  });

  await h.test('examples: first-run seeding installs each example with its fixed tile, distinct in tint and glyph', async () => {
    const { index, access } = rig();
    await seedFirstRun(index, access, shippedSeeds());
    const tiles = SEEDED_IDS.map((id) => {
      const app = index.get(id);
      h.ok(app != null, `${id} is installed`);
      return app ? tileOf(app) : undefined;
    });
    for (const [i, id] of SEEDED_IDS.entries()) h.eq(tiles[i], EXAMPLE_TILES[id], `${id} shows its fixed tile`);
    h.eq(new Set(tiles.map((t) => t?.tint)).size, SEEDED_IDS.length, 'pairwise distinct tints');
    h.eq(new Set(tiles.map((t) => t?.icon)).size, SEEDED_IDS.length, 'pairwise distinct glyphs');
    h.ok(tiles.every((t) => t !== undefined && t.icon !== 'circle'), 'no example draws the fallback circle');
  });

  await h.test('examples: an example installed before tiles existed reads its fixed tile', async () => {
    const record = APP_RECORDS['water-counter'];
    const legacy: InstalledApp = { id: 'water-counter', name: 'Water Counter', example: true, createdAt: 1, record, lineageId: 'main' };
    h.eq(tileOf(legacy), EXAMPLE_TILES['water-counter'], 'no stored tile, still the fixed one');
  });

  await h.test('#127: a generated app copying an example’s declaration never gets that example’s tile', async () => {
    const { index, access } = rig();
    await seedFirstRun(index, access, shippedSeeds());
    // Every other tint used once too, so the examples' tints are as reusable as any (all least used).
    const taken = new Set(Object.values(EXAMPLE_TILES).map((t) => t.tint));
    for (const tint of TINT_NAMES.filter((t) => !taken.has(t))) {
      await access.install({ id: `app-${tint}`, name: `App ${tint}`, record: { appId: `app-${tint}`, name: 'x', manifest: { capabilities: [], tint, icon: 'star' } as AppManifest }, bundleSource: BUNDLE, prompt: 'p' });
    }
    h.eq(new Set(index.list().map((a) => tileOf(a).tint)).size, TINT_NAMES.length, 'precondition: every tint is used exactly once');

    // The #127 shape: the model copies the few-shot example's name and colour (and so its glyph).
    const water = APP_RECORDS['water-counter'];
    const copied = { capabilities: [], tileColor: water?.manifest.tileColor } as AppManifest;
    const mimic = await access.install({ id: 'app-mimic', name: 'Water Counter', record: { appId: 'app-mimic', name: 'Water Counter', manifest: copied }, bundleSource: BUNDLE, prompt: 'p' });
    h.eq(declaredTile(copied, 'app-mimic', 'Water Counter'), { ranked: [EXAMPLE_TILES['water-counter'].tint], icon: EXAMPLE_TILES['water-counter'].icon }, 'precondition: it declares exactly the example’s tile');
    for (const id of SEEDED_IDS) h.ok(!sameTile(tileOf(mimic), EXAMPLE_TILES[id]), `the copy does not show ${id}’s tile (got ${JSON.stringify(tileOf(mimic))})`);
    h.eq(tileOf(mimic).icon, EXAMPLE_TILES['water-counter'].icon, 'it keeps its own glyph; only the tint moves');

    // The guard is the PAIR, not the tint: another glyph may still take the example's tint.
    const other = await access.install({ id: 'app-other', name: 'Rain', record: { appId: 'app-other', name: 'Rain', manifest: { capabilities: [], tint: EXAMPLE_TILES['water-counter'].tint, icon: 'cloud-rain' } as AppManifest }, bundleSource: BUNDLE, prompt: 'p' });
    h.eq(tileOf(other).tint, EXAMPLE_TILES['water-counter'].tint, 'a different glyph gets the example’s tint when it is least used');

    // The person may still pick it.
    index.setTileOverride('app-mimic', EXAMPLE_TILES['water-counter']);
    h.eq(tileOf(index.get('app-mimic')!), EXAMPLE_TILES['water-counter'], 'Customize tile can choose any tile');
  });

  // ── declarations and records from before tints ────────────────────────────
  await h.test('declaredTile: ranked names resolve through the alias list, without repeats, first three only', async () => {
    h.eq(declaredTile({ tint: ['Red', 'rose', 'navy', 'slate'] }, 'a', 'A').ranked, ['rose', 'indigo'], 'red→rose (repeat dropped), navy→indigo, the fourth ignored');
    h.eq(declaredTile({ tint: ' Ocean ' }, 'a', 'A').ranked, ['ocean'], 'one name, any case and spacing');
    const unknown = declaredTile({ tint: 'chartreuse' }, 'app-x', 'A').ranked;
    h.ok(unknown.length === 1 && isTintName(unknown[0]), 'an unknown name still ranks one tint');
    h.eq(declaredTile({ tint: 'chartreuse' }, 'app-x', 'B').ranked, unknown, 'chosen by the app id, not the name');
    h.eq(declaredTile({ tint: 'stone', tileColor: TINTS.ocean.light }, 'a', 'A').ranked, ['stone'], 'a declared tint wins over an old colour');
    h.eq(declaredTile({ tileColor: TINTS.ocean.light }, 'a', 'A').ranked, ['ocean'], 'with no tint, an old colour ranks its nearest');
  });

  await h.test('declaredTile: the icon resolves to a glyph tiles can draw', async () => {
    const glyphs = new Set<string>([...GLYPH_NAMES, 'circle']);
    h.eq(declaredTile({ icon: 'trash' }, 'a', 'A').icon, 'trash-2', 'an alias resolves');
    h.eq(declaredTile({ icon: 'timer' }, 'a', 'Notes').icon, 'timer', 'a set name is kept over the app name');
    const fromName = declaredTile({}, 'a', 'Water Counter').icon;
    h.ok(fromName !== 'circle' && glyphs.has(fromName), `no icon: the app name finds a glyph (got ${fromName})`);
    const chrome: string = declaredTile({ icon: 'settings' }, 'a', 'Q').icon;
    h.ok(chrome !== 'settings' && glyphs.has(chrome), 'a chrome icon is not a tile glyph');
    h.eq(declaredTile({ icon: 42 }, 'a', 'Q').icon, 'circle', 'a non-string icon with nothing to go on is the circle');
  });

  await h.test('tileOf: an old record with a hex colour and no tint shows the nearest tint, as the current screens paint it', async () => {
    const record = { appId: 'old', name: 'Old App', manifest: { capabilities: [], tileColor: '#0369a1' } };
    const legacy: InstalledApp = { id: 'old', name: 'Old App', createdAt: 1, record, lineageId: 'main' };
    h.eq(tileOf(legacy).tint, nearestTint('#0369a1'), 'the nearest tint by ΔE2000');
    h.eq(TINTS[tileOf(legacy).tint].light, tileColor(legacy.name, record.manifest), 'the same colour the current tile paints');
  });

  await h.test('override: only a tint and a tile glyph are accepted; an app that is not installed is null', async () => {
    const { index, access } = rig();
    await access.install({ id: 'app-1', name: 'Timer', record: { appId: 'app-1', name: 'Timer', manifest: { capabilities: [] } }, bundleSource: BUNDLE, prompt: 'p' });
    await h.throws(() => index.setTileOverride('app-1', { tint: 'red', icon: 'timer' } as unknown as TileIdentity), 'not a tile', 'an alias is not a tint');
    await h.throws(() => index.setTileOverride('app-1', { tint: 'violet', icon: 'settings' } as unknown as TileIdentity), 'not a tile', 'a chrome icon is not a glyph');
    h.ok(index.get('app-1')?.tileOverride === undefined, 'nothing was stored');
    h.eq(index.setTileOverride('nope', { tint: 'violet', icon: 'music' }), null, 'unknown app');
    h.eq(index.clearTileOverride('nope'), null, 'unknown app, clear');
  });

  // ── homeGridCellWidth — the fluid 3-up grid (finding V3, design html:388) ──────
  const FALLBACK = 88; // stands in for APP_TILE_SIZE, which lives in an RN module Node cannot load

  await h.test('homeGridCellWidth: the design’s 390 frame yields the 106 the mockup renders', async () => {
    // repeat(3,1fr) across 390 minus 22 either side minus two 14 gaps = 318, split three ways.
    h.eq(homeGridCellWidth(390, FALLBACK), 106, 'the mockup’s own frame reproduces the mockup’s own tile');
    h.ok(homeGridCellWidth(390, FALLBACK) > FALLBACK, 'and it is genuinely wider than the fixed 88 this replaces');
  });

  await h.test('homeGridCellWidth: a wider device gets proportionally wider tiles', async () => {
    h.eq(homeGridCellWidth(411, FALLBACK), 113, 'a 411dp Android frame divides exactly');
    h.ok(homeGridCellWidth(411, FALLBACK) > homeGridCellWidth(390, FALLBACK), 'wider frame, wider tile — the grid is fluid, not capped');
  });

  await h.test('homeGridCellWidth: a frame that does not divide evenly is FLOORED, never rounded up', async () => {
    // 412 - 44 - 28 = 340; 340/3 = 113.33... Rounding up (or leaving the fraction) can put
    // 3 tiles + 2 gaps over the row, and the grid is flexWrap:'wrap' — an overflow of any size
    // drops the third tile onto its own row. Flooring gives up <=2dp at the right edge instead.
    h.eq(homeGridCellWidth(412, FALLBACK), 113, '113.33 floors to 113');
    h.eq(homeGridCellWidth(413, FALLBACK), 113, '113.66 floors to 113 as well — never 114');
  });

  await h.test('homeGridCellWidth: three tiles plus two gaps never overflow the row, at any width', async () => {
    const gutters = 2 * HOME_GRID_SIDE_PADDING + (HOME_GRID_COLUMNS - 1) * HOME_GRID_COLUMN_GAP;
    for (let frame = 240; frame <= 1280; frame++) {
      // A DOMAIN guard, not a value guard. Skipping on `cell === FALLBACK` would excuse any
      // regression that returns the fallback for a perfectly good frame — and would silently skip
      // frame 336, where floor(264/3) legitimately equals 88 and collides with the sentinel.
      if (frame <= gutters) continue;
      const cell = homeGridCellWidth(frame, FALLBACK);
      const row = HOME_GRID_COLUMNS * cell + (HOME_GRID_COLUMNS - 1) * HOME_GRID_COLUMN_GAP;
      h.ok(row <= frame - 2 * HOME_GRID_SIDE_PADDING, `frame ${frame}: a row of ${HOME_GRID_COLUMNS} fits without wrapping`);
      h.eq(cell, Math.floor(cell), `frame ${frame}: the width is whole dp`);
    }
  });

  await h.test('homeGridCellWidth: a degenerate frame falls back, never <= 0 and never NaN', async () => {
    // 0 is what a window-dimensions read can hand back before the first layout pass; a frame
    // narrower than the chrome being subtracted makes the subtraction negative.
    //
    // 72/73/74 are the band where the division lands on exactly zero (gutters are 2*22 + 2*14 =
    // 72), which is the one case the `cell > 0` predicate exists for. Without them a `>= 0`
    // regression ships a zero-width tile and every other case here still passes.
    for (const frame of [0, -1, 40, 71, 72, 73, 74, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const cell = homeGridCellWidth(frame, FALLBACK);
      h.eq(cell, FALLBACK, `frame ${frame} falls back to the tile default`);
      h.ok(Number.isFinite(cell) && cell > 0, `frame ${frame} never yields NaN or a non-positive width`);
    }
    h.eq(homeGridCellWidth(0, 999), 999, 'the fallback returned is the caller’s, not a second hardcoded 88');
  });

  // A prior version of this suite had a test named "AppTile: exports its size constants and no
  // other module restates them" that only asserted `monogram('Pour Timer') === 'PT'` — tautological
  // against its own name. `flow-skeletons.tsx` importing `APP_TILE_SIZE`/`APP_TILE_RADIUS` and
  // using them directly (never restating a literal) is already covered by
  // `prompt-flow-screens.suite.ts` ("skeletons: geometry is imported..."), so it is deleted here
  // rather than fixed in place.
}
