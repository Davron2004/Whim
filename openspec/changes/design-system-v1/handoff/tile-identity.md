# Contract: tile-identity (chain-12)

Interface only. Pure host logic under `src/host/launcher/`, Node-importable (no React import).

## Record fields — `app-index.ts` `InstalledApp`

```ts
tint?: TintName;              // assigned at install / copy; absent only on records from before tints
icon?: TileGlyph;             // resolved at install / copy; same lifetime
tileOverride?: TileIdentity;  // "Customize tile"; wins over tint/icon; survives rebuilds
```

Never read these directly to draw a tile: use `tileOf(app)`. `AppRecord`/`AppManifest` are unchanged;
the declared `tint`/`icon` ride in `record.manifest` as the wire spreads them (untyped there).

## `tile-identity.ts`

```ts
type TileGlyph = GlyphName | 'circle';
interface TileIdentity { readonly tint: TintName; readonly icon: TileGlyph }
interface TileDeclaration { readonly ranked: readonly TintName[]; readonly icon: TileGlyph }
type TileRequest =
  | { readonly kind: 'assign'; readonly declared: TileDeclaration }
  | { readonly kind: 'fixed'; readonly tile: TileIdentity };

EXAMPLE_TILES: Readonly<Record<string, TileIdentity>>
  // 'tip-splitter' slate/receipt · 'water-counter' blue/glass-water · 'style-gallery' orchid/palette
  // (each tint = nearestTint of the example's shipped tileColor, so tileColor() agrees)
isTileGlyph(v: unknown): v is TileGlyph            // glyph set or 'circle' (never a chrome name)
isTileIdentity(v: unknown): v is TileIdentity
declaredTile(manifest: object, appId: string, appName: string): TileDeclaration
  // tint: string | string[]; first 3 entries, each via resolveTint (aliases; unknown → fallbackTint(appId)),
  // repeats dropped. No tint → [nearestTint(tileColor)] if a hex tileColor, else [fallbackTint(appId)].
  // icon: resolveGlyph(icon ?? '', appName).name. Never throws.
assignTile(declared, installed: readonly InstalledApp[]): TileIdentity     // assignTint over tileOf(installed)
copyTile(original: InstalledApp, installed): TileIdentity                  // tileOf(original).icon + farthestTint
resolveTileRequest(request: TileRequest, installed): TileIdentity
assignedTile(app: InstalledApp): TileIdentity     // stored tint/icon, else (legacy) EXAMPLE_TILES for an example,
                                                  // else declaredTile(app.record.manifest).ranked[0] / .icon
tileOf(app: InstalledApp): TileIdentity           // THE read path: valid override ?? assignedTile(app)
```

`used` for assignment and copies = `tileOf(a).tint` of every installed entry (repeats count; entries
armed for purge still count).

**#127 guard:** an assigned or copied tile never equals an `EXAMPLE_TILES` pair: a tint is barred
only for the glyph of the example that holds it (another glyph may take it; a fixed seed install and
a person's override may take anything).

## `StoreAccess` (`store-access.ts`)

- `InstallSpec.tile?: TileRequest` — absent → `{ kind: 'assign', declared: declaredTile(record.manifest, id, name) }`.
  `install` resolves it against `index.list()` (minus its own id) synchronously right before the
  index write, so concurrent installs can't take the same free tint. Writes `tint`/`icon`.
- `update(entry, spec)` — tile fields come from the index entry at write time (`index.get(entry.id) ?? entry`),
  not from the caller's `entry`: `tint`/`icon` = `assignedTile(current)` (a legacy record gets its
  read-path tile written down), `tileOverride` = current's (absent if cleared). A rebuild never re-assigns.
- `fork(entry, versionId?, opts?)` — every fork (copy or rewind continuation) gets `copyTile(current original, index.list())`;
  no `tileOverride`. `shareData` semantics unchanged (#52 D2 held).
- `deliverResult` (`build-lifecycle.ts`) passes `tile: { kind: 'assign', declared: declaredTile(wire.manifest, appId, wire.name) }`
  on a new install (the wire's declaration, never the record's injected ghost `tileColor`).
- `seedFirstRun` passes `{ kind: 'fixed', tile: EXAMPLE_TILES[id] }` for ids in the table.

## Override API (`AppIndex`)

```ts
setTileOverride(id: string, tile: TileIdentity): InstalledApp | null   // null: not installed
  // throws Error('not a tile: …') unless isTileIdentity(tile) (alias tints / chrome icons rejected)
clearTileOverride(id: string): InstalledApp | null
```

## Pending purge (`pending-purge.ts`, new) — D16

```ts
type PurgeKind = 'app' | 'attempt';
interface PurgeMarker { readonly kind: PurgeKind; readonly id: string; readonly entry?: InstalledApp }
class PendingPurgeStore {                     // over the launcher KV; keys `purge:app:<id>` / `purge:attempt:<id>`
  constructor(kv: KVBackend);
  armApp(entry: InstalledApp): void;          // Delete: stores the record (used if the index entry is already gone)
  armAttempt(id: string): void;               // Discard of a pending-build record (id may equal an app id)
  cancel(kind: PurgeKind, id: string): void;  // Undo; no-op if none
  has(kind: PurgeKind, id: string): boolean;  // Home hides apps / attempts with an armed purge
  list(): PurgeMarker[];
}
interface PurgeDeps { purges; index: AppIndex; access: StoreAccess; pending: PendingBuildStore; journal: RunJournalStore }
completePurge(deps, marker): Promise<void>
  // app: access.remove(index.get(id) ?? marker.entry) + journal.deleteLastRun(id)
  // attempt: dropPendingBuild(pending, id) + journal.delete(id)
  // marker cleared LAST; every step idempotent. Throws what the steps throw (marker kept).
completeInterruptedPurges(deps): Promise<void>   // at launch, before the first grid render; logs and
                                                 // keeps any marker whose purge fails, continues the rest
```

Arming deletes and hides nothing: the entry stays in the index (refcounts and Undo stay exact) until
`completePurge`. Callers own the 10 s / 6 s timers and the hiding.

## `tiles.ts#tileColor(name, manifest?)` (transitional, signature unchanged)

Returns `TINTS[t].light` where `t = nearestTint(manifest.tileColor) ?? fallbackTint(name)`. Never a
reserved hue. Not the assigned tile — current screens keep calling it until chain 21; new surfaces
use `tileOf`. `RESERVED_TILE_HUES` is gone; `ghostTileColorFor`, `monogram`, `manifest-tile-color.ts`
and `mapWireRecord`'s ghost `tileColor` injection are untouched.
