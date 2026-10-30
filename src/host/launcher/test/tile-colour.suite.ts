/**
 * tile-colour Node suite (design-system-v1 chain-12, task 12.5). An installed app's tile identity —
 * its tint and glyph (`tile-identity.ts`): what a manifest declares, the seeded examples' fixed
 * tiles, the #127 guard, the read path for records from before tints (a stray `tileColor` is
 * ignored), the override's validation. Assignment against a real index,
 * rebuilds, copies and the wire → record mapping are in `store-access.suite.ts` and
 * `build-lifecycle.suite.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Harness } from './harness';
import { TINT_NAMES, TINTS } from '../../../design/tokens';
import { fallbackTint, isTintName } from '../../../design/tints';
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
import { runStaticChecks } from '../../../../checks/index';

/** The three examples `LauncherRoot.tsx#defaultSeeds()` installs on first run. */
const SEEDED_IDS = ['tip-splitter', 'water-counter', 'style-gallery'];

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
  // ── a stray `tileColor` (deprecated, from before tints) — ignored on read ──
  await h.test('stray tileColor: no value of it changes the ranking, which is the app id’s fallback, as with no colour', async () => {
    const none = declaredTile({}, 'app-x', 'Water Counter').ranked;
    h.eq(none, [fallbackTint('app-x')], 'no colour: the fallback tint for the app id');
    const otherTints = TINT_NAMES.filter((t) => t !== fallbackTint('app-x'));
    h.ok(otherTints.length === TINT_NAMES.length - 1, 'sanity: nine tints’ light values differ from the fallback, so a colour that picked a tint would show');
    for (const colour of [...otherTints.map((t) => TINTS[t].light), ...RESERVED, 'not-a-hex', '#zzzzzz', '', 42, null]) {
      h.eq(declaredTile({ tileColor: colour }, 'app-x', 'Water Counter').ranked, none, `${JSON.stringify(colour)} ranks like no colour`);
    }
  });

  // ── the shipped records — the build's tile comes from the checker's extraction ──
  await h.test('shipped records: each fixture’s record carries the tint and icon the static checker resolves from its source', async () => {
    // Decision #41: one extraction. The expectation is the server's own checker run on the fixture
    // source, so a build that resolved the tile a second way (or dropped it) disagrees here.
    const fixtureOf = (id: string) => path.join(process.cwd(), 'fixtures', `${id}.app.tsx`);
    const checked = Object.keys(APP_RECORDS).filter((id) => fs.existsSync(fixtureOf(id)));
    for (const id of SEEDED_IDS) h.ok(checked.includes(id), `${id}: a shipped fixture record is checked`);
    for (const id of checked) {
      const extracted = runStaticChecks(fs.readFileSync(fixtureOf(id), 'utf8')).manifest;
      h.ok(extracted !== undefined, `${id}: the checker extracts a manifest from the fixture`);
      const { tint, icon } = APP_RECORDS[id].manifest;
      h.eq({ tint, icon }, { tint: extracted?.tint, icon: extracted?.icon }, `${id}: the record's tint and icon are the checker's`);
      if (SEEDED_IDS.includes(id)) h.ok(tint !== undefined && icon !== undefined, `${id}: the example declares a tile`);
    }
  });

  // ── the seeded examples — from the shipped build output ───────────────────
  await h.test('examples: each example’s shipped record declares its fixed tile first, and no legacy colour', async () => {
    // Reads the real producer (the generated APP_RECORDS build.mjs#extractAppRecord emits), so an
    // example's declaration and its fixed tile can never drift apart.
    for (const id of SEEDED_IDS) {
      const manifest = APP_RECORDS[id]?.manifest;
      h.ok(Object.hasOwn(EXAMPLE_TILES, id), `${id}: has a fixed tile`);
      h.eq(manifest?.tint?.[0], EXAMPLE_TILES[id].tint, `${id}: its first declared tint is its fixed tint`);
      h.eq(manifest?.icon, EXAMPLE_TILES[id].icon, `${id}: its declared icon is its fixed glyph`);
      h.ok(manifest !== undefined && !Object.hasOwn(manifest, 'tileColor'), `${id}: the example declares no legacy tileColor`);
    }
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
      await access.install({ id: `app-${tint}`, name: `App ${tint}`, record: { appId: `app-${tint}`, name: 'x', manifest: { capabilities: [], tint: [tint], icon: 'star' } as AppManifest }, bundleSource: BUNDLE, prompt: 'p' });
    }
    h.eq(new Set(index.list().map((a) => tileOf(a).tint)).size, TINT_NAMES.length, 'precondition: every tint is used exactly once');

    // The #127 shape: the model copies the few-shot example's name, tints and glyph.
    const water = APP_RECORDS['water-counter'];
    const copied = { capabilities: [], tint: water?.manifest.tint, icon: water?.manifest.icon } as AppManifest;
    const mimic = await access.install({ id: 'app-mimic', name: 'Water Counter', record: { appId: 'app-mimic', name: 'Water Counter', manifest: copied }, bundleSource: BUNDLE, prompt: 'p' });
    const declared = declaredTile(copied, 'app-mimic', 'Water Counter');
    h.eq({ tint: declared.ranked[0], icon: declared.icon }, EXAMPLE_TILES['water-counter'], 'precondition: it declares exactly the example’s tile first');
    for (const id of SEEDED_IDS) h.ok(!sameTile(tileOf(mimic), EXAMPLE_TILES[id]), `the copy does not show ${id}’s tile (got ${JSON.stringify(tileOf(mimic))})`);
    h.eq(tileOf(mimic).icon, EXAMPLE_TILES['water-counter'].icon, 'it keeps its own glyph; only the tint moves');

    // The guard is the PAIR, not the tint: another glyph may still take the example's tint.
    const other = await access.install({ id: 'app-other', name: 'Rain', record: { appId: 'app-other', name: 'Rain', manifest: { capabilities: [], tint: [EXAMPLE_TILES['water-counter'].tint], icon: 'cloud-rain' } as AppManifest }, bundleSource: BUNDLE, prompt: 'p' });
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
    h.ok(fallbackTint('a') !== 'ocean', 'sanity: the fallback for "a" is not ocean');
    h.eq(declaredTile({ tileColor: TINTS.ocean.light }, 'a', 'A').ranked, [fallbackTint('a')], 'with no tint, an old colour is ignored for the fallback');
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

  await h.test('tileOf: an old record with a hex colour and no tint shows its fallback tint', async () => {
    const record = { appId: 'old', name: 'Old App', manifest: { capabilities: [], tileColor: TINTS.ocean.light } };
    const legacy: InstalledApp = { id: 'old', name: 'Old App', createdAt: 1, record, lineageId: 'main' };
    h.ok(fallbackTint('old') !== 'ocean', 'sanity: the colour (ocean’s own light value) and the app id pick different tints, so this is not vacuous');
    h.eq(tileOf(legacy).tint, fallbackTint('old'), 'the app id’s fallback, not the colour');
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
}
