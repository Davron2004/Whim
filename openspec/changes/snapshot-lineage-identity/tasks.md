# Tasks: snapshot-lineage-identity

## 1. English test specs (§16.5 — before any implementation)

- [ ] 1.1 Spec the lineage-correctness tests in English in the vstore suite area: non-diverged fork excludes the original's later versions; rolled-back original excludes a diverged fork's versions; `rollback` refuses an off-lineage target (error still names fork/switch-lineage, no git vocab); no lineage stamp leaks into `prompt` (round-trip a prompt that itself contains a trailer-shaped line); single-lineage flows byte-identical across rollbacks; legacy un-stamped commit → treated as `main`

## 2. Lineage stamp: write + strip-on-read (TDD, design D1/D2)

- [ ] 2.1 Write red tests against a stamped `snapshot()`: the creating lineage is recorded; `history`/`timeline`/`getSnapshot` return `prompt` with NO stamp (including a prompt that contains a trailer-shaped line, which must round-trip byte-identically)
- [ ] 2.2 Implement in `src/host/version-store/engine.ts`: `snapshot()` reads `git.currentBranch()||'main'` and appends the sentinel-delimited lineage trailer to the commit message; add a strip helper and apply it wherever `Snapshot.prompt` is built (`history`/`timeline`/`snapshotContent`); keep `assertNoGitLeak` intact; all 2.1 tests green, `npm run vstore:test` green

## 3. Lineage-correct predicate for `timeline` + `rollback` (TDD, design D3/D4)

- [ ] 3.1 Write the 1.1 red repro tests against `timeline`/`rollback`: the non-diverged-fork case and the original-rolled-back-past-a-fork-point case (both currently over-include); the off-lineage `rollback` refusal; the legacy-un-stamped→`main` fallback
- [ ] 3.2 Implement `lineageOf(gitdir, oid)` (read the commit trailer via `git.readCommit`, `'main'` fallback, memoized per enumeration) and tighten both `isSameLine` call sites — `timeline()` keeps a candidate iff `isSameLine(...) && lineageOf(candidate)===activeLineage`, `rollback()` gates identically; all 3.1 tests green, `npm run vstore:test` green

## 4. Retire the version-history-ux interim UI guard (design D6)

- [ ] 4.1 Remove the `app.storeId != null ? history() : timeline()` fork guard in `src/host/launcher/history-logic.ts` so fork entries use `timeline()` with full roll-forward; update the launcher acceptance tests to assert a fork entry now lists its own line via `timeline()` (lineage-correct) and the F1-repro test reflects the fixed behavior; `npm run launcher:test` green

## 5. Docs and closure

- [ ] 5.1 Append the decision-log entry (per-snapshot lineage stamp mechanism; `timeline`/`rollback` lineage-correctness; UI-guard retirement) to `docs/decisions.md`, AND correct decision #48's "deferred to linked-apps-data-model" note (F1 is orthogonal — that change is SQLite storage-group sharing)
- [ ] 5.2 On-device acceptance (attended, human-run): fork an app, add versions on the original, open History on the fork → only the fork's own line; roll the original back past the fork point → the fork's versions are not listed/restorable; record `timeline` latency against #39's numbers (design D5)
