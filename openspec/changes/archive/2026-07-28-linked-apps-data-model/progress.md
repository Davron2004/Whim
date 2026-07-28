# Progress ledger: linked-apps-data-model

- 2026-07-18 run-start — staging branch `integration/linked-apps-data-model` cut from MAIN_TIP `cccbf451df6dcf953d745993fcc41dda1416786f`; FIXLOOP_INTEGRATION_BRANCH=integration/linked-apps-data-model
- orchestration note: background session — primary tree stays on `main`; orchestrator operates from `.claude/worktrees/ladm-orchestrator` checked out on the staging branch (merges/regates run there; gate-full at step 10 runs from the primary tree per the Metro main-tree constraint)
- chain DAG: chain-1 → chain-2 (reads handoff/storage-groups.md) → chain-3 (after: chain-2) → chain-4 (after: chain-3); strictly serial
- task 5.2 attended/human-run — not dispatched
- 2026-07-18 dispatched chain-1 (launcher-storage-groups) — BASE cccbf45, worktree .claude/worktrees/linked-apps-data-model-chain-1, branch chain/linked-apps-data-model-chain-1, built OK
- 2026-07-18 chain-1 report — STATUS complete, GATE PASS, commit cf86a48; contract handoff/storage-groups.md (83 lines). Class-A deviations: (1) `fork` real signature is `fork(entry, versionId?, opts?: {shareData?})` — D2's literal `fork(entry, {shareData?})` would break the two existing versionId call sites (LauncherRoot/HistoryScreen, version-history-ux); contract pins the real signature, chain-2/3 must read the contract, not D2 verbatim. (2) session file-write mechanics workaround (Bash heredocs) — no content impact
- 2026-07-18 chain-1 integrity — exit 0, changed files within seam (app-index.ts, store-access.ts, launcher suites, spec.md, handoff)
- 2026-07-18 chain-1 merged — 021a652 on integration/linked-apps-data-model; tasks 1.1, 2.1–2.4 ticked
- 2026-07-18 chain-1 regate-pass — FAST GATE PASSED on merged tip; worktree + branch cleaned
- 2026-07-18 dispatched chain-2 (fork-question-ui) — BASE 0c96f91, worktree .claude/worktrees/linked-apps-data-model-chain-2, branch chain/linked-apps-data-model-chain-2, built OK
- 2026-07-18 chain-2 report — STATUS complete, GATE PASS, commit cae34f7. Class-A deviations: (1) same session file-write mechanics workaround as chain-1; (2) HistoryScreen "Make this version its own app" (`access.fork(app, snapshot.id)`) left untouched — outside chain-2's declared scope; it creates its app fresh (pre-change default) without asking share-vs-fresh. OPEN QUESTION for reviewer/user: does the app-launcher delta's "Fork action" wording cover fork-from-version? Conservative current behavior loses no data
- 2026-07-18 chain-2 integrity — exit 0, changed files within UI seam
- 2026-07-18 chain-2 merged — tasks 1.2, 3.1, 3.2 ticked
- 2026-07-18 chain-2 regate-pass — FAST GATE PASSED on merged tip 8a81f0d; worktree + branch cleaned
- 2026-07-18 dispatched chain-3 (shared-storage-acceptance) — BASE 8a81f0d, worktree .claude/worktrees/linked-apps-data-model-chain-3, branch chain/linked-apps-data-model-chain-3, built OK
- 2026-07-18 chain-3 report — STATUS complete, GATE PASS, commit 4149c6a; launcher:test 1318 checks green; shared-storage tests use real file-backed SQLite (close-then-reopen genuinely pinned, D7). Class-A deviations: (1) same session file-write mechanics workaround; (2) added `HostState.launchFailed` in useMiniAppHost.ts + honest-copy render in MiniAppView.tsx — beyond the literally-named files but the correct "component that renders launch failures"; no new detection logic (D5 intact). ADJUDICATED: accepted, same-subsystem scope interpretation
- 2026-07-18 chain-3 integrity — exit 0, all changes in launcher seam
- 2026-07-18 chain-3 merged — tasks 1.3, 4.1–4.3 ticked; regate pending
- 2026-07-18 chain-3 regate-pass — FAST GATE PASSED on merged tip 5cdaf80; worktree + branch cleaned
- 2026-07-18 dispatched chain-4 (docs-decision) — BASE 5cdaf80, worktree .claude/worktrees/linked-apps-data-model-chain-4, branch chain/linked-apps-data-model-chain-4
- 2026-07-18 chain-4 report — STATUS complete, GATE PASS, commit 190a407; decision #49 appended (supersedes #43b D8, cites #48 F1). Class-A deviation: same session file-write mechanics workaround
- 2026-07-18 chain-4 integrity — exit 0, docs/decisions.md only
- 2026-07-18 chain-4 merged — task 5.1 ticked; regate pending
- 2026-07-18 chain-4 regate-pass — FAST GATE PASSED on merged tip d0e0b1c; worktree + branch cleaned
- 2026-07-18 gate-full — FULL GATE PASSED on staging tip d0e0b1c (run from the primary tree detached at the tip; openspec 27/27, knip, guard:metro, Chromium invariants all green); primary tree restored to main (one re-checkout needed: a sandboxed `git switch` moved HEAD without updating files — redone with sandbox off, tree verified clean)
- 2026-07-18 reviewer dispatched — diff range cccbf45..d0e0b1c
- tripwire candidates: Edit/Write tools bound to the orchestrator worktree in all 4 chains → every implementer fell back to Bash-heredoc writes with sandbox off (background-session worktree binding vs. harness multi-worktree model; environment issue, not code)
- 2026-07-18 reviewer verdict — CLEAN; report honesty matches diff on every claim (derived refcount, no membership mutation path, remove ordering, file-backed D7 test, fail-closed collision pair, launchFailed single write site, #49 append-only, scope exactly as claimed, zero diff in bridge/storage-engine/runtime/sdk/protected files); launcher:test 1318 green + tsc clean independently reproduced. One LOW open item, no fix chain: HistoryScreen.tsx:140 "Make this version its own app" forks fresh without asking share-vs-fresh — reviewer reads "the Fork action" as the HomeScreen Fork affordance, current behavior conservative/byte-identical to pre-change; recommends recording the deferral (follow-up task or a #49 note) rather than blocking closure

## Closing summary

- chains run: 4/4 (launcher-storage-groups, fork-question-ui, shared-storage-acceptance, docs-decision), all strictly serial per the DAG; 0 redispatches, 0 SendMessage revisions, 0 merge conflicts, 0 parked
- deviations: 6 Class A total, 0 Class B/C — (1) real `fork(entry, versionId?, opts?)` signature vs D2's literal two-arg form (contract pins it; downstream chains built against the contract); (2) chain-3's launch-failure surface landed in useMiniAppHost.ts + MiniAppView.tsx (accepted scope interpretation); (3) HistoryScreen fork-from-version doesn't ask share-vs-fresh (reviewer: acceptable scope, LOW, record deferral); (4) session file-write mechanics workaround in all 4 chains (environment, not code)
- gates: fast gate green per chain + per merge regate (4/4); FULL GATE PASSED on staging tip d0e0b1c
- reviewer: CLEAN, no report-mismatch
- staging branch: integration/linked-apps-data-model at d0e0b1c (13/14 tasks; 5.2 = attended on-device acceptance, human-run)
- MEMORY proposals from implementers: none
- remaining (attended closure, per runbook step 12): push staging branch + draft PR → Sonar iteration → /git-cleanup (target_branch=integration/linked-apps-data-model) → ancestor-checked final merge to main → teardown; plus task 5.2 on-device acceptance; suggested follow-up: one-line deferral note for the HistoryScreen fork-from-version share question

## Closure (resumed 2026-07-28, attended)

- 2026-07-28 unparked — `wip/linked-apps-data-model` renamed back to `integration/linked-apps-data-model` (closure's relaxed push forms are keyed to `integration/*`); park note `.claude/fixloop/wip-linked-apps-data-model.md` retired at teardown. The rename was run SANDBOXED and stranded a `[branch "wip/linked-apps-data-model"]` section in `.git/config` — decision #51 D7-AMENDED's residue, at a fifth site the sweep did not cover (branch RENAME, not deletion; `git branch -m` writes config exactly as `-d` does)
- 2026-07-28 reconciled with main — `main` had advanced 21 commits (harden-gate-preconditions, harden-closure-lane, critic reports) past the run's BASE cccbf45; merged main into the staging branch at cba3fad. Exactly ONE file changed on both sides (`docs/decisions.md`, append-vs-append); the whole `src/host/launcher/**` seam was untouched by main, so there was no code reconciliation. `git merge-base --is-ancestor main integration/linked-apps-data-model` now PASSES — the park note's recorded 12f blocker is cleared
- 2026-07-28 decision renumbered — this change's entry was **#49 → #52**. The run was cut before `automate-closure` landed and both appended a #49; `automate-closure` keeps 49 because #50 already cites it by number and the log is append-only. Renumber tag on the entry follows the 43b precedent. Ledger lines above that say "#49" refer to this change and predate the renumber; they are left as written
- 2026-07-28 reviewer LOW deferral RECORDED (the run's one open item) — as a `**Deferred, recorded at closure**` paragraph on decision #52 rather than a follow-up task, since the reviewer's recommendation was either and the decision entry is where the behavior is specified. States what `HistoryScreen.forkFromVersion` does (`access.fork(app, snapshot.id)`, no `opts` → own database, pre-change default), why it is LOW (conservative; a user can lose data only by sharing unintentionally), and that the `opts` parameter is already in place for whichever later change wants it
- 2026-07-28 gate-full RE-EARNED on the reconciled tip 60b14fb — FULL GATE PASSED (openspec 29/29, knip, guard:metro, codex-sync, the three Chromium suites). Deliberately re-run rather than carried over: the 2026-07-18 PASS on d0e0b1c was earned against a `scripts/gate.sh` that has since GROWN (harden-gate-preconditions wired in the `fixloop preflight` suite; `codex-sync` now checks the generated `.codex/agents/*.toml` mirror), so the stale evidence certified the code against a weaker gate
- 2026-07-28 12a ruleset probe — exit 0, `"Protect main"` (requires PR, non_fast_forward, deletion, required_status_checks). 12b — pushed, DRAFT PR **#13** opened
- 2026-07-28 12c poll — **SETTLED FAIL** (predicate rc=9) after 4 polls: `quality-gate` pass, `isolation-suite` still pending, **SonarCloud Code Analysis fail**
- 2026-07-28 12d ingestion — `sonar-pr-issues.mjs --pr 13` exited **10 (red with findings) reporting ZERO issues**. That combination has no cell in step 12d's exit-code contract and it is NOT an ingestion bug: the gate was red on a **condition**, and a condition is a *measure*, not an *issue*, so `api/issues/search` — the only endpoint the script reads — structurally cannot surface it. Diagnosed out-of-band via `api/qualitygates/project_status`: four conditions OK, one ERROR — `new_duplicated_lines_density` GT 3, actual **5.714%**. New-code measures confirmed nothing else was outstanding (0 bugs / 0 smells / 0 violations / 0 vulnerabilities / 0 uncovered lines over 455 new lines). **Decision #51's absent-result rule is what saved this step:** taken naively, the empty findings file would have dispatched nothing, re-pushed an identical tree, and polled a permanently-red gate forever. Finding authored by hand into `findings-sonar-1.md` with its provenance; ledger line appended at ingestion time
- 2026-07-28 12d finding D1 — `api/duplications/show` located one pair, `shared-storage.suite.ts:83-95 <=> :114-126` (13 lines each). 26/455 = 5.714%, matching the failing condition to the digit, so that pair was the whole failure. `HomeScreen.tsx:158-171 <=> HistoryScreen.tsx:294-307` also duplicates but carries `new_duplicated_lines_density 0.0` (pre-existing, not introduced here) and was deliberately left alone — recorded in the findings file so a later round doesn't re-litigate it
- 2026-07-28 12d **DEVIATION (Class B, human-directed)** — the fix was applied **inline by the main thread**, not through a dispatched `/fix-loop` + `fix-worker`. The orchestrator surfaced the conflict between `CLAUDE.md`'s "main thread NEVER implements inline" and this session's standing no-subagents instruction, and the human chose inline explicitly. Consequence to be honest about: this fix has **no independent reviewer verification** and no worktree/integrity/red-check chain — its assurance is the deterministic gate plus the unchanged check count, nothing more
- 2026-07-28 12d fix — extracted `withSharedDir` / `openApp` / `seedFounder` + two module-scope column readers in `shared-storage.suite.ts`. Classified **structural, no behavioral delta** per the harness's test classification, so NO new test was written (a source-grep here would be bloatware). §3 and §4 still call `launchApp` directly on purpose: §3 expects a refusal and inspects the structured error, §4 asserts on `sharer.ok` via `h.ok` — routing either through a throw-on-refusal helper would have converted a counted assertion into an exception. First attempt tripped `typescript:S2004` (functions nested >4 deep) in the IDE, which would merely have traded a duplication failure for a new-code-smell failure; flattened by hoisting the `map` arrows to module scope before committing. `npm run launcher:test` = **1318 checks passed, 0 failed — the same count as before the refactor**, which is the number that distinguishes "removed duplication" from "removed coverage". FULL GATE PASSED. Committed 5536da6, re-pushed
- 2026-07-28 12c re-poll — **SETTLED PASS** (predicate rc=0): SonarCloud Code Analysis pass, isolation-suite pass, quality-gate pass. The duplication pair was the sole cause, as the arithmetic predicted

## Task 5.2 — on-device acceptance (attended, RUN 2026-07-28)

Run on `emulator-5556` (`sdk_gphone64_arm64`, Android release build, `com.whim` **uninstalled first** so
first-run seeding actually ran and the storage directory started empty). This is the **first on-device
acceptance ever completed in this repo** — #43b task 7.2 and #48 task 5.2 both still carry PENDING tags.

Observed, in order:

1. first-run seeding produced Tip Splitter / Water Counter / Style Gallery
2. founder Water Counter: `+1 glass` ×3 → **Glasses 3, History entries 3, "saved"**
3. long-press → Fork → the share-vs-fresh sheet appeared with D2's exact copy, **"Use the same saved data" / "Start fresh"** — product verbs only, no mechanism vocabulary on screen
4. chose share → new tile **"Water Counter / Forked from Water Counter"**, no Example badge
5. opened the fork: **Glasses 3, History entries 3** — it reads the founder's records (D1 resolution live on device)
6. fork `+2 glasses`, reopened founder: **Glasses 5, History entries 5** — mutual read/write confirmed
7. on-disk: **exactly one file**, `/data/data/com.whim/databases/storage/water-counter.db` (via `run-as`; `adb root` is refused on this image). The fork created NO second database — `engineAppId = storageGroupId ?? id` resolving to the founder's id, verified against the filesystem rather than inferred from the UI
8. deleted the **founder**: tile gone, **`water-counter.db` still present** (refcount 1 via the sharer), and the surviving fork still read **Glasses 5** — D3's founder-first order, with the file still bearing the founder's name though the founder is gone: a name, not a liveness claim
9. deleted the **sharer** (last member): **`databases/storage/` is empty** — the file is reclaimed exactly at refcount zero

**VERDICT: PASS** on every leg of the task's sequence. Decision #52's status tag updated from
`on-device acceptance (task 5.2) PENDING` to `RECORDED 2026-07-28`, as that entry's Verification
paragraph specifies.

### Observation from the acceptance — NOT fixed here, filed as follow-up

The delete confirmation reads **"'Water Counter' and all its data will be removed. This can't be
undone."** For a storage-group member that is *not* the last one, that is **not what happens** — step 8
above deleted the founder and its data demonstrably survived, because the sharer still resolved to the
group. The copy is honest for the ungrouped case (every case that existed before this change) and
inaccurate for the shared case this change introduces.

Deliberately NOT fixed inside closure. It is not a copy tweak: `deleteBody(app.name)` would have to
become refcount-aware (`AppIndex.storageRefCount` at the call site) to say "your other app will keep
this data" versus "this removes it for good", which is a behavioral slice needing its own delta spec,
tests, and product-verbs vetting — i.e. a change, not a closure round. Recorded here and on the
open-follow-ups backlog; the honest-copy surface from chain-3 (`HostState.launchFailed` → `MiniAppView`)
is the precedent for how it should read.

## Closure ledger, continued

- 2026-07-28 12c re-poll after the acceptance push — **SETTLED PASS** (rc=0), all three checks explicit
- 2026-07-28 12e history cleanup — run in the standard lane (grant pinned BEFORE the rewrite, `backup/pre-cleanup-integration-linked-apps-data-model` minted as the undo button, dedicated lane worktree, index-only rebuild based on `main` so no historical `.claude/` copy was ever materialized). **DEVIATION (Class B, human-directed), same cause as 12d:** the rewrite was performed by the main thread rather than a dispatched `git-cleaner` subagent. What is NOT weakened by that: the lane's safety is *mechanical, not procedural* — `scripts/git-cleanup-check.sh` PASSED (tip tree identical, target unmoved, backup intact), and independently `integration/…^{tree}` == `backup/pre-cleanup-…^{tree}` == `0a3ad23`, so no content change of any kind could have survived whoever did the rewriting
- 2026-07-28 12e result — **17 commits → 5 semantic commits**, linear on `main` (129 → 117 total). Groups: storage-group data model + refcounted delete; the share-vs-fresh fork question; the honest launch-failure surface + shared-storage acceptance; decision #52; the change artifacts + closure ledger. Per the standing grouping rule the Sonar dedupe was **folded into** the suite commit whose file it touches — no standalone Sonar-fix commit survives. Ref move applied, force-pushed with lease; lane torn down and `cleanup/*` deleted UNSANDBOXED (no `.git/config` residue this time — cf. the first ledger line, where the rename was not)
- 2026-07-28 12f ancestor check — `git merge-base --is-ancestor main integration/linked-apps-data-model` PASSES

## Closing summary (closure run, 2026-07-28)

- **outcome:** PR #13, `integration/linked-apps-data-model` → `main`, all checks green, ready for the human's review-and-merge. `main` is ruleset-protected, so that merge click is the sole ratification act
- **tasks:** 14/14. 5.2 was the last one open and is now RECORDED — the first completed on-device acceptance in this repo (#43b 7.2 and #48 5.2 remain PENDING)
- **gates:** `gate-full` PASSED three times on this branch — on the reconciled tip, after the Sonar fix, and after the acceptance record. Deliberately re-earned rather than carried over from 2026-07-18, because `scripts/gate.sh` itself had grown in the interim
- **deviations this closure:** 2, both Class B and both human-directed — the Sonar fix and the history rewrite were done inline by the main thread instead of by `fix-worker` / `git-cleaner` subagents. Recorded plainly because the cost differs between them: the history rewrite lost *nothing* (its guarantee is a tree-hash equality that holds regardless of author), while the Sonar fix genuinely has **no independent reviewer verification** — its assurance is the deterministic gate plus an unchanged assertion count, and nothing else
- **what this run contributed beyond its own scope:** first real execution of closure step 12d, which immediately exposed that the step's exit-code contract has no cell for "red gate, zero issues" (backlog item 1 resolved, item 9 filed); the delete-confirmation copy inaccuracy found by on-device acceptance (item 8); and `git branch -m` as a residue site the #51 sweep missed (item 10)
- **MEMORY proposals:** none from implementers (the original run collected none); nothing from this closure that isn't better recorded in the backlog
- **remaining:** the human's merge click, then 12g teardown (delete local + remote `integration/linked-apps-data-model` UNSANDBOXED, fast-forward `main`, drop `backup/pre-cleanup-…` once confident), then `/opsx:archive linked-apps-data-model`
