# Contract: staging-lane run lifecycle (chain-3 → chain-4 docs)

## Run start (both loops)
- Precondition: `git branch --list 'integration/*'` empty — ONE active run at a time.
- `MAIN_TIP = git rev-parse main`; `git branch integration/<run-id> "$MAIN_TIP"`; switch to it;
  export `FIXLOOP_INTEGRATION_BRANCH=integration/<run-id>`; ledger `run-start`.
- run-id = OpenSpec change id (feature loop) or fix-batch id (standalone fix loop).
- A NESTED fix-loop run (dispatched from a change's CLOSURE) REUSES the active staging branch.

## During the run
- Worktree BASE = staging tip (`git rev-parse integration/<run-id>`); all merges + regates land
  on the staging branch, strictly serialized; `main` untouched.
- gate-full runs once on the merged staging tip (primary working tree, `fixloop.sh gatefull`).
- Reviewer diff range: first recorded BASE → staging tip.

## Closure (attended only; apply.md step 12 is the canonical text — fix-loop.md defers to it)
a. `git push origin integration/<run-id>` (scoped ask prompt) + DRAFT PR → `main`
   (CI `pull_request` jobs + SonarCloud fire per push; no invariants.yml change needed).
b. Sonar rounds: findings list → nested /fix-loop on the staging branch → re-push until green.
c. /git-cleanup with grant `target_branch=integration/<run-id>` (schema per
   handoff/target-branch-params.md); human applies reset + `--force-with-lease` push of the
   STAGING branch.
d. Final merge (human): `git merge-base --is-ancestor main integration/<run-id>` must pass
   (fail → rebase/restart staging, never surgery on main); then
   `git switch main && git merge --no-ff integration/<run-id>`, push main. No post-merge regate:
   ancestor check ⇒ merged tree == verified staging tip.
e. Teardown: delete `integration/<run-id>` local+remote, close the PR; parked runs keep `wip/*`.

## Invariants the docs must state
- `main` = published branch: one ratified merge per run, never force-pushed in the standard flow.
- Every remote write passes a human at the scoped-push prompt (ask, never allow); subagents
  never push. Fail-closed substring rule per handoff/push-policy.md.
- Unattended runs proceed to the first push prompt, then wait (attended-only closure).
- Legacy escape hatch: unset `FIXLOOP_INTEGRATION_BRANCH` + main-target cleanup grants still
  work for pre-existing history.
