# Design: staging-branch-integration

## Context

The harness conflates two roles in `main`: the **serialization point** (where chain/fix merges land one at a time with regates) and the **published branch** (what CI and SonarCloud observe, and what history hygiene applies to). That conflation was cheap while every check ran locally; SonarCloud broke it because it is server-side, PR-triggered, and unrunnable locally or in the deny-egress container (research.md, harness.md §4 row). The result: Sonar iteration, fix commits, history rewriting, and force-pushes all land on `main`.

`fixloop.sh` is already parameterized (`INTEGRATION_BRANCH="${FIXLOOP_INTEGRATION_BRANCH:-main}"`, research.md); the runbooks, cleanup lane, and push policy are not. harness.md §9 records this tier as deliberate future work — this design builds it.

## Goals / Non-Goals

**Goals:**
- `main` never hosts Sonar-fix churn, never gets rewritten, never gets force-pushed in the standard flow.
- One human-ratified merge into `main` per run, of an already-verified tip.
- Preserve every trust invariant: pinned-BASE anchoring, "nothing reaches a shared remote without a human", Class-2 protection, serialized merges + regates.
- Attended flow only; unattended runs work up to the push boundary.

**Non-Goals:**
- Concurrent staging branches (the one-active-run constraint stays; concurrency is a future tier).
- Automated PR creation (`gh` allowlisting) — the human opens the draft PR; scriptable later.
- The fully-unattended auto-grant tier of §9 (this change is its prerequisite, not its delivery).
- Any change to what the gates check.

## Decisions

1. **Branch naming: `integration/<run-id>`**, where run-id is the OpenSpec change id (feature loop) or the fix-batch id (fix loop). Cut from `main`'s tip by the orchestrator at run start, recorded in the run ledger. Rationale: the id makes the branch self-describing in the PR list and lets the cleanup grant name its target precisely.

2. **BASE anchoring is unchanged in kind.** BASE = staging-branch tip at worktree creation, recovered as `git merge-base <branch> $INTEGRATION_BRANCH`. The staging branch itself is cut from a recorded `main` SHA, so every BASE still traces to a pinned `main` ancestor. `fixloop.sh`'s `INTEGRATION_BRANCH` stays the single seam (research.md: `base_of()` already consumes it); the runbooks switch from literal `main` to "the run's integration branch" set once at run start. Alternative rejected: keeping BASE = `main` tip while merging elsewhere — breaks `merge-base` recovery once the staging branch advances.

3. **Push policy: `ask`, not allow, and ref logic lives in `bash-policy.sh`.** `git push` of a ref matching `integration/*` from the main thread falls through to a prompt (human approves each push); everything else keeps today's behavior — pushes naming `main` hard-denied for everyone, subagents denied all pushes. Rationale: preserves "nothing reaches a shared remote without a human" *literally* (a human still approves every network write); and research.md could not verify that `settings.json`'s `Bash(...)` matcher can express ref scoping, whereas `bash-policy.sh` already has arg-parsing precedent (the GIT_C normalizer). `settings.json`'s blanket deny is narrowed only enough to let the hook's `ask` surface. Alternative rejected: unconditional allow for `integration/*` — nothing structurally prevents an agent-authored push landing on the remote unreviewed; the prompt costs one keypress per iteration.

4. **Staging branch gets tier-1 protection against subagents.** The active `integration/<run-id>` is orchestrator-owned: subagent force-ops (`branch -f/-D/-m`, `checkout -B`, `switch -C`) naming `integration/*` join the existing `main`/`dev/v1` deny patterns. A glob pattern (not per-run enumeration) keeps the hook static. Direct merges into the staging branch remain orchestrator-only exactly as merges into `main` are today.

5. **Sonar iteration = draft PR + fix-loop rounds on the branch.** Human opens a draft PR `integration/<run-id>` → `main`; every approved push triggers SonarCloud automatic analysis plus the CI `pull_request` jobs (no `invariants.yml` change — research.md open question 1 resolved: rely on the PR trigger). Sonar findings are transcribed into a findings list (existing `clear-sonarqube-warnings` workflow) and run through `/fix-loop` with `FIXLOOP_INTEGRATION_BRANCH=integration/<run-id>`. Attended-only by construction (pushes prompt).

6. **Git-cleanup targets the staging branch, pre-merge** (research.md open question 2). Lane worktree becomes `.claude/worktrees/<target>-squashed`; the grant schema generalizes `main_sha`/`main_tree` → `target_branch`/`target_sha`/`target_tree`; the identity check resolves `refs/heads/$target_branch`. The cleaner's hard rule "never name `main` as a write target" is *kept verbatim* — the cleaner now writes only `cleanup/<target>-squashed`, and the human applies the reset to the staging branch and force-pushes it (`--force-with-lease`, a routine PR-branch operation). The legacy main-targeted mode remains available for pre-existing history only. Alternative rejected: post-merge cleanup on `main` (today's flow) — it is the force-push-main step this change exists to eliminate.

7. **Final merge: up-to-date requirement instead of a post-merge regate.** The run closes with, in order: last fix/chain merged → `gate-full` green on the staging tip → SonarCloud green on the PR → git-cleanup applied → staging branch contains `main`'s current tip (trivially true under one-active-run; verified mechanically with `git merge-base --is-ancestor main integration/<run-id>`). Then the human merges `--no-ff` into `main` and pushes. Because the branch contains `main`, the merge tree is byte-identical to the verified staging tip — "what you verified == what you merged" holds by construction, and the `main`-push CI job is the backstop rather than the discovery mechanism. Alternative rejected: regate on `main` after merge — redundant under the ancestor check, and reintroduces iteration-on-main if it ever failed.

8. **`gatefull` prose generalization only.** `fixloop.sh gatefull` mechanically operates on the current checkout (research.md); its `die` messages and comments saying "main tree" become "integration tree / primary checkout." No mechanism change.

## Risks / Trade-offs

- [`settings.json` matcher can't express the scoped push] → Decision 3 already places ref logic in `bash-policy.sh`; `settings.json` only needs the blanket deny narrowed so the hook's `ask` is reachable. Verified during implementation by the bash-policy regression suite's new cases (push main denied / push integration asks / subagent push denied / compound-command push falls through).
- [Two changes race: staging branch and `main` diverge] → one-active-run constraint plus the mechanical `--is-ancestor` check before the final merge; a violated check means rebase-or-restart of the *staging* branch, never surgery on `main`.
- [Draft PR forgotten open / stale staging branches accumulate] → run-closure step in both runbooks: after the final merge, delete `integration/<run-id>` (local + remote) and close the PR; parked runs keep their branch under the existing `wip/*` convention.
- [The scoped-push `ask` prompt silently stalls an unattended container run] → documented as attended-only (harness.md gotcha list); the container flow works up to the push boundary, then waits for a human — same failure shape as the existing Chromium carve-out, and the same mitigation (don't run the Sonar-iteration phase headless).
- [Class-2-heavy change: almost every edit is human-applied] → chains.md marks all hook/script/runbook chains HUMAN-BOOTSTRAP with exact per-file edit lists; the only dispatched work is docs + the regression-suite cases.
- [Tier-1 glob protection of `integration/*` blocks legitimate orchestrator cleanup of a finished run's branch] → deletion of a *merged* staging branch is a human step in the closure checklist, mirroring how `main`-naming operations are handled today.

## Migration Plan

1. Land this change (itself the last run to use `main`-direct integration, or applied by human bootstrap without a run).
2. Next run exercises the full lane attended: cut branch → chains/fixes → gate-full → draft PR → Sonar rounds → cleanup → final merge. Treat it as the acceptance run; harness.md §9 moves the tier from "future" to "current" only after it lands.
3. Rollback: unset `FIXLOOP_INTEGRATION_BRANCH`, revert the runbook/hook edits (they are ordinary commits on `main`) — the old flow is restored; no data migration exists to undo.

## Open Questions

- Should chain branches (`chain/<change>-<id>`) ever be pushable for CI-on-chain visibility? Deferred: no need identified; the staging branch is the only remote-visible ref this design requires.
- Exact wording of the run-closure checklist (branch deletion timing vs. SonarCloud's analysis retention) — settle during implementation of the runbook edits.
