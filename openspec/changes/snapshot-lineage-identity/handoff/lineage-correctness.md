# Handoff: engine-level lineage correctness (chain-1 → chain-2, chain-3)

Interface only. Implementation lives entirely in `src/host/version-store/engine.ts`
(+ `index.ts` unchanged — no new exports). Public surface, signatures, and error
contracts below are unchanged from before this chain unless explicitly called out.

## What changed (post-fix invariants)

- `timeline(appId, opts?)` and `rollback(appId, snapshotId)` are now **lineage-correct**,
  not just DAG-same-line: a DAG-descendant of the active tip is only kept/accepted if it
  was actually created as a continuation of the active lineage. Concretely:
  - An **ancestor** of the active tip (or the tip itself) is always included/accepted —
    shared history predates any lineage split, so its own creation-time stamp is
    irrelevant.
  - A **descendant** of the active tip (a roll-forward candidate) is only
    included/accepted if its stamped creating lineage equals the active lineage
    (`git.currentBranch() || 'main'`). A sibling fork's commit, or the original's commit
    made after this lineage forked away, is excluded/refused even though it is
    DAG-reachable from a shared ancestor.
- Fixes both previously-over-including cases:
  - **Non-diverged fork**: fork checked out at the fork point with no snapshot of its
    own yet — `timeline()` on the fork no longer shows the original's later snapshots.
  - **Rolled-back original**: original rolled back to at/before a fork point —
    `timeline()` on the original no longer shows the fork's snapshots. (The original's
    OWN later snapshots, made before any fork existed, are still listed as valid
    roll-forward targets — unchanged from before this chain.)
- `rollback()`'s refusal uses the identical predicate, so it can no longer land on
  another lineage's snapshot even when that snapshot is DAG-reachable.

## Unchanged (do not need re-verification downstream)

- `Snapshot` shape: `{ id: string; prompt: string; createdAt: number }` — unchanged.
- `StoreAccess.timeline` / `StoreAccess.history` signatures and the launcher's
  `access.timeline(app)` / `access.history(app)` call shape — unchanged; no engine
  signature changed, only the set of results.
- `history()` is untouched (still a pure tip-ancestry walk) except that it now strips
  the lineage trailer out of `prompt` like every other read path — its own enumeration
  semantics and error/edge contract are unchanged.
- `rollback()`'s error message text and refusal contract are byte-identical:
  `` `snapshot ${snapshotId} is not in the active lineage — use fork or switchLineage to reach another lineage's history` ``
  — still names `fork`/`switchLineage`, still contains no git vocabulary
  (`assertNoGitLeak`-equivalent regex `!/\b(commit|ref|branch|ancestor)\b/i` still holds).
- Single-lineage behavior (an app never forked): `timeline()`/`history()` return
  byte-identical arrays across rollbacks, same as before this chain.

## The lineage marker never surfaces

- Recorded as a commit-message trailer written by `snapshot()`, sentinel-delimited
  (ASCII Record Separator, `\x1e` — not typable, so a prompt that itself contains a
  trailer-shaped LINE of prose round-trips byte-identically; only the sentinel byte is
  ever split on).
- Stripped before `Snapshot.prompt` is built at every read site (`history`, `timeline`,
  `getSnapshot`/`active`/`getPinned` via `snapshotContent`). Never appears in any
  returned value or in the `rollback()` refusal message.
- A pre-existing, un-stamped commit (any repo/fixture from before this chain) is treated
  as lineage `'main'` — pure runtime fallback, no migration/backfill needed or performed.

## Why the launcher's interim fork guard is now safe to remove

`history-logic.ts`'s `app.storeId != null ? access.history(app) : access.timeline(app)`
branch exists **only** because pre-fix `timeline()` could over-include a sibling fork's
or the original's post-divergence snapshots for a fork entry (the "known gap" it cites).
That gap is closed: `timeline()` is now lineage-correct for exactly the two cases the
guard was hedging against. Chain-2 can call `access.timeline(app)` unconditionally for
every entry (fork or original alike) and get full roll-forward with no cross-lineage
leakage.

## Test coverage added (src/host/version-store/test/acceptance.ts)

New `§lineage-stamp:*` / `§lineage-correctness:*` cases cover: the trailer is recorded
at `snapshot()` time; a trailer-shaped prompt round-trips byte-identically through
`snapshot`/`history`/`timeline`/`getSnapshot`; the non-diverged-fork exclusion; the
rolled-back-original exclusion; the off-lineage `rollback()` refusal; the legacy
un-stamped-commit → `main` fallback. All existing `§timeline:*`/`§ST-6*` cases are
unmodified and still green (112 checks passed, 0 failed — up from the prior 98).
