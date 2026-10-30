# tilecolor-removal handoff (PO ruling 24, plus ruling 16)

Branch `chain/design-system-v1-tilecolor`, BASE `f7cef4f8`. STATUS: complete.
Commits: `826f821c` (spec deltas), `8b8fbc04` (code, docs, tests; Check-removal trailer), this handoff.

## Spec requirements changed (design-system-v1 deltas only; live specs untouched)
- app-launcher: "The host assigns each app's tint" (ADDED): a record with no stored or declared tint shows its
  app id's fallback tint; a `tileColor` is ignored. Scenario "An old hex record maps to a tint" rewritten as
  "An old hex record shows its fallback tint" (ADDED block, so renaming is allowed).
- generation-pipeline: "The delivered app record is harness-validated" (MODIFIED): a deprecated `tileColor` SHALL NOT
  be extracted or delivered. The live scenario name "A reserved or malformed colour is dropped" is kept, with new
  content: any `tileColor` (valid, malformed, reserved) leaves no `tileColor` in the manifest and no diagnostic.
- generation-contract: "Wire app record" (MODIFIED): `manifest` SHALL NOT carry `tileColor`; the host ignores one.
- sdk-design-system: REMOVED "An app declares its one tile colour", Migration rewritten (accepted and ignored,
  tile = declared tint else fallback). ADDED "The SDK adds components and deprecates without removing": `defineApp`
  keeps accepting `tileColor` and ignores it (no export removed; no visible effect implied).
- prompt-flow: "The Making page shows honest progress without internals" (ADDED): "no frame" → "no progress event".
  Only that phrase changed.

## Code removed / changed
- Checker: `extractTileColorField` and `ExtractedManifest.tileColor` gone (`checks/passes/manifest-extraction.ts`,
  `checks/contract.ts`). A `tileColor` property in `defineApp` is now ignored with no diagnostic.
- Server: only a comment in `server/src/generation/stages/check.ts` (the passthrough was the checker field).
  `prompts/index.ts` "Never declare `tileColor`" is a producer instruction, not a reader: kept.
- Contract: `contract/src/index.ts` comment only (the wire `manifest` was always an untyped record).
- Bridge: `AppManifest.tileColor` removed (`src/host/bridge/contract.ts`).
- Launcher: `declaredTile`'s hex→`nearestTint` branch gone (`tile-identity.ts`); `mapWireRecord` passes the wire
  manifest through with no tileColor lift (`build-lifecycle.ts`); `store-access.ts` no longer strips tileColor from
  `manifest.json` or old saved manifests, and `versionRecord` no longer carries the current record's tileColor.
- `nearestTint` deleted from `src/design/tints.ts` (no other user; knip clean).
- SDK: `defineApp` `tileColor?: string` kept, JSDoc now says it is accepted and ignored.
- Docs: `docs/capabilities.md` (generation-contract line), `docs/design/system.md` §2.4 and §7.2 table,
  `handoff/tile-identity.md` (`declaredTile` line).

## What stays, and why
- SDK `defineApp` `tileColor` type: sdk-design-system "No export SHALL be removed"; still absent from sdk-reference.
- `build/build.mjs` `TILE_FIELDS = ['tileColor', 'tint', 'icon']` and its comment at :91: CONFIG_SET, not approved.
  The `tileColor` entry is now a dead filter (the checker never emits it). Remove it in an approved build.mjs edit.
- Release fixtures `checks/test/release/fixtures/**/whim.launcher`: kept as snapshots. No assertion reads their tile.
- The host does not strip an unknown `tileColor` key from a stored or wire manifest. It is ignored like any other
  unknown key. A legacy record keeps the field until its next rebuild or version switch rewrites the record.

## Tests replaced (all on the new behaviour)
- tile-colour.suite: 3 legacy-hex tests → 1: no `tileColor` value (nine other tints' light values, every reserved
  hue, non-hex, non-string) changes the ranking from the app id's fallback. The `declaredTile` ranked-names test and
  the `tileOf` old-record test now expect the fallback, with a sanity check that the colour's tint differs from it.
- build-lifecycle.suite: 6 legacy tests → 4: mapWireRecord round-trip (manifest kept, schema only with keys); an
  install whose wire has only a hex gets the fallback; at-tip/behind-tip rebuild routing (#52 D2, tileColor line
  dropped); a pre-tint record with a stray colour keeps its fallback tile through a rebuild that ranks another tint.
  Removed: "a rebuild whose wire declares a colour records it" (obsolete).
- store-access.suite: pre-tint rebuild test reads the fallback. version-record.suite: the launch runs the saved manifest.
- checks acceptance: new test, `defineApp` with `tileColor` gives the same manifest and diagnostics as without it.
- wire-v2.suite: a `tileColor` declaration still extracts a manifest, and it equals the manifest without one.
- app-spec.acceptance: a tileColor-only `defineApp` ranks only its fallback (sanity: not 'orchid', the old pick).
- tints.acceptance: the `nearestTint` block removed (function deleted).

## Red-checks
Restored the BASE `tile-identity.ts` + `tints.ts` (the hex→nearestTint branch), then the BASE checker
(`manifest-extraction.ts` + `checks/contract.ts`); restored with `git checkout --` after. Red runs:
- sdk:test EXIT=1: app-spec "a tileColor-only app ranks only its fallback tint".
- launcher:test: tile-colour stray-colour test (9 ✗, one per other tint), declaredTile fallback line, tileOf old
  record; build-lifecycle "stray colour" install and "pre-tint record" precondition; store-access pre-tint precondition.
- checks:test EXIT=1 (427 pass, 1 fail): "a deprecated tileColor is ignored" (tileColor extracted).
- server:test: wire-v2 "…which carries no tileColor and equals the manifest without one" XX.
Not red-checked: the version-record rewrite and mapWireRecord round-trip (current, not legacy, behaviour).

## Suites (capped-run.sh, logs in the run scratchpad `verdicts/tilecolor-*.log`)
build 0 · typecheck 0 · lint 0 · knip 0 · tokens --check ok · checks:test 0 (428 pass) · server:test 0 (5172 passed)
· launcher:test 0 (19584 checks) · sdk:test 0 · bridge:test 0 (85). Red runs: launcher 1, sdk 1, checks 1, server killed after its XX.

## openspec
- 1.4.1 `validate design-system-v1 --strict`: valid. `validate --all --strict`: 71 passed, 0 failed.
- 1.14.1 `validate design-system-v1`: valid (only the >500-char warnings, already ruled acceptable).

## Removal ratchet
`node scripts/removal-ratchet.mjs --base f7cef4f8 --head HEAD`: PASS. Authorised by the trailer on `8b8fbc04`:
build-lifecycle.suite (assertions 151→145, tests 43→41), tile-colour.suite (44→42, 12→10), tints.acceptance (36→32).

## Open questions
- None blocking. The dead `build/build.mjs` `tileColor` entry needs an owner-approved CONFIG_SET edit.

## Fix pass (review-tilecolor.md findings 1-7)
Commits: `1ed08687` (all findings), then the version-record test correction + this section (see `git log`).
- 1 proposal.md and design.md: a `tileColor` is accepted and ignored; a tint-less record shows its fallback tint.
- 2 handoff/generator.md: `ExtractedManifest.tileColor` line gone; wire lines no longer name `manifest.tileColor`.
- 3 handoff/sdk-components.md: JSDoc quote matches `src/sdk/index.tsx`.
- 4 tasks.md 12.2: "superseded by ruling 24" note only; no tick changed.
- 5 docs/decisions.md: new entry #83 (supersedes #75, the entry at :1470).
- 6 version-record.suite: the index record now carries a newer manifest (`capabilities` storage+cues) via `index.put`
  before `activeLaunch`; the launch must still return the saved one. (The first attempt passed a modified entry; that
  did not discriminate because `readActive` prefers the index record. Caught by the red-check.)
- 7 Nothing passes `#rgb` (`git grep`: only an unrelated RN style literal), so the 3-digit branch in `src/design/tints.ts`
  is removed; tints.acceptance now asserts `deltaE('#fff', '#FFFFFF')` is refused.
Red-checks: restoring the 3-digit branch fails sdk:test (EXIT=1, "a short #rgb is refused ... threw """). Making
`versionRecord` use `current.manifest` fails launcher:test with "the launch runs with the manifest the version saved,
not the index record's" (the old assertion could not fail). Both restored with `git checkout --`.
Suites: launcher:test 0, sdk:test 0 (before the test-only correction), typecheck 0, openspec validate --strict 0.
No test or assertion count dropped; no trailers.
