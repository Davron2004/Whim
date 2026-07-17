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
- 2026-07-17 chain-4 revision-1 report — complete, GATE PASS (worktree), commit a4feaaa.
  Class-A self-caught: several of its Bash calls ran against the repo root (cwd resets between
  calls); Edits used absolute paths, integrity diff later confirmed zero stray changes.
- 2026-07-17 chain-4 integrity exit 0 (allowlist: the 3 docs files); merged --no-ff at 4377e4b^
  region; tasks 4.1–4.3 ticked; REGATE PASS; lane torn down (worktree/branch/owners).
- 2026-07-17 gate-full PASS on merged tip 4377e4b.
- 2026-07-17 reviewer verdict: report-mismatch (narrow). HIGH: harness.md §9 promoted the
  staging lane to "built, validated" ahead of design.md's own migration-plan gate (the
  end-to-end closure has never run live; this run was main-direct by design). ROOT CAUSE: the
  dispatcher's own task 4.1 wording instructed exactly that promotion — planner error, not
  implementer improvisation. LOW (disclosed, correctly handled): the settings.json push-deny
  narrowing is a ratified Class-1-shape weakening, human-committed. LOW: no explicit
  --force-with-lease suite case (logically covered by the prefix match) — follow-up candidate.
- 2026-07-17 fix chain-5 dispatched (reviewer HIGH → fix chain per runbook step 11): BASE
  4377e4b, worktree staging-branch-integration-5, one task — reword §9 to
  built-but-pending-acceptance-run; auto-grant tier stays Future.
- 2026-07-17 chain-5 complete — GATE PASS, ba350f6; integrity exit 0 (docs/harness.md only);
  merged 29c65f6; REGATE PASS; lane torn down. §9 now has a third bucket "built, unit-verified,
  closure pending" with the explicit promotion condition.

## Closing summary

- Chains run: 5 (1–3 HUMAN-BOOTSTRAP main-thread with per-edit ratification; 4 dispatched;
  5 = reviewer-HIGH fix chain, dispatched). Redispatches: 0. Revisions: 1 (chain-4 §5
  consistency, self-flagged by the implementer).
- Deviations: Class A ×4 — spec wording tightened (compound-with-push deny), chain-4 §5
  staleness (fixed via revision), chain-4 cwd-reset commands (no harm, integrity-confirmed),
  §9 overclaim (dispatcher task-authoring error, fixed by chain-5). Class B/C: none.
  Tripwire candidate: subagent cwd-reset is already a documented gotcha; chain-4 hit it anyway —
  dispatch prompts now carry an explicit per-command cd warning.
- Reviewer verdict after fix: the single HIGH is resolved by 29c65f6; LOWs logged (ratified
  settings narrowing — working as designed; missing --force-with-lease suite case — follow-up
  candidate for the next Class-2 batch).
- Gates: fast gate green after every merge (e3d6674, 638bae5, 4377e4b, 29c65f6); gate-full
  green on 4377e4b (chain-5 is docs-only; final gate-full deferred to the pre-archive check).
- THIS run was the last main-direct integration by design; the NEXT run (sonar-recurrence-ledger)
  is the staging-lane acceptance run.
- MEMORY proposals from implementers: one (subagent Bash cwd resets every call — already
  covered by harness.md §11 gotcha; not saved as a duplicate).
- Stale side-state surfaced to user (pre-existing, untouched): legacy cleanup teardown pending
  (grants/git-cleanup + cleanup/main-squashed + backup/pre-cleanup + main-squashed worktree).
