# Tasks: harden-gate-preconditions

All files touched here are **Class-2 protected**. No implementer subagent can edit them — every
task is main-thread and human-ratified through the permission dialog. See `chains.md`.

## 1. Red-check first (the live bug is the fixture)

- [x] 1.1 Write `scripts/test/fixloop-preflight.test.sh` with the incomplete-checkout case: build a throwaway git repo fixture whose working tree diverges from the target commit, invoke the `gatefull` precondition path, and assert it fails **naming an incomplete checkout** — assert on message content, not exit status alone (design D2/D4)
- [x] 1.2 Add the primary-tree case: invoking from a linked worktree refuses with that stated reason
- [x] 1.3 Add the baseline-relation case: a target branch unrelated to the integration branch refuses stating the baseline could not be established
- [x] 1.4 Add the restore case: a successful restore emits no restore-failure warning
- [x] 1.5 Add the **negative control**: a complete, valid checkout passes every assertion (keeps the suite non-vacuous, per decision #28 discipline)
- [x] 1.6 Confirm the suite is RED against current `fixloop.sh` for 1.1–1.4 and GREEN for 1.5 — record the observed failure messages in `progress.md` before any fix

## 2. Assertions in `scripts/fixloop.sh gatefull`

- [x] 2.1 Stop redirecting the checkout's stderr to `/dev/null`; route it to stderr so the diagnostic survives (design D3)
- [x] 2.2 After `git checkout --detach`, assert the working tree's tracked content matches the target commit; on mismatch `die` naming the paths that did not update and identifying an incomplete checkout — never let a partial tree reach `gate.sh`
- [x] 2.3 Assert `gatefull` is running in the primary working tree (`git rev-parse --git-common-dir` vs `--git-dir`) and refuse with that reason otherwise
- [x] 2.4 Assert the target branch is related to `INTEGRATION_BRANCH`; refuse stating the baseline could not be established rather than gating against a wrong baseline
- [x] 2.5 Fix the false `FAILED TO RESTORE` alarm so it reports only an actual restore failure
- [x] 2.6 Turn the suite from 1.6 GREEN; re-confirm the negative control still passes (no assertion became vacuous)

## 3. Cleanup-lane apply command

- [x] 3.1 In `scripts/git-cleanup-check.sh`, resolve where the target branch is checked out (`git worktree list --porcelain`) and print the worktree-scoped apply command when it lives in a run worktree; keep the primary-tree form only for the not-checked-out-anywhere case (design D5)
- [x] 3.2 Extend the suite from task 1 with both topologies: target in a worktree, and target checked out nowhere
- [x] 3.3 Verify the printed command by executing it against a fixture — the bug was that the printed text was never run

## 4. Gate wiring

- [x] 4.1 Wire `check "fixloop preflight"` into `scripts/gate.sh` (must land with the suite, or the fast gate references a missing file — design Migration Plan)
- [x] 4.2 Run `scripts/gate.sh` green on the change tip

## 5. Documentation correction

- [x] 5.1 Correct `CLAUDE.md`: remove the claim that the Chromium-dependent commands "are carved out of the host sandbox via `excludedCommands`"; state the measured behaviour — operations writing under `.claude/**` require an attended explicit sandbox override or the devcontainer, permanently, not pending a fix
- [x] 5.2 Correct `docs/harness.md` §4/§11 to match, preserving `research.md`'s documented / inferred / unresolved distinction rather than replacing one confident claim with another (design D6)
- [x] 5.3 Append a decision entry to `docs/decisions.md` recording: the architectural `.claude/**` denial, the control-plane-inside-`.claude/` collision, assert-don't-assume as the standing rule, and the deferred relocation spike
- [x] 5.4 Note in `docs/harness.md` that `AGENTS.md` is a symlink to `CLAUDE.md`, so 5.1 needs no separate mirror edit — verify this rather than assuming it

## 6. Verification

- [x] 6.1 Run `scripts/gate-full.sh` green on the change tip, from the **primary tree**, unsandboxed, with `FIXLOOP_INTEGRATION_BRANCH` set — and confirm the new assertions do not fire on this legitimate run
- [x] 6.2 Confirm the new assertions fire correctly against the REAL sandboxed failure, not only the synthetic fixture: run `gatefull` sandboxed against a branch that changes `.claude/**` and verify the message now names an incomplete checkout rather than tamper
- [x] 6.3 HUMAN-SUPERVISED (task 7.2 of `automate-closure`): this change's closure is the first exercise of the automated closure pipeline. Observe end to end, execute nothing that the pipeline should execute, and file divergences as findings before archiving — note that the fixes in this change take effect only after it merges, so its own closure still runs against the old behaviour
