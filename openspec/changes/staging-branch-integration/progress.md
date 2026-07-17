# Progress ledger: staging-branch-integration

Dispatcher: main thread (attended session). Integration branch for THIS run: `main`
(this change is the last main-direct run by design — see design.md Migration Plan).

## Dispositions

- 2026-07-17 run-start — proposal artifacts committed (34db4dd, c850006); main tree clean at c850006.
- 2026-07-17 plan — chains 1–3 are HUMAN-BOOTSTRAP (Class-2 edit sets): applied by the main
  thread in the main tree with per-file human ratification via the protect-harness ask prompts;
  no implementer dispatched for them. chain-4 (docs) dispatches normally after chain-3.
- 2026-07-17 chain-1 DONE — tasks 1.1–1.3; committed by human as e3d6674 (auto-mode classifier
  blocked the orchestrator commit — expected for Class-2); fast gate PASS on e3d6674.
  Contract: handoff/target-branch-params.md. Live probes: legacy grant parses (exit 4 on moved
  pin), nonexistent target refuses (exit 3).
- 2026-07-17 side-finding — .claude/fixloop/grants/git-cleanup is a STALE grant from an applied
  cleanup (cleanup/main-squashed tip is in main history); teardown pending: grant +
  cleanup/main-squashed + backup/pre-cleanup + main-squashed worktree survive. Surfaced to user;
  restored untouched after use as a live legacy-parse fixture.
- 2026-07-17 process note — user feedback mid-run: normal workflow must not require attended
  per-step commits; desired end state is one reviewable PR. Recorded to memory
  (end-state-pr-review); remaining Class-2 chains batched into ONE commit request. User switched
  session out of auto mode for the Class-2 edit prompts.
- 2026-07-17 chain-2 DONE — tasks 2.1–2.4 applied (bash-policy scoped push ask + integration/*
  force-op glob; settings deny narrowed to `Bash(git push origin main:*)`; suite +6 cases).
  Suite 17/17 vs new hook; RED-CHECK vs e3d6674 hook fails at the ask case (non-vacuous).
  Contract: handoff/push-policy.md. Class-A deviation logged: spec wording for
  compound-with-push corrected from "prompts" to "denied" (stricter, matches pre-existing
  tier-1 semantics); spec delta + task text amended pre-merge.
- 2026-07-17 chain-3 DONE — tasks 3.1–3.4: apply.md (RUN START step 0, staging BASE/merge/
  gate-full/reviewer retargets, CLOSURE step 12 a–e), fix-loop.md (<run-branch> throughout,
  standalone-vs-nested rule, closure defers to apply.md), git-cleanup.md + git-cleaner.md
  target-parameterized; sync-codex --write + --check clean.
- 2026-07-17 cross-chain integration edit — bash-policy.sh cleanup_lane() had a HARDCODED
  main-squashed lane id that chain-1's derived names would have orphaned: now derives the lane
  worktree id from the grant's target_branch (grant = authority). Suite grew 2 lane-derivation
  cases; 19/19 green. Logged as a chain-2 addendum discovered during chain-3 — the runbook
  rewrite is what surfaced it.
- 2026-07-17 chains 2+3 committed 638bae5 (one batched commit per user feedback); fast gate
  PASS on 638bae5 (19-case policy suite included).
- 2026-07-17 chain-4 dispatched — BASE 638bae5, worktree .claude/worktrees/
  staging-branch-integration-4, branch chain/staging-branch-integration-4, implementer subagent,
  tasks 4.1–4.3 (docs only).
- 2026-07-17 chain-4 report — STATUS complete, GATE PASS, commit d5019ff, 3/3 tasks. Class-A
  deviation (accepted, in-scope): harness.md §5 still described BASE-from-main + merge-into-main,
  contradicting the rewritten §3. Revision 1 sent to the same implementer: align §5 with the
  staging lane (run-start cut, staging merges/regates, closure pointer to apply.md step 12).
