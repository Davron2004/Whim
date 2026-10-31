# Handoff: chain-1 (launcher-index-authority)

Tasks 1.1–1.5, 2.1, 2.2 done. 2.3 is the orchestrator's (not done here). tasks.md not ticked.

## What
- `store-access.ts`: new exported `AppGoneError extends Error { readonly appId: string }` (name `'AppGoneError'`).
  Private `indexed(entry)` returns `index.get(entry.id)` or throws `AppGoneError`. It is the first
  statement inside `serial` of `update` (above `ensureLineage`), `fork` and `continueSharingData`
  (above `forkLineage`). `update` keeps the caller's spread (§34: name unrefreshed) and its post-snapshot
  re-read for the tile, and now sets `storageGroupId` from that record (present or absent), like
  `tileOverride`. `fork`/`continueSharingData` run `forkLineage`, `lineageEntry` and `engineAppId`
  on the index's record. `remove`, `deliverResult` unchanged.
- `app-index.ts` `put`: appends the id to `order` first when `order` lacks it, then writes the record
  (one record write, no order write, for an id already in `order`).
- New `test/shared-group.suite.ts` (registered after `runSavedDataTests` in `acceptance.ts`): every case
  in tasks 1.3–1.5. The deleted-build case runs 4 variants (at/behind tip × founder gone/present); the
  died-purge case runs 4 (entry indexed/removed × founder present/gone).
- Task 1.5: `StoreAccess.hasSavedData(b)` answers `true` for a sharer whose group store holds a kv value
  and a row, and creates no file under B's id. Chain-3's call site already asks of `engineAppId(entry)`;
  no fix needed.
- `docs/decisions.md` #85; `docs/capabilities.md` linked-apps line extended (2.2's words verbatim).
- No existing launcher fixture needed changing (the full suite passed unedited).

## Files
src/host/launcher/store-access.ts, src/host/launcher/app-index.ts,
src/host/launcher/test/shared-group.suite.ts, src/host/launcher/test/acceptance.ts,
docs/decisions.md, docs/capabilities.md, this file.

## Exit codes
- `npm run launcher:test -- --only shared-group`: 0 (19 tests).
- `npm run launcher:test` (full, `--mb 4096`): 0 (20165 checks passed, 0 failed).
- `npm run -s typecheck`: 0. `npx eslint --max-warnings 0` (4 touched TS files): 0. Storage suite not run (untouched).
- `openspec validate separate-shared-data --strict` on 1.4.1 (`npx openspec`): 0. On 1.14.1 without
  `--strict`: 0 with two warnings (requirement text > 500 chars); 1.14.1 `--strict` exits 1 on those
  same warnings (spec text is the planner's, not in this chain's files).

## Red-checks (each restored from a saved copy; `cmp` confirmed)
1. `update` as at BASE (no index check, caller's group): fail
   `index authority: the caller's object cannot move an app between stores`,
   `index authority: a build that lands after its app was deleted writes nothing (at its tip, founder gone)`,
   `... (at its tip, founder present)`. 277 passed, 14 failed.
2. `fork`/`continueSharingData` as at BASE (`source = entry`): fail
   `... writes nothing (behind its tip, founder gone)`, `... (behind its tip, founder present)`,
   `index authority: a copy is not made from an app the index no longer holds`. 13 failed.
3. `put` as at BASE (`git show 124e5173:…app-index.ts`): fail
   `index: a kill between the two writes of a new entry leaves no entry, and the sweep takes the copy's store`
   (a fresh launcher still reports the entry; sweep keeps `a__fork-2.db`; later puts not listed). 5 failed.
4. `update` drops `storageGroupId`: fail `index authority: a rebuild keeps a sharer in its group…`,
   `index authority: a continuation's first build lands in the original's group`, plus the
   caller's-object and going-back cases.

## Deviations
- [A] "stale-object case" in 1.3's red-check sentence read as the caller's-object case (the only one on
  `update`); the stale-`fork` case is red-checked separately (2).
- [A] The kill case dies on the second index write (`order` / `app:` key) of the armed launcher KV;
  every later KV write and store delete throws too (the process is dead), as in `data-copy-crash.suite.ts`.

## For the orchestrator
- 1.14.1 `--strict` warnings on the delta spec's two long requirements: shorten in the spec if the gate
  uses 1.14.1 strict (`gate-full.sh` runs `npx openspec`, i.e. 1.4.1, which passes).

## Fix pass (review findings 1–4)
1. [A] D8 reading: the app's deletion makes the change moot. `LauncherRoot.settleAppGone`: an `AppGoneError`
   delivery drops the attempt like a stopped change (record + journal; leftovers armed as a Discard's purge);
   a person watching its Making page is taken Home. D8's sentence amended. Test: `changing in use: a change
   that lands after its app was deleted (…)`, 4 variants (tip/behind × Making page/Home) on the rendered shell.
2. `update`'s second read and `lineageEntry` now call `indexed(entry)` (throws `AppGoneError`), no fallback.
3. Died-purge cases hash the group file before `fork` and compare right after it.
4. `AppIndex.put` leaves an unreadable `order` as it is (logs `app order left as it is: it is unreadable`);
   a non-list `order` now logs as unreadable too. Test in `app-index.suite.ts`.
Red-checks: old settle path → 4 variants fail (failed record + journal left; Making-page variants end on the
Failure page); `put` via `readOrder()` → both unreadable inputs fail (order overwritten to `["a","c"]`).
Exit codes: targeted suites 0 (492 checks), full launcher suite 0 (20203 checks), typecheck 0, eslint 0, openspec 1.4.1 --strict 0, 1.14.1 0 (2 known warnings).

## Fix pass 2 (re-review findings)
1. `specs/pending-builds/spec.md` (new MODIFIED delta): the deletion requirement gains "its app was deleted before delivery" and a
   scenario "A late delivery for a deleted app removes the record"; the failure requirement says dropping such a record is not a failure.
   Both ≤500 chars, live headers and scenario names kept.
2. Stale "fails like any failed delivery / ends as a failed attempt" reworded to the amended D8: design.md Risks, proposal.md, decisions.md #85, tasks.md 1.1.
3. `changing-in-use-ui.suite.tsx`: case list `DELETED_APP_CASES` (flat, replaces the nested loops) gains a variant where storage refuses the record's
   removal: `settleAppGone` → `purgeLeftover` arms the attempt purge, the next launch clears it. Helpers keep the suite under the complexity limit.
4. A comment says the delete is simulated through `completePurge` (no menu reaches this state, D8).
Red-check: `purgeLeftover` made a no-op → the new variant fails (purge never armed). Exit codes: targeted 0 (338), full launcher 0, typecheck 0, eslint 0, openspec 1.4.1 --strict 0, 1.14.1 0 (2 known warnings, not in this delta).
- Archive note: update pending-builds Purpose (deletion triggers)
