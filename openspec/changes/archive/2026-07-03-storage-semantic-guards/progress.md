# Progress: storage-semantic-guards

Dispatcher log. Worktree: `.claude/worktrees/storage-semantic-guards` (branch `worktree-storage-semantic-guards`), based on `0ad6ad3`.

Two chains, sequential, no cross-chain contract.

## Chain log

### chain-1 — storage-engine json query guard — COMPLETE (2026-07-02)

- **Tasks done:** 1.1, 1.2, 1.3, 1.4 (all checked in tasks.md).
- **Files changed (diff verified, 3 files / +52 −1):**
  - `src/host/storage-engine/contract.ts` — added `unqueryable_field` to `StorageErrorKind`; doc notes on `WhereClause`/`OrderBy`/`ListQuery` (json fields opaque, refused in `where`/`orderBy`).
  - `src/host/storage-engine/engine.ts` — new `assertQueryable()` helper refusing json-typed fields with `unqueryable_field`; wired into `compileWhere` **before** `isRangeFilter` inspects the condition, and into `compileOrderBy`.
  - `src/host/storage-engine/test/acceptance.ts` — 3 tests: where-on-json-with-`gt`-shaped-value refused (kind/collection/field + storage unchanged); orderBy-on-json refused; scalar equality+range regression still passes.
- **Deviations:** none (class A/B/C all clear). Diff confirmed in-scope: touches only the 3 declared storage-engine files.
- **Contract:** none (chain declares none).
- **GATE:** storage-engine suite 188/188 green (incl. new §1 scenarios). `./scripts/gate.sh` green on **every** section except `server:test`, which fails with `MODULE_NOT_FOUND` for `tsc` — a **pre-existing environment limitation**, not a chain regression: `server/test/run.mjs:17-20` hardcodes `tscBin = <repoRoot>/node_modules/typescript/bin/tsc` (with `PATH` sanitized to `/usr/bin:/bin`, no walk-up), and the in-repo worktree has no `node_modules` (sandbox denies writing it there). Verified orthogonal: the **main** repo's runner passes `server:test` 125/125 against the main `node_modules`. `server:test` type-checks `contract/`+`server/` only — nothing this change touches. Treated as GATE-PASS-modulo-environment.

### chain-2 — version-store lineage-scoped rollback + change-wide validation — COMPLETE (2026-07-02)

- **Tasks done:** 2.1, 2.2, 2.3, 3.1, 3.2 (all checked in tasks.md).
- **Files changed (diff verified, 2 files / +74):**
  - `src/host/version-store/engine.ts` — new `isSameLine()` private predicate (equal / target-ancestor-of-tip / tip-ancestor-of-target, via `git.isDescendent` run in both directions, explicit `===` equal case); wired into `rollback()` after `resolveSnap`, resolving the branch tip first, throwing a plain `Error` naming `fork`/`switchLineage` (no git vocabulary) before `writeRef`/`checkout`.
  - `src/host/version-store/test/acceptance.ts` — 3 tests (§ST-6a/b/c): cross-lineage refusal with before/after active-id + bundle-byte equality + message-vocabulary assertions; rollback→roll-forward (g1→g2); rollback-to-current-tip.
- **Deviations:** none.
- **Contract:** none.
- **GATE (self-reported, then re-run by dispatcher — see below):** vstore 87/87 green (incl. new tests), storage 188 (regression), bridge 91, launcher 448, `openspec validate storage-semantic-guards --strict` → valid. Only red is the known `server:test` env limitation.

## Dispatcher final gate (full tree, re-run 2026-07-02)

`./scripts/gate.sh` from the worktree: **PASS** on build, typecheck, lint, version-store (87), storage-engine (188), capability-bridge (91), launcher (448), scaffolding tripwires. **FAIL** only on `server:test` — `Cannot find module …/node_modules/typescript/bin/tsc` (MODULE_NOT_FOUND). Independently verified `server:test` green **125/125** by running the main repo's runner against the main `node_modules` (both before and after chain-2). Diff confirms zero `server/`/`contract/` changes, so `server:test` is invariant to this change. **Authoritative verdict: gate green on every section the change can affect; the lone red is a proven pre-existing worktree-environment artifact.**

## Tripwire candidates

_(class-A patterns seen in 2+ chains)_

- **[Harness, not this change] `server/test/run.mjs` can't run from an in-repo worktree.** It hardcodes `tscBin = <repoRoot>/node_modules/typescript/bin/tsc` (repoRoot self-derived two levels up) and sanitizes `PATH` to `/usr/bin:/bin`, so it has no node_modules walk-up fallback and dies with MODULE_NOT_FOUND wherever the worktree lacks a local `node_modules` (which the sandbox deliberately forbids). Every worktree-based `/dispatch` or `/fix-loop` touching the gate will hit this. Also a minor observability bug: a failed-to-*spawn* tsc is reported as "type errors in contract/tsconfig.json". Recommend the harness owner make the runner resolve `tsc` via walk-up (`createRequire(import.meta.url).resolve('typescript/bin/tsc')` or `require.resolve('typescript/bin/tsc', {paths:[repoRoot]})`). Out of scope for storage-semantic-guards; surfaced here, not fixed.

## Closing summary

- **Chains run:** 2 (chain-1 storage-engine json query guard; chain-2 version-store lineage-scoped rollback + change-wide validation). Both COMPLETE.
- **Redispatches:** 0. Both implementers succeeded on first dispatch.
- **Deviations by class:** none (A/B/C all clear across both chains). No tripwire *pattern* recurred across chains (the sole environment red — `server:test` in-worktree — is a harness gap, logged under Tripwire candidates, not a chain deviation).
- **Diff:** 5 files, +126 / −1 — `src/host/storage-engine/{contract.ts,engine.ts,test/acceptance.ts}`, `src/host/version-store/{engine.ts,test/acceptance.ts}`. No scope creep; no protected/config file touched.
- **Gate:** every section green except the proven `server:test` worktree-environment artifact (server:test verified 125/125 in the main node_modules env; server/contract untouched). `openspec validate storage-semantic-guards --strict` → valid.
- **Reviewer verdict:** `approve` — report-honesty matches diff (numstat reconciled), both spec deltas conform, all 7 load-bearing checks confirmed against code, tests non-vacuous, no findings.
- **Result:** change ready. Both refusals implemented as pure engine-side rejections of previously-undefined inputs; no migration, no wire-shape change.
