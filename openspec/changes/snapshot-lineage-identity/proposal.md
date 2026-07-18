## Why

The version store's `timeline()` and `rollback()` decide "same lineage" by pure DAG ancestry (`isSameLine`), which cannot distinguish a lineage's own snapshots from a sibling fork's descendants that share a commit. For fork lineages this over-includes another app's versions — and because `rollback` shares the predicate, a restore can land on foreign code (a safety issue). `version-history-ux` shipped an interim UI guard (fork entries list via `history()`, which loses fork roll-forward); this change fixes the root cause so `timeline`/`rollback` are lineage-correct and the guard can be retired.

## What Changes

- Add a **per-snapshot lineage stamp** written by `snapshot()` (leading candidate: a commit-message trailer — the commit message today merely duplicates the prompt, which also lives in the tracked `prompt.md`), read back when enumerating, so each snapshot's originating lineage is recoverable.
- Make `timeline()` enumerate only the **active lineage's own** snapshots, and re-gate `rollback()` to the active lineage, using the stamp instead of raw ancestry — correct across fork and rollback interactions.
- **Strip the stamp out of the commit message** before it becomes the public `Snapshot.prompt` (git vocabulary must never cross the surface).
- Safe fallback for legacy un-stamped snapshots (existing on-device repos, seeded fixtures): treat as lineage `main`.
- Add red-first repro tests for both bug shapes: the non-diverged fork and the original-lineage-rolled-back-past-a-fork-point.
- **Retire** `version-history-ux`'s interim UI guard in `src/host/launcher/history-logic.ts` (fork entries then use `timeline()` with full roll-forward).
- Record the decision in `docs/decisions.md` and **correct decision #48**'s note that deferred this to `linked-apps-data-model` (orthogonal — that change is SQLite storage-group sharing).

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `mini-app-versioning`: the `timeline` / `rollback` "same-line" guarantee is tightened from raw-ancestry to **lineage-correct** — `timeline` enumerates only the active lineage's own line (excluding a sibling fork's descendants that share a commit), and `rollback` refuses any target not on the active lineage, holding across fork + rollback interactions. Existing single-lineage behavior and the `Snapshot` shape are unchanged.

## Impact

- **Code:** `src/host/version-store/engine.ts` (`snapshot`, `timeline`, `rollback`, `isSameLine`, and the `prompt` construction that must strip the stamp); `src/host/version-store/test/acceptance.ts` (new red repros + a "no stamp leaks into `prompt`" assertion); `src/host/launcher/history-logic.ts` + its launcher suite (retire the interim fork guard); `docs/decisions.md` (new decision + #48 correction).
- **Behavior:** no change to the `Snapshot` shape or to single-lineage flows (byte-identical when there's no fork/rollback divergence); fork/rollback enumeration and restore-gating become correct. No migration required — the runtime "no stamp → `main`" fallback handles legacy repos; a one-time backfill is an option to weigh in design.
- **Invariants preserved:** git vocabulary never crosses the surface (#36 D3 — stamp stripped from `prompt` and error messages); no `git.merge` (#36 D4); additive-only (`timeline-verb.md`); `rollback`'s spec'd error contract unchanged.
- **Non-goals:** storage-engine, syscall/transport/dispatcher, and any change to the public shapes of `snapshot` / `history` / `fork`.
