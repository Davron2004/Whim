# Dispositions ledger: fix-phase0-obs

Run branch: `integration/fix-phase0-obs` (cut from `redesign` @ 0ca8675 — NOT from `main`:
every finding targets shell-redesign-v2 code that exists only on `redesign`, which plays the
published-branch role for this batch; closure merges back into `redesign`, attended).
Findings source: findings.md (6 findings, grouped into 3 disjoint-file lanes).
Lanes: A = findings 1+2 (LauncherRoot.tsx) · B = finding 3 (generation-client.ts,
xhr-transport.ts, transport-shared.ts) · C = findings 4+5+6 (machine.ts, dev-log.ts).

## Ledger (append-only, as-it-happens)

- run-start · 2026-08-02 · branch integration/fix-phase0-obs cut from redesign @ 0ca8675;
  leftover integration/fix-generate-stream-transport noted (merged into redesign, change
  archived — dead artifact, not an active run; cleanup deferred to closure).
- reconcile · 2026-08-02 · researcher digest vs archived 2026-08-01-fix-generate-stream-transport:
  all 5 original findings LIVE at 0ca8675; finding 6 (machine.ts:273 top-level catch) added
  from the digest's sibling-site observation.
- plan-dispatched · 2026-08-02 · three read-only planners (lanes A/B/C) launched in parallel
  (sonnet); DONE specs land in plan.md on return.
- plan-returned · lane-C · reconciled LIVE; behavioral (machine.suite.ts + wire-v2.suite.ts
  console-spy extensions); severity med; allowlist: machine.ts, dev-log.ts, 2 test suites.
- plan-returned · lane-A · reconciled LIVE; classified STRUCTURAL-NO-TEST (LauncherRoot is a
  RN component unreachable from Node suites — existing suites are source-text assertions only);
  severity med; allowlist: LauncherRoot.tsx only; 4 breadcrumb sites (openPlan catch,
  onComposeContinue catch non-skip branch, onBuildIt catch, terminal==null + event counts).
- stale-check · lane-C · exit 0 (13 evidence lines present at HEAD 0ca8675) — live, dispatch.
- stale-check · lane-A · exit 0 (18 evidence lines present at HEAD 0ca8675) — live, dispatch.
- dispatched · lane-C · BASE 0ca867509439822a180c4f90126d51f2344a9e6f · fix-worker (sonnet,
  worktree isolation).
- dispatched · lane-A · BASE 0ca867509439822a180c4f90126d51f2344a9e6f · fix-worker (sonnet,
  worktree isolation).
- plan-returned · lane-B · reconciled LIVE (all six mapping sites unfixed); behavioral
  (console-spy tests in generation-client.suite.ts + xhr-transport.suite.ts, incl. the
  motivating /v1/clarify 404 scenario); severity low; shared logMappedError helper in
  transport-shared.ts + httpErrorFrom signature threading.
- stale-check · lane-B · exit 0 (35 evidence lines present at HEAD 0ca8675) — live, dispatch.
- dispatched · lane-B · BASE 0ca867509439822a180c4f90126d51f2344a9e6f · fix-worker (sonnet,
  worktree isolation).
- worktree-created · lane-A · branch worktree-agent-ac13d5675c3502490 ·
  path .claude/worktrees/agent-ac13d5675c3502490 · commit 3eb747f · worker gate PASS.
- red-check · lane-A · SKIPPED by classification (structural-no-test; no test to revert-check).
- integrity · lane-A · first run rc=3 FALSE TAMPER — FIXLOOP_INTEGRATION_BRANCH unset, script
  fell back to a main merge-base across all 145 redesign commits; re-run with
  FIXLOOP_INTEGRATION_BRANCH=integration/fix-phase0-obs → rc=0 clean, only
  src/host/launcher/LauncherRoot.tsx vs BASE 0ca8675.
- verify · lane-A · reviewer (opus) APPROVE — 23 insertions/0 deletions, one file; setScreen
  byte-identity provable (zero deletions); count-only loop branches confirmed; no prompt text
  logged; no smuggled test. Non-blocking notes: ctor name mangles under minification (kind/
  status carry the signal), terminal==null site logs directly (no error object — correct).
- gate-full · lane-A · launched in background (fresh checkout of 3eb747f in main tree).
- worktree-created · lane-B · branch worktree-agent-a61db1caa70b87309 ·
  path .claude/worktrees/agent-a61db1caa70b87309 · commit 93b9e26 · worker gate PASS · one
  declared deviation (breadcrumb after the `finished` guard — prevents double-logging, accepted).
- red-check · lane-B · first invocation INVALID (passed test file paths where redcheck expects a
  test command; "Permission denied" execing the suite read as a false RED) · re-run with
  `npm run -s launcher:test` → true RED: exactly the 2 new breadcrumb assertions fail with prod
  reverted, 3051 others pass · rc=0 non-vacuous.
- integrity · lane-B · rc=0 clean — exactly the 5 allowlisted files vs BASE 0ca8675.
- gate-full · lane-A · PASS (fresh primary-tree checkout of 3eb747f; tree restored).
- merged · lane-A · 64e2978 (--no-ff onto integration/fix-phase0-obs).
- regate-pass · lane-A · ./scripts/gate.sh on merged tip → FAST GATE PASSED.
- cleanup · lane-A · worktree removed, branch worktree-agent-ac13d5675c3502490 deleted
  (unsandboxed, per §11).
- verify · lane-B · reviewer (opus) APPROVE — allowlist exact, no new imports in
  transport-shared (no cycle), all 4 httpErrorFrom callers threaded, hint provenance traced
  (no body/prompt/device-id/key), spies restored in finally. Two low non-blocking nits noted
  (misplaced hostPortOf doc comment; tautological '' match in one h.throws) — accepted as-is.
- gate-full · lane-B · launched in background (fresh checkout of 93b9e26).
- worktree-created · lane-C · branch worktree-agent-aa4b386aef33a6a36 ·
  path .claude/worktrees/agent-aa4b386aef33a6a36 · commit adc60e7 · worker gate PASS · one
  declared deviation (logStage/throwLoggedModelCallFailure helpers inside machine.ts — required
  by the sonarjs cognitive-complexity lint cap, format+delegate only, accepted).
- red-check · lane-C · RED rc=0 — exactly the 4 new assertions fail with dev-log.ts+machine.ts
  reverted (594 others pass); non-vacuous.
- integrity · lane-C · rc=0 clean — exactly the 4 allowlisted files vs BASE 0ca8675.
- gate-full · lane-B · PASS (fresh primary-tree checkout of 93b9e26; tree restored).
- merged · lane-B · 09c3e79 (--no-ff onto integration/fix-phase0-obs, atop lane-A merge).
- regate-pass · lane-B · ./scripts/gate.sh on merged tip → FAST GATE PASSED (regate covers the
  A+B combination — B was gated against BASE alone).
- cleanup · lane-B · worktree removed, branch worktree-agent-a61db1caa70b87309 deleted
  (unsandboxed, per §11).
- verify · lane-C · reviewer (opus) REJECT. Wire byte-identity PROVEN (yield-sequence diff +
  mechanical strip-and-compare both empty); token-loop and abort semantics clean. Defects:
  (1) MED-HIGH the model-call-failure assertion is satisfied by the run-failed line — scripted
  fixture throws from the delta iterator so throwLoggedModelCallFailure has ZERO coverage
  ("model call failed" appears 0× in 598 checks); (2) MED terminal-reason log interpolates
  model-authored plan strings; (3) LOW dev-log.ts comment claims a scrubber that doesn't exist;
  (4) LOW no run-correlation id.
- adjudicate · lane-C · orchestrator rulings: defect 1 MUST-FIX (usage-rejection fixture +
  honest labeling); defect 3 MUST-FIX (comment reword); defect 2 NO-CHANGE for this batch (log
  discloses nothing the wire doesn't already carry — but the WIRE-side question, failure.reason
  embedding model output vs the generation-pipeline spec's scrub rule, is flagged for the user/
  critic as a pre-existing issue); defect 4 NO-CHANGE (Phase 2 runId territory).
- revision-sent · lane-C · revision 1 of 2 → worker resumed with the two must-fixes.
- revision-returned · lane-C · commit 1a45e6d atop adc60e7 · worker gate PASS · new
  testUsageRejectionAfterDeltasLogsAtThrowSite (inline ModelClient fake: deltas complete,
  usage rejects → reaches throwLoggedModelCallFailure); old assertion relabeled honestly;
  dev-log.ts scrubber claim removed (comment-only).
- red-check · lane-C rev1 · RED rc=0 — 4 assertions fail on revert incl. the NEW throw-site
  one; 595 others pass.
- integrity · lane-C rev1 · rc=0 clean — same 4 allowlisted files vs BASE.
- re-verify · lane-C rev1 · reviewer resumed on the adc60e7..1a45e6d delta.
- verify · lane-C rev1 · reviewer (opus) APPROVE — throw-site coverage proven structurally
  (single producer of "model call failed (usage)" in repo, pinned by the new assertion);
  relabeled assertion strictly stronger; delta scope exactly 2 files; wire yield-sequence
  re-proven identical at new tip; 'which' param used and test-pinned (stale IDE flag).
  Carried non-blocking: terminal reasons interpolate model-authored plan values (= wire
  behavior, documented ruling); no run-correlation id (Phase 2).
- gate-full · lane-C · launched in background (fresh checkout of 1a45e6d).
- gate-full · lane-C · PASS (fresh primary-tree checkout of 1a45e6d; tree restored).
- merged · lane-C · d466624 (--no-ff onto integration/fix-phase0-obs, atop A+B merges).
- regate-pass · lane-C · ./scripts/gate.sh on merged tip → FAST GATE PASSED (covers A+B+C
  combination).
- cleanup · lane-C · worktree removed, branch worktree-agent-aa4b386aef33a6a36 deleted
  (unsandboxed, per §11).
- run-end · all three lanes terminal (merged); zero parked branches; closure gate-full on the
  staging tip + attended merge into redesign remain.

## Flags for the human (not this batch's scope)
- WIRE-SIDE: `failure.reason` strings from plan validation interpolate model-authored plan
  values (server/src/generation/plan.ts:135/:141/:149) and no scrubber exists anywhere in
  server/src — the generation-pipeline spec's "reason is scrubbed product prose" invariant is
  arguably already violated on the wire, independent of logging. Candidate critic/opsx finding.
- Leftover branch integration/fix-generate-stream-transport (merged into redesign, change
  archived) still exists — delete at a convenient /git-cleanup.
- Follow-up (Phase 2): run-correlation id (runId) so concurrent runs' breadcrumbs don't
  interleave indistinguishably; per-run trace files + dashboard.
