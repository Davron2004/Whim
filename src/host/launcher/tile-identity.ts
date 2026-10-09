/**
 * tile-identity — an installed app's tile: one tint and one glyph (design-system-v1 D5; app-launcher
 * "The host assigns each app's tint", "Customize tile changes an app's tint and glyph";
 * `docs/design/system.md` §2.4, §3.2).
 *
 * The app's manifest only DECLARES (up to three ranked tints and an icon name); the host ASSIGNS at
 * install, from what the other installed apps already use, and stores the result on the launcher
 * record (`InstalledApp.tint`/`icon`). A copy takes the tint farthest from its original's. A
 * "Customize tile" choice is a separate `tileOverride` that wins over the assignment. All three are
 * host fields: a rebuild never re-assigns them (`StoreAccess.update` carries them forward).
 *
 * `tileOf` is the one read path: override, else the assignment, else — for a record installed
 * before tints existed — its old hex `tileColor` mapped to the nearest tint. Pure; no React import.
 */

import type { TintName } from '../../design/tokens';
import { assignTint, fallbackTint, farthestTint, isTintName, nearestTint, resolveTint } from '../../design/tints';
import { FALLBACK_ICON, GLYPH_NAMES, resolveGlyph, type GlyphName } from '../../design/icons/names';
import type { InstalledApp } from './app-index';

/** A glyph a tile can draw: the glyph set, or the fallback circle. */
export type TileGlyph = GlyphName | typeof FALLBACK_ICON;

/** What a tile shows. */
export interface TileIdentity {
  readonly tint: TintName;
  readonly icon: TileGlyph;
}

/** What an app's manifest asks for, resolved to names the system knows. */
export interface TileDeclaration {
  /** Best first, one to three tints, no repeats. */
  readonly ranked: readonly TintName[];
  readonly icon: TileGlyph;
}

/** How an install gets its tile: assigned against the installed apps, or fixed (a seeded example). */
export type TileRequest =
  | { readonly kind: 'assign'; readonly declared: TileDeclaration }
  | { readonly kind: 'fixed'; readonly tile: TileIdentity };

/** The seeded examples' tiles, keyed by seed id: distinct tints (each the tint nearest the
 *  example's shipped `tileColor`, so the legacy `tileColor()` path agrees) and distinct glyphs. */
export const EXAMPLE_TILES: Readonly<Record<string, TileIdentity>> = {
  'tip-splitter': { tint: 'slate', icon: 'receipt' },
  'water-counter': { tint: 'blue', icon: 'glass-water' },
  'style-gallery': { tint: 'orchid', icon: 'palette' },
};

/** The model ranks up to three tints (system.md §2.4). */
const MAX_RANKED = 3;

const TILE_GLYPHS: ReadonlySet<string> = new Set<string>([...GLYPH_NAMES, FALLBACK_ICON]);

export function isTileGlyph(value: unknown): value is TileGlyph {
  return typeof value === 'string' && TILE_GLYPHS.has(value);
}

export function isTileIdentity(value: unknown): value is TileIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const { tint, icon } = value as { tint?: unknown; icon?: unknown };
  return isTintName(tint) && isTileGlyph(icon);
}

/**
 * Read a manifest's tile declaration. `tint` may be one name or a ranked list (only the first three
 * count); every entry resolves through `resolveTint` (aliases, else the app id's fallback). With no
 * `tint`, an old hex `tileColor` ranks its nearest tint, else the app id's fallback does. `icon`
 * resolves through `resolveGlyph` (aliases, then keywords on the icon name and the app name, else
 * the circle). Never throws: the manifest is untyped wire data.
 */
export function declaredTile(manifest: object, appId: string, appName: string): TileDeclaration {
  const m = manifest as Readonly<Record<string, unknown>>;
  let names: readonly unknown[] = [];
  if (Array.isArray(m.tint)) names = m.tint;
  else if (m.tint != null) names = [m.tint];
  const ranked: TintName[] = [];
  for (const name of names.slice(0, MAX_RANKED)) {
    const { tint } = resolveTint(name, appId);
    if (!ranked.includes(tint)) ranked.push(tint);
  }
  if (ranked.length === 0) {
    const legacy = typeof m.tileColor === 'string' ? nearestTint(m.tileColor) : undefined;
    ranked.push(legacy ?? fallbackTint(appId));
  }
  const icon = resolveGlyph(typeof m.icon === 'string' ? m.icon : '', appName).name;
  return { ranked, icon };
}

/** The tints an app drawing `icon` may not take unless the person picks them (#127): each example
 *  whose glyph it is keeps its tint, so no declaration reproduces an example's tile. */
function exampleTintsFor(icon: TileGlyph): TintName[] {
  return Object.values(EXAMPLE_TILES)
    .filter((tile) => tile.icon === icon)
    .map((tile) => tile.tint);
}

/** `used` with each barred tint counted once more than there are installed apps, so it is never
 *  free and never among the least used while any other tint exists (at most three are barred). */
function withBarred(used: readonly TintName[], barred: readonly TintName[]): TintName[] {
  const weight = used.length + 1;
  return [...used, ...barred.flatMap((tint) => Array.from({ length: weight }, () => tint))];
}

function usedTints(installed: readonly InstalledApp[]): TintName[] {
  return installed.map((app) => tileOf(app).tint);
}

/** A new app's tile: the declared glyph, and the tint `assignTint` picks over the installed apps'
 *  tiles (first unused ranked tint, else the least used). Never an example's tile. */
export function assignTile(declared: TileDeclaration, installed: readonly InstalledApp[]): TileIdentity {
  const used = withBarred(usedTints(installed), exampleTintsFor(declared.icon));
  return { tint: assignTint(declared.ranked, used), icon: declared.icon };
}

/** A copy's tile: its original's glyph, and among the least used tints the one farthest from the
 *  original's. Never an example's tile. */
export function copyTile(original: InstalledApp, installed: readonly InstalledApp[]): TileIdentity {
  const from = tileOf(original);
  const used = withBarred(usedTints(installed), exampleTintsFor(from.icon));
  return { tint: farthestTint(from.tint, used), icon: from.icon };
}

export function resolveTileRequest(request: TileRequest, installed: readonly InstalledApp[]): TileIdentity {
  return request.kind === 'fixed' ? request.tile : assignTile(request.declared, installed);
}

/** The host's assignment for an app, without any override. A record from before tints existed has
 *  none stored: a seeded example reads its fixed tile; any other reads its manifest (an old hex
 *  `tileColor` maps to the nearest tint) the way an install would have ranked it. */
export function assignedTile(app: InstalledApp): TileIdentity {
  if (isTintName(app.tint) && isTileGlyph(app.icon)) return { tint: app.tint, icon: app.icon };
  if (app.example && Object.hasOwn(EXAMPLE_TILES, app.id)) return EXAMPLE_TILES[app.id];
  const declared = declaredTile(app.record.manifest, app.id, app.name);
  return {
    tint: isTintName(app.tint) ? app.tint : declared.ranked[0],
    icon: isTileGlyph(app.icon) ? app.icon : declared.icon,
  };
}

/** The tile an app shows: the person's override, else the host's assignment. */
export function tileOf(app: InstalledApp): TileIdentity {
  return isTileIdentity(app.tileOverride) ? app.tileOverride : assignedTile(app);
}
