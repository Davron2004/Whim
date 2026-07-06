# Dispositions: fix-shakedown

<!--
  Append-only run ledger, written by the orchestrator AS EACH disposition
  happens — never batched at the end, never rewritten (correct by appending).
  This file plus the fix/* and wip/* branches are the resume state if the
  orchestrator's context dies.

  Line shape: - <UTC time> <finding-id> <event> — <detail>
  Exactly ONE terminal event per finding: merged | parked | escalated | skipped.
-->

## Ledger

- 2026-07-02T (batch) change fix-shakedown created (schema whim-fixloop); preconditions OK at e9d50f6; 6 planners dispatched (ST-1, ST-3, RT-2, SRV-3, HL-DOCS, D7-CONTROL)
- 2026-07-02T (batch) all 6 planners returned DONE specs; plan.md written
- 2026-07-02T ST-1 stale-ok (9 evidence lines present at HEAD)
- 2026-07-02T ST-3 stale-ok (6 lines)
- 2026-07-02T RT-2 stale-ok (14 lines)
- 2026-07-02T SRV-3 stale-ok (8 lines)
- 2026-07-02T HL-DOCS stale-ok (4 lines)
- 2026-07-02T D7-CONTROL stale-skip — exit 7, evidence missing at HEAD; planner verdict ALREADY-FIXED agrees. NEGATIVE CONTROL PASSED (no worktree created). **TERMINAL: skipped**
- 2026-07-02T ST-1 dispatched (BASE e9d50f69ee381646563fe5d31d2090dcb69fa7a6)
- 2026-07-02T ST-3 dispatched (BASE e9d50f69ee381646563fe5d31d2090dcb69fa7a6)
- 2026-07-02T RT-2 dispatched (BASE e9d50f69ee381646563fe5d31d2090dcb69fa7a6)
- 2026-07-02T SRV-3 dispatched (BASE e9d50f69ee381646563fe5d31d2090dcb69fa7a6)
- 2026-07-02T HL-DOCS dispatched (BASE e9d50f69ee381646563fe5d31d2090dcb69fa7a6)
- 2026-07-02T SRV-3 fix-reported complete, gate PASS, commit 7e1cd1d (worktree-agent-a533adaec70bf8c4e)
- 2026-07-02T RT-2 fix-reported complete, gate PASS, commit 4a73b98 (worktree-agent-a458c77ca4210fe7e)
- 2026-07-02T HL-DOCS fix-reported complete, gate PASS, commit 3eff87c (worktree-agent-a57c1bbf0444a4880)
- 2026-07-02T ST-1 fix-reported complete, gate PASS, commit 948af48 (worktree-agent-a56f4a2c9d99584ee)
- 2026-07-02T ST-1 integrity-0 (3 files ⊆ allowlist); SRV-3 integrity-0; RT-2 integrity-0; HL-DOCS integrity-0
- 2026-07-02T ST-1 redcheck-red (real assertion failure: raw TypeError bind error with fix reverted; 170 other checks green — non-vacuous). First attempt hit the documented §6.7 sandbox block on redcheck's worktree-add; reran with the attended sandbox override.
- 2026-07-02T (batch) 4 reviewers dispatched (ST-1, SRV-3, RT-2, HL-DOCS); ST-3 worker still running
- 2026-07-02T SRV-3 verify-ok (ACCEPT: single-file type-only annotation, literals byte-identical, tsc clean, F2 literal untouched)
- 2026-07-02T HL-DOCS verify-ok (ACCEPT: 4 surgical swaps in 3 allowlisted files; replacement claims fact-checked against useMiniAppHost.ts/MiniAppView.tsx; cue-backend comment-only)
- 2026-07-02T ST-1 verify-ok (ACCEPT: guards flow through existing type_mismatch path; test uses pre-existing expectError/mixedSchema, asserts kind + hint + nothing-written; no invented error kind)
- 2026-07-02T ST-1 gatefull started (serialized, main tree)
- 2026-07-02T ST-1 gatefull-pass (FULL GATE PASSED; main tree restored to dev/v1)
- 2026-07-02T RT-2 verify-reject (reviewer, HIGH: unconditional setTotal(previous) in catch is wrong once kv.set already persisted `next` — display would diverge from reload, the exact invariant the fixture teaches. Orchestrator adjudication: reviewer's landed===0 gate is also incomplete — kv.set can succeed with landed 0; discriminator must be kv-set-succeeded. Revision 1/2 sent to worker.)
- 2026-07-02T ST-1 merged (merge into dev/v1: engine.ts +6, marshal.ts +1, acceptance.ts +23) + regate-pass (FAST GATE PASSED on merged tip) + cleanup (worktree, branch, owner marker removed). **TERMINAL: merged**
- 2026-07-02T ST-3 fix-reported complete, gate PASS, commit 828d681; Class-A deviation disclosed: planner's poisoned-readFile red test was vacuous (isomorphic-git wraps ALL readFile errors as NotFoundError) — worker substituted in-place loose-object byte corruption, a genuine non-NotFoundError from git.log
- 2026-07-02T ST-3 redcheck-red (rejection assertion fails with fix reverted — real assertion) + integrity-0 (2 files ⊆ allowlist)
- 2026-07-02T RT-2 revision reported (kvSaved discriminator, commit 7c2533e, gate PASS) + integrity-0 re-run clean
- 2026-07-02T (batch) reviewers dispatched: ST-3 (fresh), RT-2 (re-verify revision)
- 2026-07-02T SRV-3 gatefull-pass
- 2026-07-02T ST-3 verify-ok (ACCEPT: catch narrowing exact, no drive-by; reviewer independently reproduced the red-check — 1 failure at BASE, exactly the new assertion; corruption-test premise verified against MemoryFs mechanics; NotFoundError confirmed at runtime)
- 2026-07-02T RT-2 verify-ok on revision (ACCEPT: kvSaved discriminator traced through all 3 invariant cases; 1 file, 12+/2-; prior defect confirmed fixed)
- 2026-07-02T SRV-3 merged + regate-pass + cleanup. **TERMINAL: merged**
- 2026-07-02T ST-3 gatefull-pass; merged + regate-pass + cleanup. **TERMINAL: merged**
- 2026-07-02T RT-2 gatefull-pass; merged + regate-pass + cleanup. **TERMINAL: merged**
- 2026-07-02T HL-DOCS gatefull-pass; merged + regate-pass + cleanup. **TERMINAL: merged**
- 2026-07-02T (batch) END STATE: dev/v1 @ 4493ce8; 5 merged, 1 skipped (negative control passed); no fix/wip branches, no dangling worktrees, owner markers all released; MEMORY proposals from workers: none
