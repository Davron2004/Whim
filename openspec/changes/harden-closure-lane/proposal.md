## Why

`harden-gate-preconditions` fixed a defect class in the *gate* layer: the harness acted on
preconditions it never checked, and reported partial success as success. Its own closure run — the
first supervised exercise of the automated pipeline — then produced **four instances of the same
class one layer up, in the closure lane**, within a single session. Measured evidence in
`research.md`.

The sharpest is F1. Immediately after a push, `gh pr checks <n>` prints
`no checks reported on the '<branch>' branch` and **exits 0**. Runbook step 12c says to poll on a
bounded timeout but never says how to treat that state, so a poll written as "stop when nothing is
pending" reads *checks have not started* as *checks passed*. That happened during the run and had to
be caught by hand. A closure pipeline that can mistake "no verdict yet" for "green verdict" can flip
a PR to ready on no evidence at all.

The second, F2, is a different failure of the same kind: documentation asserting behaviour that
measurement contradicts. `docs/harness.md` §4 and `apply.md` step 12 both say main-thread
`git fetch origin` and `git pull --ff-only origin main` are relaxed for closure; the hook denies them
outright. Step 12f's ancestor check and step 12g's teardown are therefore **unrunnable as written**.
This is exactly the error `harden-gate-preconditions` corrected for `excludedCommands` — a document
describing a mechanism that does not behave as claimed — and the lesson evidently did not generalize
past the file it was found in.

## What Changes

- **Step 12c's poll requires a positive verdict, not an absence of pending.** `no checks reported`
  counts as *pending*. The runbook states it, and the behaviour is locked by a test rather than by
  operator memory, since this is a step every closure runs.
- **Reconcile the bash policy with its documentation (F2).** Determine which side is the defect —
  this is genuinely open, see `design.md` D2 — then make them agree, and rewrite steps 12f/12g so
  every command they instruct is a command that runs. 12f's ancestor check moves to the `gh`
  mergeability query regardless, because GitHub's answer about the actual merge beats an inference
  from a local ref that may be stale.
- **Document the content-vs-command matcher friction (F2b)** and the sanctioned workaround
  (`Write` the file, then `--body-file` / the Edit tool), so an operator who hits it reaches for the
  documented path instead of rewording prose to slip past a security guard.
- **`fixloop.sh park` accepts `integration/*` (F3)**, because step 12g already documents parking a
  staging run under the `wip/*` convention, and the tool currently refuses the input its own runbook
  specifies. Hit for real at the start of the last run.
- **Record the `git branch -D` config residue (F4)** as expected sandbox behaviour, not a mystery:
  the ref is deleted, `.git/config` keeps a stale section, git exits 0, and it cannot be cleaned in
  session because `git config` is tier-1 denied for everyone. Decide whether teardown reports it.
- **Record that closure step 12d has never been exercised.** SonarCloud was green on every push of
  the observation run, so the Sonar-findings → nested `/fix-loop` → re-push loop remains unvalidated
  end to end. Stating this prevents "supervised closure passed" being read as "every step works".

## Capabilities

### Modified Capabilities

- `staging-integration-lane`: the closure poll must distinguish *no verdict yet* from *a passing
  verdict*; every command a closure step instructs must be one the policy permits; parking applies
  to a staging branch, which is what the lane actually produces.
- `gate-preconditions`: extends "a partial success is never reported as success" to cover **absent**
  results, not only partial ones — an unreported verdict is not a passing verdict — and states that
  the rule binds runbooks, not only scripts. F1 lived in a runbook precisely because the existing
  requirement was read as being about shell code.

## Impact

- `.claude/commands/opsx/apply.md` (steps 12c/12f/12g), `.claude/hooks/bash-policy.sh` and/or
  `docs/harness.md` §4 depending on D2, `scripts/fixloop.sh` (park arm) — **all Class-2 protected**.
  Every chain is HUMAN-BOOTSTRAP and main-thread, ratified through the permission dialog. No
  implementer subagent can touch any of it.
- `scripts/test/fixloop-preflight.test.sh` — extended with the park case and the poll-predicate case.
- No product code. No runtime, SDK, storage, launcher, or `invariants/` surface.

**Prerequisite.** `automate-closure` owns the closure runbook and is still active with task 7.2
(the supervised observation) as its only open item. That task is now complete and its findings are
filed. This change consumes those findings; it should not start until 7.2 is ticked, so the two do
not both edit `apply.md`.

**Out of scope, deliberately.** Two operational chores surfaced by the same run, neither needing a
spec: deleting the stale remote branch `integration/sonar-recurrence-ledger` (PR #5 merged, teardown
skipped), and closing out `wip/linked-apps-data-model` — a complete-but-unclosed run whose closure
needs a merge-from-`main` first, since `main` is not an ancestor of it.
