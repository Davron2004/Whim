# Progress ledger: harden-gate-preconditions

Schema `whim-harness`. **Every chain is HUMAN-BOOTSTRAP** — all five touched files are Class-2
protected, so nothing is dispatchable to an implementer. Per the operator's decision this run is an
**attended main-thread session**: chains run serially, each Class-2 edit ratified through the
permission dialog. The dispatcher's parallel-worktree machinery does not apply (chains.md
"Parallelism note").

## Run start

- 2026-07-26 preconditions — gate scripts present and committed clean; primary tree clean. FAILED
  the one-active-run check: `integration/linked-apps-data-model` was live, checked out in
  `.claude/worktrees/ladm-orchestrator` at 6120cef. Surfaced to the operator.
- 2026-07-26 prior run PARKED (operator decision) — ladm was complete through runbook step 11
  (4/4 chains merged, gate-full PASSED on d0e0b1c, reviewer CLEAN) but closure never ran. Note:
  `scripts/fixloop.sh park` REJECTS `integration/*` branches (accepts only `fix/*` / `chain/*`),
  so the park was performed by hand: worktree removed, `integration/linked-apps-data-model` renamed
  to `wip/linked-apps-data-model`, reason note written to
  `.claude/fixloop/wip-linked-apps-data-model.md` in the command's own format. **This is a harness
  finding in its own right** — runbook step 12g says a parked run "keeps its branch under the
  `wip/*` convention", but the command that implements parking cannot park a staging branch.
- 2026-07-26 run-start — MAIN_TIP = c8da79f33d0278b176a9477aea4ee49e65cacd8f. Staging branch
  `integration/harden-gate-preconditions` cut from **3976bc6**, not from MAIN_TIP directly:
  `main` does not contain this change's planning folder, which lives only on the local
  `harden-gate-preconditions` branch. Verified `3976bc6^ == c8da79f`, so the "every BASE traces to
  the recorded MAIN_TIP ancestor" invariant holds and the staging branch carries the artifacts it
  implements. `FIXLOOP_INTEGRATION_BRANCH=integration/harden-gate-preconditions` for every
  `fixloop.sh` invocation this run.
- 2026-07-26 note — the old `harden-gate-preconditions` branch is left in place as a backup ref
  pointing at 3976bc6; delete at closure.

## Chain dispositions

### chain-1: harness-red-check (tasks 1.1–1.6) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-26 started — no worktree, no implementer: Class-2, attended main-thread.
- 2026-07-26 fixture-mechanism decision (Class-A deviation from design D4) — D4 called for "a
  throwaway git fixture with a deliberately dirtied tree". A *dirtied* tree cannot work: `gatefull`
  refuses on a dirty primary tree before reaching the assertion under test. Measured alternative
  adopted instead — a **read-only parent directory**, which reproduces the defect through git's own
  mechanism rather than simulating a sandbox:

  ```text
  error: unable to unlink old 'a/x.txt': Permission denied
  checkout rc=0                 <-- the entire defect, in git itself
  ```

  git warns per file, updates every path it CAN write, and still exits 0; `git diff --quiet <branch>`
  then detects the stranded path. This is the same mechanism by which `gate.sh`'s tripwire noticed
  the stranded files during the research probe, so the assertion is validated against the real
  failure shape, not a stand-in. D4's stated objection to `chmod` ("tests the OS rather than our
  contract") does not apply: the barrier is only the trigger; what is asserted is our contract.
  Root bypasses directory permissions, so the suite PROVES the barrier bit and reports a FAILURE if
  it did not — never a silent skip. Both gate environments are non-root (CI `ubuntu-latest` as
  `runner`; devcontainer `USER node`).
- 2026-07-26 **RED CHECK (task 1.6) — 11 passed / 11 FAILED against the unfixed `fixloop.sh`**.
  Observed messages, verbatim:
  - **case 1 (incomplete checkout)** — the half-applied checkout **REACHED THE GATE**
    (`STUB-GATE-FULL-RAN` present), then printed
    `fixloop: FAILED TO RESTORE the primary working tree to base — fix by hand before continuing`.
    No `INCOMPLETE CHECKOUT`, no stranded path named, and git's `Permission denied` stderr
    discarded to `/dev/null`. Two misleading messages stacked on one bug.
  - **case 2 (linked worktree)** — exit **0**. The full gate ran from a linked worktree with no
    complaint at all.
  - **case 3 (unrelated baseline)** — the worst finding, and BEYOND what the proposal described.
    `base_of` prints `no merge-base for 'alien' vs base` and calls `die`, but it is invoked as
    `base="$(base_of "$branch")"` — **`exit` inside a command substitution cannot terminate the
    parent**. `base` is set to the empty string, execution continues, and the run reports
    `FULL GATE PASSED — primary-tree checkout of alien (base )`: a confident green verdict against
    no baseline whatsoever. `integrity` uses the identical pattern at `scripts/fixloop.sh:82`, so
    this is not confined to `gatefull`. Recorded in the handoff contract for chain-2 to fix at the
    root.
  - **case 4 (restore alarm)** — **GREEN pre-fix**, contradicting task 1.6's expectation of RED for
    1.1–1.4. The false `FAILED TO RESTORE` does not fire on a clean success path; its real instance
    is inside case 1's half-applied path, so the assertion was added there (where it was actually
    observed) rather than fabricating a failure for case 4. Case 4 retains value as a guard against
    the fix introducing a spurious warning.
  - **case 5 (negative control)** — GREEN, all 7 assertions. Suite is non-vacuous.
- 2026-07-26 tasks 1.1–1.6 complete; `handoff/preflight-suite.md` written (contract: the exact
  failure-message substrings chain-2 must satisfy). Committed dfba574.

### chain-2: gatefull-assertions (tasks 2.1–2.6) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-26 **Class-A deviation, scope**: chains.md declares chain-2's edit as "`scripts/fixloop.sh`
  — the `gatefull)` case arm only". The fix went wider *within the same file*: `base_of` no longer
  calls `die` (it returns non-zero and prints nothing), and all four call sites — `integrity`,
  `redcheck`, `gatefull`, `finish` — now check the assignment's status. Rationale: the case-3 defect
  is in the shared helper, not in `gatefull`. Fixing only the `gatefull` arm would have left
  `integrity` — the harness's own tamper detector — able to run against an EMPTY baseline and
  report a confident verdict. The handoff contract flagged this for chain-2 explicitly. No file
  outside chain-2's declared scope was touched.
- 2026-07-26 assertions landed: primary-tree refusal (2.3), baseline refusal + root-cause fix (2.4),
  checkout stderr preserved to stderr (2.1), post-checkout landed assertion naming stranded paths
  and explicitly disclaiming tamper (2.2), restore judged by TREE CONTENT + HEAD rather than by
  git's exit status (2.5).
- 2026-07-26 **task 2.6 — SUITE GREEN: 23 passed / 0 failed**, negative control intact (7
  assertions, all still passing — nothing went vacuous).
- 2026-07-26 one assertion corrected mid-chain: `assert_not_contains "$OUT" "TAMPER"` failed against
  the *fixed* script because the new message reads "This is NOT tamper" — a case-insensitive
  substring cannot distinguish an accusation from a disclaimer. Replaced with two precise
  assertions: output must not contain `GATE REFUSING TO RUN` (gate.sh's actual tripwire wording),
  and must contain `NOT tamper`. The test was wrong, not the message.
- 2026-07-26 anti-vacuity re-check for the two assertions added *after* the red check. The obvious
  route (restore the old script, re-run) was **blocked by `protect-harness.sh`** — twice, including
  a scratch-tree copy, because the redirect target's path ends in `scripts/fixloop.sh`. Not routed
  around; verified read-only instead: `git show HEAD:scripts/fixloop.sh` contains neither
  `NOT tamper` (0) nor `INCOMPLETE CHECKOUT` (0), so `incomplete checkout actively disclaims tamper`
  is certainly RED pre-fix. `GATE REFUSING TO RUN` is also absent (0) — that assertion is therefore
  **vacuous in this fixture** and is documented in the contract as a redundant guard; the
  load-bearing assertion for the same property is `does not reach the gate`, which was red pre-fix.
- 2026-07-26 note — `gate.sh` cannot run until this is committed: its tamper tripwire refuses while
  `scripts/fixloop.sh` differs from `GATE_BASE`. That is the designed flow (a human commits the
  deliberate change, which advances the baseline), not an obstacle. Committed 85ebb9b.

### chain-3: cleanup-apply-command (tasks 3.1–3.3) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-26 `git-cleanup-check.sh` gained `worktree_of <branch>` (parses
  `git worktree list --porcelain`) and now prints `git -C <worktree> reset --hard <lane>` when the
  target is checked out somewhere, keeping the `checkout` form only for the checked-out-nowhere
  case (D5).
- 2026-07-26 tasks 3.2/3.3 — suite extended with both topologies, and the printed command is
  **executed**, not merely grepped. That is the point of 3.3: the original defect was a command
  that had never once been run and failed 100% of the time it was followed under the staging lane;
  a text-matching test would have reproduced the very mistake being fixed. Both cases assert the
  target branch actually moved to the squashed tip afterwards.
- 2026-07-26 fixture fix — assertions compare absolute paths, but on macOS `$TMPDIR` resolves
  through `/tmp -> /private/tmp` while `git worktree list` reports the real path. Fixture paths are
  now normalized with `pwd -P`.
- 2026-07-26 **SUITE GREEN: 30 passed / 0 failed.**
- 2026-07-26 non-vacuity of the two new cases, verified read-only (a scratch copy is blocked by the
  same protected-path guard): the unfixed script's apply block is a single unconditional
  `echo "  git checkout $target_branch && git reset --hard $BRANCH"` and emits `git -C` **0** times.
  So all three worktree-topology assertions are RED against it — including the executed one, which
  git rejects with "already used by worktree". Case 7 (target checked out nowhere) passes both
  before and after: it is chain-3's own negative control. Committed d580c0c.

### chain-4: gate-wiring-and-docs (tasks 4.1–4.2, 5.1–5.4) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-26 4.1 — `check "fixloop preflight" bash scripts/test/fixloop-preflight.test.sh` wired into
  `scripts/gate.sh` beside the other harness self-tests.
- 2026-07-26 5.4 — **verified, not assumed**: `readlink AGENTS.md` → `CLAUDE.md`. So 5.1 needs no
  mirror edit, and hand-writing one would have replaced the symlink with a diverging copy.
  `docs/harness.md` §10 now states that consequence.
- 2026-07-26 5.1/5.2 — the false claim lived in exactly two places: `CLAUDE.md:25` and
  `docs/harness.md` §4's settings row. Both corrected per D6 — the documented / inferred /
  unresolved split from `research.md` is preserved verbatim in spirit rather than flattened into a
  new confident claim, since stating an unverified mechanism as fact is what made the old text
  wrong. §4's row now reads "declares … but was measured inert", so the declared set documents
  intent rather than behaviour.
- 2026-07-26 5.3 — decision **#50** appended, superseding **#49 D3** (which recorded the carve-out
  as working). The log is append-only, so #50 declares the supersession rather than editing #49 —
  the same precedent by which #49 superseded #43b D8. Records: the architectural `.claude/**`
  denial, the control-plane-inside-`.claude/` collision that makes it permanent, assert-don't-assume
  as the standing rule, the `die`-in-a-command-substitution defect, test-the-message, the cleanup
  apply-command topology fix, and the deferred relocation spike with its kill criterion.
- 2026-07-26 committed 6c43e02.
- 2026-07-26 **task 4.2 — FAST GATE PASSED** on the change tip 6c43e02.

### Verification (tasks 6.1–6.3, orchestrator-run, not a chain)

- 2026-07-26 **6.1 — FULL GATE PASSED** on tip 6c43e02, from the primary tree, unsandboxed, with
  `FIXLOOP_INTEGRATION_BRANCH=integration/harden-gate-preconditions`. `openspec validate` 29/29.
  The new assertions did **not** fire on this legitimate run — the negative-control property holds
  outside the fixture too.
- 2026-07-26 **6.2 — THE REAL-BUG CONFIRMATION, and it is the task that separates a fix from a
  plausible-looking edit.** Ran `./scripts/fixloop.sh gatefull 635ceff` **sandboxed** (635ceff was
  chosen because exactly 3 `.claude/**` files differ from the tip — same defect, tight blast
  radius). Verbatim:

  ```text
  error: unable to unlink old '.claude/commands/fix-loop.md': Operation not permitted
  error: unable to unlink old '.claude/commands/git-cleanup.md': Operation not permitted
  error: unable to unlink old '.claude/commands/opsx/apply.md': Operation not permitted
  INCOMPLETE CHECKOUT of 635ceff into the primary working tree — these tracked paths did NOT update:
    .claude/commands/fix-loop.md
    .claude/commands/git-cleanup.md
    .claude/commands/opsx/apply.md
  The working tree is a mixture of commits, so it is NOT what the gate would be verifying.
  This is NOT tamper. ...
  fixloop: refusing to gate a partially-applied tree
  === exit: 2 ===
  ```

  Before this change the identical command produced a `GATE REFUSING TO RUN` tamper accusation
  naming those same three files. Note the real errno is `Operation not permitted`, while the fixture
  produces `Permission denied` — different errno, same defect, which vindicates asserting on **our**
  message rather than on git's wording.
- 2026-07-26 post-6.2 tree check — primary tree fully restored, HEAD back on the staging branch, no
  manual repair needed. Instructive detail: the restore required no write to those three paths
  (their content had never changed), which is exactly why the old `FAILED TO RESTORE` was a false
  alarm — git reported failure over a tree that was already correct.
- 6.3 (supervised closure observation, `automate-closure` task 7.2) — PENDING; it is runbook step 12
  and happens after the reviewer pass.

## Reviewer pass (runbook step 11)

- 2026-07-26 reviewer dispatched on 3976bc6..fd0449a. Verdict: **FINDINGS** (2 real + 1
  informational). Scope confirmed exactly as claimed — no `src/`, no `invariants/`, no product code.
  Independently reproduced the suite (30 passed), `readlink AGENTS.md`, and the 6.2 three-file blast
  radius. Report honesty: matches the diff.
- **Finding 1 (MEDIUM) — ACCEPTED AND FIXED.** The restore hardening was asymmetric. The EXIT trap
  armed at `start_ref` capture was still the *original* silent restore
  (`git checkout … >/dev/null 2>&1`, no postcondition), and it is what fires on every early `die` —
  including the new `INCOMPLETE CHECKOUT` path. That is precisely the path where the restore is most
  likely to be impeded too, since the same write barrier that broke the checkout can break the
  restore. The verified restore only guarded the post-gate path. So the change reintroduced its own
  defect class (requirement 4: diagnostics must not go to `/dev/null`) on the exit path it added.
  The reviewer also noted it was untested. Fixed: one `restore_primary_tree` function — verified by
  tree content and HEAD, diagnostics to stderr — now serves BOTH the trap and the normal path. New
  assertion `incomplete-checkout exit path leaves the tree restored` covers the outcome, not just
  the message.
- **Finding 2 (LOW) — ACCEPTED AND FIXED.** A **fifth** raw `base_of` call survived, inline in
  `finish`'s ratify string (`git diff $(base_of "$branch")..$branch`), unguarded — the exact
  unchecked shape this change exists to remove, and it would have interpolated an empty baseline
  into the command a human is told to run in order to ratify a protected-config change. Not
  reachable as a live bug (case 6 only follows a successful `integrity` on the same pair), but
  fixing the ledger's wording instead of the code would have been the wrong repair. `finish` now
  resolves `base` once, status-checked, and reuses it; the ratify string interpolates `$base`.
  Verified: exactly four `base_of` call sites remain (lines 91/163/206/343), all `|| die`-guarded —
  the earlier "5 occurrences" count included the doc comment at line 69, not code.
- **Finding 3 — informational, no action.** The reviewer confirmed the chain-2 scope deviation was
  disclosed correctly and was the right call.
- Reviewer found no issue with: `worktree_of`'s exact-match awk (immune to prefix collisions), the
  postcondition's correct exclusion of gitignored/untracked paths, the primary-tree idiom's
  false-positive risk, decision #50's epistemic accuracy, or the tasks.md checkbox state.
- 2026-07-26 fix chain applied in the main thread (Class-2, same as every other chain here);
  **suite 31 passed**, negative controls intact. FAST GATE PASSED, then **FULL GATE PASSED** on the
  new tip (openspec 29/29). Committed 5c1465b.
- 2026-07-26 **6.2 re-run after the fix — the finding vindicated in the real environment.** The
  sandboxed `gatefull 635ceff` output now shows the three `Operation not permitted` errors **twice**:
  once from the checkout, and once from the EXIT trap's restore. That second block was previously
  swallowed by `>/dev/null 2>&1` and was invisible — it is exactly the diagnostic the reviewer said
  was being discarded. And yet **no** `FAILED TO RESTORE` fired, with the tree clean and HEAD back
  on the staging branch: git errored during the restore while the tree ended up correct, which is
  precisely the false-alarm condition, correctly not alarmed. Both halves of the restore fix
  demonstrated in a single real run.

## Closure observation (task 6.3 = `automate-closure` task 7.2)

First exercise of the automated closure pipeline. Divergences filed as findings, not fixed inline.
Note the deliberate before/after boundary: this change's own closure ran against the OLD behaviour,
since the fixes take effect only once it merges.

- **12a ruleset probe** — exit 0 first try: ruleset "Protect main" (requires PR; non_fast_forward,
  deletion, required_status_checks). The fail-closed precondition works as designed.
- **12b push + draft PR** — clean; PR #7. Both `gh` forms were main-thread auto-allowed as documented.
- **12c poll** — settled in ~180s, and **all three checks green on the first push**: SonarCloud pass
  (23s), `isolation-suite` pass (2m14s), `quality-gate` pass (38s). Notable: `isolation-suite` is
  the first confirmation that the new suite's read-only-directory fixture works on Linux CI as a
  non-root user, which was the one portability risk flagged when the barrier mechanism was chosen.
- **12d Sonar round — SKIPPED, no findings.** So the pipeline's most common iteration loop went
  unexercised by this run; it remains observed only in prior runs. Nothing appended to
  `openspec/critic/sonar-ledger.md` (correct — the grammar is one line per *finding*).
- **FINDING C1 (runbook gap, MEDIUM).** Step 12c says to poll `gh pr checks <n>` on a bounded
  timeout, but does not say how to treat the **not-yet-registered** state. Immediately after a push,
  `gh pr checks` prints `no checks reported on the '<branch>' branch` and **exits 0** — which a
  naive "stop when nothing is pending" poll reads as SETTLED and GREEN. This orchestrator's first
  poll after the reviewer-fix push did exactly that and had to be re-run. This is the *same defect
  class the change fixes* — an absent result read as a settled result — living in the closure
  runbook rather than in a script. Recommended: step 12c should specify that `no checks reported`
  counts as pending, and the poll should require a positive verdict rather than an absence of
  pending. Filed, not fixed inline, per 6.3's instruction.
- **12e history cleanup** — CLEANUP GATE PASS; 8 in-scope commits → 6 semantic ones, 99 → 97 on the
  branch, tip tree byte-identical to the pinned `28013148`. Verified independently of the cleaner's
  report: content identical to the pre-cleanup target, and `scripts/fixloop.sh` written **exactly
  once** in the new history, so the reviewer fix genuinely folded and no standalone fix commit
  survived. chain-1 still precedes chain-2, preserving D7's observed-RED-before-the-fix ordering.
  - Cleaner deviation, accepted: the reviewer fix was **not contiguous** with chain-2 (three commits
    between), so a pure `read-tree` snapshot rebuild could not fold them — a snapshot at chain-2's
    boundary carries the *unfixed* file. Resolved git-natively via `git merge-tree --write-tree`
    (object-DB only, no worktree writes, which matters because worktree writes are what the sandbox
    denies) plus `update-index --cacheinfo` at the boundaries. Intermediate trees are therefore
    synthesized rather than historical — expected for a fold, and deliberately unconstrained: the
    lane pins only the tip tree ("freed path, gated outcome").
  - Honest note on the apply command: the gate printed chain-3's new worktree-aware form, but in
    this run the target was checked out in the PRIMARY tree, where the old `git checkout` form would
    also have worked. So the new path was exercised without reproducing the condition that broke the
    old one. The failing case needs the target in a *run* worktree — covered by the suite, not by
    this run.
- **12f** — Sonar + both CI jobs re-reported GREEN on the rewritten SHAs (tree identical by
  construction, but re-reported as required before the flip).
- **FINDING C2 (policy/doc divergence, MEDIUM).** `docs/harness.md` §4 states that main-thread
  `git fetch origin` and `git pull --ff-only origin main` are relaxed/auto-allowed for closure's
  ancestor check and teardown, and apply.md step 12 repeats it. In practice `bash-policy.sh`
  **denied** a bare main-thread `git fetch origin` with *"git network/shared-ref/history op is
  human-approved only (class-B deviation)"*. The documented relaxation does not match the hook's
  behaviour. Step 12f's ancestor check (`git merge-base --is-ancestor main <branch>`) is likewise
  unrunnable, since the fail-closed substring matcher denies any history op naming `main`.
  Worked around **without evading the guard** by asking GitHub instead:
  `gh pr view <n> --json mergeable,mergeStateStatus` returned `MERGEABLE`/`CLEAN`, which is the
  authoritative answer and strictly better than a possibly-stale local ref. Recommended: either
  relax the hook to match the docs, or change step 12f to use the `gh` mergeability query and drop
  the local ancestor check. Filed, not fixed inline. **This also blocks teardown step 12g**, whose
  `git fetch origin` + `git pull --ff-only origin main` are denied by the same rule — the human will
  need to fast-forward local `main` themselves after merging.
- Related friction, not a finding: compound commands containing `main` anywhere (e.g.
  `git log --oneline main..integration/x` chained after a push) are denied wholesale, because the
  unroller judges a compound by its worst segment and the matcher is substring-based. Working as
  designed and fail-closed; just split the commands. Same rule also denies a `cat <<EOF` heredoc
  whose **prose body** mentions `git fetch` / `main` — the matcher scans the whole command string,
  heredoc content included. Correct fail-closed behaviour; use the Write/Edit tool for file content,
  which is the sanctioned path anyway (the same reason grants must be written with Write, never a
  shell redirect).

## Closing summary

- **Chains run: 4/4**, all HUMAN-BOOTSTRAP and main-thread. No implementer subagent was dispatched
  and none could have been: every file touched is Class-2, so `/opsx:apply`'s dispatch loop had an
  empty work queue by construction. The operator chose an attended main-thread session, with the
  permission dialog as the Class-2 ratification.
- **Redispatches: 0. Merge conflicts: 0. Parked: 0.** (No merges either — serial main-thread work on
  the staging branch, so the per-merge regate collapses into the per-chain gate.)
- **Deviations: 3 Class A, 0 Class B/C.**
  1. chain-1's fixture mechanism — a read-only parent directory instead of design D4's "deliberately
     dirtied tree", because a dirty tree is rejected by `gatefull`'s own dirty-tree guard before
     reaching the assertion under test. The substitute is *stronger*: it reproduces the defect
     through git's own behaviour rather than simulating a sandbox.
  2. chain-2's file scope — `base_of` and all its call sites, not just the `gatefull)` arm, because
     the defect lived in the shared helper and `integrity` (the tamper detector) had the same hole.
     The reviewer independently judged this the right call.
  3. the cleaner's non-contiguous fold via `merge-tree --write-tree` (see 12e).
- **Gates:** fast gate green on every chain tip; **FULL GATE PASSED** twice (before and after the
  reviewer round); `openspec validate` 29/29; CI + SonarCloud green on every push.
- **Reviewer: FINDINGS (1 MEDIUM + 1 LOW), both accepted and fixed**, then re-verified against the
  real sandboxed failure. The MEDIUM was the change reintroducing its own defect class on the exit
  path it added — the most valuable single result of the run, and NOT something the change's own
  tests would have caught, since they asserted only on messages and never on the resulting tree.
- **Suite: 31 assertions**, wired into the fast gate, negative controls intact.
- **Tasks: 21/22.** Only 6.3 remains open by design — it *is* this closure observation, whose
  findings are recorded above.
- **MEMORY proposals: none.** Nothing surfaced that the repo does not already record — the sandbox
  measurement now lives in `CLAUDE.md` + `docs/harness.md` + decision #50, the fixture technique is
  documented in the suite's own header, and C1/C2 are here.

### Follow-ups this run created (for archive, not for this change)

1. **C1** — closure runbook step 12c must treat `no checks reported` as pending, not settled.
2. **C2** — `bash-policy.sh` denies the `git fetch` / `merge-base` forms that `docs/harness.md` §4
   and apply.md step 12 document as relaxed. Either relax the hook or rewrite 12f/12g to use `gh`.
3. **`fixloop.sh park` cannot park an `integration/*` branch** (it accepts only `fix/*` / `chain/*`),
   although runbook step 12g says a parked run keeps its branch under the `wip/*` convention. Hit
   for real at run start while parking `linked-apps-data-model`.
4. **Stale remote branch** `integration/sonar-recurrence-ledger` survives although PR #5 merged —
   step 12g teardown was skipped in that run.
5. **`wip/linked-apps-data-model`** is a complete-but-unclosed run, and `main` is NOT an ancestor of
   it, so its closure needs a merge-from-main first. Resume note at
   `.claude/fixloop/wip-linked-apps-data-model.md`.

## Post-merge (2026-07-27)

- PR #7 **MERGED** as a **rebase merge** — all six semantic commits landed on `main` linearly with
  new SHAs (`d860c8d` … `e08e06d`), single-parent each. The cleanup lane's output survived intact,
  which is the outcome the lane exists to produce.
- **Task 6.3 complete.** The supervised closure ran end to end: 12a ruleset probe → 12b push + draft
  PR → 12c poll → 12d skipped (no findings) → 12e cleanup → 12f re-poll + ready flip → human merge.
  Divergences filed above as C1 and C2. Caveat stated plainly: **12d was never exercised**, because
  SonarCloud was green on every push — so the closure pipeline's most iterated loop remains observed
  only in earlier runs, not in this one.
- **Defect #6 from `research.md` reproduced live during teardown**, unprompted:
  `git branch -D integration/harden-gate-preconditions` printed
  `error: could not lock config file .git/config` / `warning: update of config-file failed`, then
  `Deleted branch …` and **exited 0**. The ref went away; the `[branch "integration/…"]` config
  section survived. Confirms the catalogued behaviour outside the original probe. It could not be
  cleaned up here either — `git config --remove-section` is a tier-1 denied op for every caller — so
  a stale config section is the expected residue of every sandboxed branch deletion. Rolled into the
  follow-up change with C1/C2.
