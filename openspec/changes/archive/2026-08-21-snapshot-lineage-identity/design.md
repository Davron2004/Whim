# Design: snapshot-lineage-identity

## Context

The version store decides "same lineage" for `timeline` and `rollback` via pure DAG ancestry (`isSameLine`, research.md), which cannot see branch identity. A lineage is just a git branch ref; snap tags are global (`whim/snap/gN`); commits carry no lineage stamp; no reflog is read — so a snapshot's originating lineage is unrecoverable from current state (research.md, Current behavior). This over-includes a sibling fork's versions and, because `rollback` shares the predicate, can restore an app onto another lineage's code. `version-history-ux` shipped an interim UI guard (fork entries list via `history()`, losing fork roll-forward); this design fixes the engine so that guard can be retired. Root cause and the proof that no state-free fix exists are in the proposal and `version-history-ux`'s F1 findings.

## Goals / Non-Goals

**Goals:**
- Per-snapshot lineage identity so `timeline`/`rollback` are lineage-correct across fork + rollback interactions.
- Zero surface leakage — the lineage marker never appears in `Snapshot.prompt`, any returned field, or any error (#36 D3).
- Byte-identical single-lineage behavior; additive-only (`Snapshot` shape unchanged).
- Retire `version-history-ux`'s interim UI guard.

**Non-Goals:**
- No change to the public shapes of `snapshot` / `history` / `fork`.
- No storage-engine, syscall, transport, or dispatcher changes.
- No `git.merge` (forks stay independent lineages, #36 D4).
- No cursor pagination or other `timeline` redesign.

## Decisions

**D1 — Lineage stamp = a commit-message trailer written at `snapshot()`.** `snapshot()` reads the creating lineage via `git.currentBranch({fullname:false}) || 'main'` (already used by `rollback`, research.md) and appends a trailer to the commit message. Chosen over: (a) **per-lineage snap-tag namespace** — rejected: it changes the user-visible global `gN` id sequence (research.md); (b) **per-lineage reflog of ref movement** — rejected as new drift-prone persistent state (the same class `version-history-ux` D2 rejected as "furthest tip"). A commit trailer is immutable, rides in the commit object, survives compaction untouched (research.md), needs no new store/file, and the message is free because the prompt is also kept in the tracked `prompt.md` blob (research.md).

**D2 — Trailer convention + strip-on-read.** The commit message becomes `<prompt>` followed by a sentinel-delimited trailer carrying the lineage id, using a delimiter that cannot plausibly collide with prose (finalized at implementation against isomorphic-git's message normalization — research open-question 1). Every site that builds `Snapshot.prompt` (`history`, `timeline`, `snapshotContent` — research.md) SHALL split on the delimiter and surface only the prompt portion. A dedicated test asserts a user prompt that itself *contains* a trailer-shaped line round-trips byte-identically.

**D3 — Lineage-correct predicate.** Add `lineageOf(gitdir, oid)`: reads the commit message via the already-used `git.readCommit` (research.md) and returns the stamped lineage, or `'main'` if absent (D4). `timeline()` keeps a candidate iff `isSameLine(...)` **AND** `lineageOf(candidate) === activeLineage`; `rollback()` gates identically. These are the only two `isSameLine` call sites (research.md). `activeLineage = git.currentBranch() || 'main'`.

**D4 — Legacy fallback, no migration.** Un-stamped commits (existing on-device repos, seeded fixtures) are treated as lineage `main` — every seed path installs on `main` (research.md). Pure runtime fallback, no backfill pass: pre-release history is single-lineage-dominant, and a fallback is simpler and drift-free versus a migration that rewrites commits.

**D5 — Performance.** Today's exclude path does zero commit reads; the stamp filter must read each *candidate* tag's message to learn its lineage (research.md — shifts from "read commits you keep" to "read commits to decide"). Bounded by `historyLimit` and within #39's tens-of-ms interactive budget at expected depths; use a message-only read and memoize `lineageOf` per enumeration call. Verified in the on-device acceptance step; not benchmarked at 1000+ generations (research.md).

**D6 — Retire the UI guard + docs.** Delete the `app.storeId != null ? history() : timeline()` branch in `src/host/launcher/history-logic.ts` (fork entries use `timeline()` with full roll-forward) and update its launcher tests. Add a `docs/decisions.md` entry and correct decision #48's now-inaccurate "deferred to linked-apps-data-model" note (F1 is orthogonal — that change is SQLite storage-group sharing).

## Risks / Trade-offs

- [Trailer collides with user prompt text] → strict sentinel delimiter + a strip-and-round-trip test (D2); syntax finalized against isomorphic-git message normalization (research open-question 1).
- [Legacy un-stamped fork history mis-attributed to `main`] → only affects repos that forked BEFORE this fix; pre-release, none exist on real devices; a fork's own *post-fix* snapshots stamp correctly, so the window is self-closing. Documented.
- [Per-candidate `readCommit` cost at high snapshot counts] → capped by `historyLimit`, message-only read, memoized per call; measured on-device (D5). Not benchmarked at 1000+ gens (research.md).
- [Ordering dependency] → this change's spec composes with `version-history-ux`'s `timeline` requirement; **archive this change AFTER `version-history-ux`**.

## Migration Plan

Purely additive plus a runtime fallback — no data migration. New snapshots stamp going forward; pre-existing ones default to `main`. Rollback strategy: revert the change's commits (stamps already written into commit messages become inert once the read/strip path is reverted, and were never surfaced).

## Open Questions

- Exact trailer delimiter syntax, pending a quick probe of isomorphic-git's `commit`/`readCommit` message normalization (research open-question 1) — resolved at implementation, locked by the round-trip strip test.
- Whether to offer an optional one-time backfill later — out of scope here; the runtime fallback suffices (research open-question 2).
