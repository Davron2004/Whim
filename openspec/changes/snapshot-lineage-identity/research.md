# Research digest: per-snapshot lineage identity for `timeline`/`rollback` (fix for cross-lineage over-inclusion)

## Relevant files
- `src/host/version-store/engine.ts` — `snapshot()`, `history()`, `timeline()`, `isSameLine()`, `rollback()`, `fork()`, tag/id bookkeeping
- `src/host/version-store/index.ts` — `assertNoGitLeak`/`FORBIDDEN_KEYS`/`HEX40` (git-vocabulary guard used by tests)
- `src/host/version-store/test/acceptance.ts` — seeding pattern, existing timeline/lineage tests
- `src/host/launcher/store-access.ts` — the one other caller of `snapshot`/`fork`/`timeline`; keeps its own `lineageId` per entry
- `docs/decisions.md` #36/#39 — latency + storage-growth numbers
- `openspec/specs/mini-app-versioning/spec.md`, `openspec/changes/version-history-ux/handoff/timeline-verb.md` — settled `timeline` contract to preserve

## Current behavior
- **`snapshot()` commit creation** (`engine.ts:200-237`). Writes artifacts + `prompt.md` (line 202), `git.add`s them, then `git.commit({ message: prompt, author:{...AUTHOR, timestamp} })` (218-224; `AUTHOR={name:'Whim',email:'whim@local'}`). **The commit message IS the raw prompt** — no separator/trailer today; the prompt is *also* duplicated into a tracked `prompt.md` blob. Snap tag written via `nextSnapId` (142-149) which scans **every** `whim/snap/gN` tag repo-wide — snap ids/tags are **global across lineages**, not lineage-scoped.
- **Reading a snapshot back** (`history()` 240-261, `timeline()` 271-294, `snapshotContent()` 474-485). All build `Snapshot.prompt` via `stripTrailingNewline(commit.message)` (257/290/481) — **`prompt` is defined as the raw commit message**. So a lineage trailer appended to the message **would leak into the public `prompt`** unless stripped before the `Snapshot` is built. `id` from the snap-tag map (`oidToId` 159-168); `createdAt` from `commit.author.timestamp*1000`.
- **isomorphic-git surface.** `git.readCommit(...) → {commit}` is already used in `timeline()` (289) and `snapshotContent()` (476); `git.log(...)` in `history()` (246). All expose `commit.message` directly. No built-in trailer parsing — that would be new code, but the read primitive exists and is already called once per matched snapshot in `timeline()`.
- **`fork()` + lineage identity** (`engine.ts:389-402`). `lineageId = fork-${n}` (first free `fork-N` by scanning `git.listBranches`), then `git.branch` + `git.checkout`. **Neither the fork point nor the parent lineage is recorded anywhere.** The creating lineage IS knowable inside `snapshot()` via `git.currentBranch({fullname:false})` (already used by `rollback()` at 342, with a `|| 'main'` unborn-HEAD fallback).
- **Legacy / seeding.** `store-access.ts:88` (`install()`) snapshots every installed/seeded app as its first snapshot on lineage `'main'`. `test/acceptance.ts` has ~62 `snapshot()` call sites, essentially all on `main` unless a `fork()`/`switchLineage()` precedes them (only a handful fork). **Safe default for an un-stamped commit: lineage `main`** — matches every real seed path; needed because existing on-device repos won't carry the trailer.
- **`isSameLine` + callers** (`engine.ts:326-336`):
```ts
private async isSameLine(gitdir, target, tip) {
  if (target === tip) return true;
  const targetIsAncestorOfTip = await git.isDescendent({ oid: tip, ancestor: target });
  if (targetIsAncestorOfTip) return true;
  return git.isDescendent({ oid: target, ancestor: tip });
}
```
Only **two** call sites: `timeline()` (285, filters which snap tags are on-line) and `rollback()` (344, gates which ids may be restored). Pure DAG ancestry cannot distinguish "descendant on my branch" from "descendant on a sibling fork branch" once a ref is rolled back to a shared ancestor — this is the over-inclusion. `test/acceptance.ts:228-241` only exercises the shallow-sibling case ancestry already handles; **no existing red test reproduces the bug.**

## Constraints and invariants
- **Git vocabulary never crosses the surface** (#36 D3, spec.md:47-54, `index.ts:47-75` `assertNoGitLeak`) — a lineage trailer is an internal message convention; it must never appear in `Snapshot.prompt`, error messages, or any returned shape. **Binding constraint.**
- **No merge, ever** (#36 D4) — the fix must not introduce any `git.merge`.
- **Additive-only** (`timeline-verb.md:43-46`) — `Snapshot` shape (`id`,`prompt`,`createdAt`) unchanged; behavior byte-identical when there's no fork/rollback divergence (`test/acceptance.ts:250-258` shape-parity).
- **`rollback()` error contract is spec'd verbatim** (spec.md:17,24-27; `test/acceptance.ts:174-177`) — must still name `fork`/`switchLineage` and carry **no** git vocabulary (`!/\b(commit|ref|branch|ancestor)\b/i`).
- **Compaction preserves messages** (`compaction.ts:59-63`, packs via `readCommit`+`packObjects`) — a trailer survives compaction untouched; not a risk.
- **Latency** (#36 `decisions.md:266`, #39 `:377`). Today's `isSameLine` loop does **zero** commit reads for excluded oids (pure `isDescendent`). A trailer filter must `readCommit` (or a message-only read) for **every** candidate tag to know its lineage before filtering — from "read commits you keep" to "read commits to decide what to keep." Given #39's tens-of-ms per-op numbers and ~4 objects/gen growth, very unlikely to cross the "operations feel interactive" bar (spec.md:56-58), but **not directly benchmarked** at 100s-1000s of gens.

## Integration points
- `snapshot()` (`engine.ts:218-224`) — write the lineage stamp into the commit message (needs `git.currentBranch() || 'main'` first).
- `isSameLine()` (326-336) + its two callers `timeline()` (285) and `rollback()` (344) — add the lineage-correctness term to the predicate.
- `prompt` construction (257/290/481) — strip the trailer out of the message before it becomes public `prompt`.
- `test/acceptance.ts` — the rollback-then-fork-collision reproduction has **no existing red test**; add one for both the non-diverged-fork and original-rolled-back-past-a-fork-point cases.

## Risks and unknowns
- I did not run a script to confirm a concrete false-positive; the over-inclusion is derived from `isSameLine`'s two `isDescendent` checks + the rollback-then-diverge test shape (matches the stated root cause).
- I did not measure real `readCommit`-per-tag cost at high snapshot counts (100s-1000s pre-compaction) — the "not material" latency answer is inferential from #36/#39, not benchmarked.
- I did not verify whether isomorphic-git `git.commit`/`readCommit` normalizes/trims multi-line messages in a way that complicates a blank-line-delimited trailer block — worth a quick probe before locking the trailer syntax.

## Open questions for the planner
1. Trailer delimiter convention (e.g. blank line + `Whim-Lineage: fork-2`, vs a non-human prefix) must be unambiguous for message-splitting and cannot collide with a user prompt containing a similar line.
2. Whether pre-fix (un-stamped) repos get a one-time backfill pass or are handled purely by the "no trailer → assume `main`" runtime fallback — decides whether this is a pure code change or needs a migration step.
