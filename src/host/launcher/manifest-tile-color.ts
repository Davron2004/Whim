/**
 * manifest-tile-color — lifts the wire manifest's declared tile colour onto the host record
 * (shell-redesign-v2 chain-F, task F5). The generation server already validates a declared
 * `tileColor` and drops it — silently, no diagnostic — when it is not a `#rrggbb` string literal
 * or collides with a reserved hue (`handoff/wire-v2.md` "tileColor — inside the manifest, nowhere
 * else"): the device sees either a usable colour or none. This module does the straight lift from
 * the wire's untyped `manifest` record to the host-held `AppManifest['tileColor']` field — it does
 * NOT re-validate, so it stays a pure, one-line, easily testable seam rather than a second
 * hex/reserved-hue check duplicating the server's. (`src/host/launcher/tiles.ts#tileColor` is the
 * separate, defense-in-depth resolution helper every render surface calls; it validates whatever
 * lands in `AppManifest.tileColor` regardless of where that value came from.)
 *
 * Pure and dependency-free — no React import — so it is unit-testable without mounting the shell.
 * Group D calls it from its own wire -> `AppRecord` mapping (`LauncherRoot.tsx#mapWireRecord`).
 */

/** Lift a wire `WireAppRecord.manifest`'s declared tile colour, if any. `wireManifest` is the
 *  untyped record the wire carries (`ManifestShape = z.record(z.string(), z.unknown())`) — any
 *  shape reaches this function, so it narrows defensively: only a `string` value under the
 *  `tileColor` key is lifted, spreadable straight onto the host-held `AppManifest`. */
export function liftManifestTileColor(wireManifest: Record<string, unknown>): { tileColor?: string } {
  const raw = wireManifest.tileColor;
  return typeof raw === 'string' ? { tileColor: raw } : {};
}
