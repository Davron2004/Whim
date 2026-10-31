# Review: tileColor removal (`f7cef4f8..584d20db`)

Reviewer: Opus, effort high, 2026-10-30. Saved by the integration orchestrator (the reviewer has no write tool).

VERDICT: findings (0 HIGH / 2 MEDIUM / 5 LOW). Specs, code and tests conform; the handoff is honest.

## Conforms
- Deltas agree across app-launcher :349/:361 (ADDED block, rename fine), generation-pipeline :17/:46-48 (MODIFIED, live scenario name kept), generation-contract :12, sdk-design-system :82/:176 ("accepted and ignored"). SHALL on line 1. No live spec / other change edited. Ruling 16 (prompt-flow :104) is exactly "no frame" → "no progress event".
- Code: `tileColor` remains only in the SDK type (`src/sdk/index.tsx:170`), the prompt's "Never declare" line (`server/src/generation/prompts/index.ts:470`), `build/build.mjs:91,113` (CONFIG_SET, acknowledged), release fixtures, history docs. `ManifestShape` is `z.record(z.string(), z.unknown())` (`contract/src/index.ts:131`): a stray `tileColor` passes untouched, nothing throws; `declaredTile` ignores it. vc-sdk surface unchanged.
- Removed assertions → where their live behaviour is pinned now: reserved hue never shown (tile-colour.suite.ts:59-67); mapWireRecord keeps the manifest (build-lifecycle.suite.ts:244-250); tip routing kept (:261-281); rebuild records the new wire manifest (version-record.suite.ts:319, :452). New tests fail if the legacy branch returns. Check-removal trailers justified (build-lifecycle 43→41 tests, tile-colour 12→10, tints.acceptance 36→32 assertions).

## MEDIUM
1. `openspec/changes/design-system-v1/proposal.md:22` ("installed hex colours map to the nearest tint") and `design.md:184-187` ("keep working through the nearest-tint mapping", "hex records are mapped on read") describe the removed path as current. Done: both say a `tileColor` is accepted and ignored and a tint-less record shows its app id's fallback tint.
2. `openspec/changes/design-system-v1/handoff/generator.md:10,26` (interface contract) still declares `ExtractedManifest.tileColor` "carried verbatim" and a wire `manifest.tileColor`. Done: field gone; lines say it is not extracted.

## LOW
3. `handoff/sdk-components.md:37` quotes the old JSDoc ("maps to the nearest tint"). Done: matches `src/sdk/index.tsx:168-169`.
4. `tasks.md:100` (ticked 12.2) says "hex `tileColor` records resolve with `nearestTint` on read". Done: a "superseded by ruling 24 (tileColor removal piece)" note.
5. `docs/decisions.md:1470` says installed hex colours map to the nearest tint. Append-only: add a NEW entry recording ruling 24; don't edit that line.
6. `src/host/launcher/test/version-record.suite.ts:378-379`: `app.record.manifest == manifestFile` can't fail (:377 shows the seeded record's manifest equals the saved one). Done: the current record gets a manifest that differs from the saved one (e.g. extra capabilities) so the assertion discriminates, or the claim leaves the test name.
7. `src/design/tints.ts:76-83` parses short `#rgb`, but its only test went with the `nearestTint` block. Done: tints.acceptance tests the short form directly (e.g. `deltaE('#fff', '#FFFFFF') === 0`), or the 3-digit branch is removed if nothing passes short hex.

Informational: `store-access.ts` no longer strips the field, so a `tileColor` from an older server is saved into a version's `manifest.json` and passed to the bridge; nothing reads it (handoff :40-41).
