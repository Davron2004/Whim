# Chain 3b1r: hasSavedData per ruling 40 REVISED (rework of task 3.0's storage half)

## Step 0: YES
The host can tell "did any version ever declare storage" without the store file: each index
entry's `record.manifest` answers every app that declares storage now, with no I/O. Only when no
sharer's record declares it does `StoreAccess` walk the timelines (stops at the first declaring
version), reading each version through the per-repo memo `declaredSchemas` uses (`declarationOf`).

## What changed
- `StoreAccess.hasSavedData`: `everDeclaredStorage(entry)` first (records of the entry + same-repo,
  same-group sharers, then their timelines; a manifest-less legacy version counts as declaring).
  None → `false`, the injected read is never called. Otherwise the read, as 3a. Failure → `true`.
- Storage-engine read: open → SELECT → close, never deletes (`readSavedData` replaces `settleProbe`).
  The Node variant creates a missing file like op-sqlite, so suites match the device.
- Device steps `saved-data-device-acceptance.ts` (verdict `savedData`), wired into
  `runStorageDeviceAcceptance`. Not run (chain-5). tasks.md:67 reworded. Delete path dropped.

## Files
src/host/launcher/store-access.ts and its saved-data suite · src/host/storage-engine/saved-data*.ts, index.ts,
device-acceptance.ts and their suite · openspec/changes/copy-app-data/{tasks.md,handoff/*}

## Citation: a 0-table file initialises normally
`engine.ts:81-83` (`CREATE TABLE IF NOT EXISTS`) and `engine.ts:58-66` (`emptyApplied()` when `_meta` is absent).

## 3b2 at merge
fork-ui "nothing saved → fresh, no `timer.db`" HOLDS. Fixtures expecting the question for a
`capabilities: []` record BREAK: give them `manifest: { capabilities: ['storage'] }`.

## Deviations
- [A] Node `createNodeHasSavedData` creates a missing file (was: existence check); the no-file
  guarantee moved to `StoreAccess` and is tested there. [A] memo `schemas` → `declarations`.
- Ratchet: storage suite 29→26 assertions / 10→9 tests (delete-path tests), accepted by the
  orchestrator; the fix commit carries the `Check-removal:` trailer.

## Fix pass (review-3b1r.md)
- MED 1 done: launcher test "a group member whose own versions never declared storage sees the
  founder's data" (founder record; then a founder version newer than the branch point, fresh memo).
  Red-check `members = [entry]` → EXIT 1, 4 failed (both halves).
- MED 2: blocked then (no single-file read), resolved by piece 2 below.
- LOW 3-6 done: `StoreContents` = `'empty' | 'data'`; device steps clean up in `finally` and report
  every check; `has-saved-data.md` gained the fixture line and the Known limit.

## Piece 2 (ruling 41): MED 2 done, resolves #212
- Version store verb `declarationOf(appId, snapshotId): Promise<Declaration>`, `Declaration =
  { manifest: string | null; schema: string | null }` (text as saved; `null` = file absent). Reads the
  snapshot's top-level tree, then only the `manifest.json` / `schema.json` blobs. Unknown snapshot →
  `unknown snapshot: <id>` (as `getSnapshot`). No path argument, no git vocabulary.
- `StoreAccess.declarationOf` (the per-repo memo) now reads through it (`parseDeclaration`), so both
  `everDeclaredStorage` and `declaredSchemas` never load code. `rollback`/`forkLineage` unchanged.
- Spec delta `specs/mini-app-versioning/spec.md` (ADDED requirement; the live spec lists verbs).
  design-system-v1 also has a MODIFIED delta on that capability (timeline); no overlap.
- Tests: vstore "declarationOf returns…never reads its code" + "rejects an unknown version"; launcher
  saved-data "walk and declaredSchemas read each version's manifest and schema once per process".
  `version-record.suite.ts` `countSnapshotReads` also counts the new verb.
- Red-checks: verb reads via `getSnapshot` → vstore 2 failed, exit 1; memo back on `getSnapshot` →
  launcher `--only saved-data,store-access` 4 failed, exit 1.
- Checks (capped-run): vstore 0 (118) · storage 0 (304) · launcher `--only saved-data,store-access` 0 (333),
  `--only version-record` 0 (229), full 0 (19870, `--mb 4096`: 2048 CAPPED) · typecheck 0 · eslint touched 0 · openspec 1.4.1 --strict 0, 1.14.1 0.
- Proposed decision line (decisions.md not edited): "Version store gains `declarationOf(app, version)`
  → manifest + schema text only; a narrow product verb, never a read-by-path (ruling 41, #212)."
