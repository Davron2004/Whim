# handoff: chain-F — tile colour plumbing and the `2b` app tile

Interface only. Source of record: `src/host/launcher/tiles.ts` (resolution), `src/host/bridge/contract.ts`
(the manifest field), `src/host/launcher/manifest-tile-color.ts` (the wire lift), `src/host/launcher/app-tile.tsx`
(the component).

## `AppManifest.tileColor` — the extended host-held field

```ts
// src/host/bridge/contract.ts
export interface AppManifest {
  capabilities: string[];
  tileColor?: string; // `#rrggbb`, host-held, harness-trusted — never re-derived from the bundle
}
```

The gate reads only this field. A generation-time producer already drops an absent, malformed, or
reserved-hue declaration before it reaches the wire/host (`handoff/wire-v2.md`) — this field can
still hold anything a caller puts there (e.g. a hand-written fixture), so it is not itself a
validity guarantee; `tileColor()` below is the one place that guarantee is enforced.

## `tileColor` — the single resolution path (`src/host/launcher/tiles.ts`)

```ts
export function tileColor(name: string, manifest?: Pick<AppManifest, 'tileColor'>): string;
export function monogram(name: string): string; // unchanged
```

Fallback order, exactly two steps: `manifest?.tileColor` when present, a valid `#rrggbb` hex
(case-insensitive), and not equal to a reserved hue (`STATUS_COLORS`/`STATUS_COLORS_ON_INK`/
`SHELL_COLORS.accent`/`SHELL_COLORS.yours`/`SHELL_COLORS.yoursOnDark`, all from `../../sdk/theme`)
→ else `appColor(name)`. `manifest` is optional so the pre-existing single-arg call sites (e.g.
`HomeScreen.tsx`'s current `tileColor(app.name)`) keep compiling and behaving unchanged until they
migrate to pass a manifest. This is the ONE path the grid, the history header, and the Whim Syntax
prose renderer (`ProseApp.color`, chain-B's `lex.ts`) must resolve an app's colour through — never
a second name→colour map. Pass `app.record.manifest` (the `InstalledApp` shape) as the second arg.

## `liftManifestTileColor` — the wire → host-record lift (`src/host/launcher/manifest-tile-color.ts`)

```ts
export function liftManifestTileColor(wireManifest: Record<string, unknown>): { tileColor?: string };
```

Straight passthrough of a `string`-typed `tileColor` key from a `WireAppRecord.manifest`-shaped
object (`z.record(z.string(), z.unknown())` on the wire) — does **not** re-validate hex format or
reserved hues (the server already did, per `handoff/wire-v2.md`). Non-string/missing → `{}` (no
key at all, not an explicit `undefined`). Spread the result onto the mapped `AppManifest`:

```ts
manifest: { ...(wire.manifest as unknown as AppManifest), ...liftManifestTileColor(wire.manifest) }
```

`tileColor()` above is still the thing that enforces validity on whatever ends up in
`AppManifest.tileColor`, regardless of source — this function only relocates the value.

## `AppTile` — the `2b` ghost-letterform tile (`src/host/launcher/app-tile.tsx`, default export)

```ts
export const APP_TILE_SIZE = 88;         // px, the tile square's width/height
export const APP_TILE_RADIUS: number;    // = RADIUS.tile (22px), re-exported value, not restated

export interface AppTileProps {
  name: string;
  manifest?: Pick<AppManifest, 'tileColor'>;
}
export default function AppTile(props: Readonly<AppTileProps>): JSX.Element;
```

Renders: a square `APP_TILE_SIZE × APP_TILE_RADIUS`-radius view filled with `tileColor(name,
manifest)`, a small foreground monogram bottom-left (19px/600/white), the same monogram blown up
bleeding off the top-right at 16% white, a 1px inset white border at 30% opacity, and the app's
name below the tile (never inside it). Purely presentational — no press handling, no example
badge; the caller (group D) wraps it for tap/long-press and composes any badge overlay itself. A
skeleton MUST import `APP_TILE_SIZE`/`APP_TILE_RADIUS` rather than restating them.
