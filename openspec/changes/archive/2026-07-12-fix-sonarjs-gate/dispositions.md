# Dispositions ledger: fix-sonarjs-gate

Schema: whim-fixloop. Integration branch: main. Orchestrator: main thread (/fix-loop).
Batch: 9 findings (F1–F9) from enabling `plugin:sonarjs/recommended-legacy` in the gate
(commit 57412bb). Baseline at batch start: main = 57412bb (lint RED with exactly these
11 errors across 9 findings; everything else green).

Findings source: findings.md (grouped same-file: F2 = schema.ts ×2, F5 = kv-fs.ts ×2).

## Ledger (append-only, one line per event)

- 2026-07-12 batch opened. Preconditions OK (baseRef=head; gate scripts committed clean).
- 2026-07-12 planning dispatched: 4 read-only planners (F1/F8/F9 server, F2 storage-schema, F3–F6 version-store, F7 sdk).
- F2 stale-check: exit 0 (evidence present at HEAD) — live.
- F2 dispatched: BASE=57412bb51c2073d5dc349c3326e12e2bfb265d9f, severity HIGH (user must ratify merge), class structural-no-test.
- plans received for all 9 findings (4 planners); plan.md written. All structural-no-test; none ALREADY-FIXED.
- stale-checks: F1,F3,F4,F5,F6,F7,F8,F9 all exit 0 (F2 recorded above) — every finding live at HEAD.
- F7 dispatched: BASE=57412bb51c2073d5dc349c3326e12e2bfb265d9f, severity low (allowlist includes src/runtime/generated/* regeneration).
- F1,F3,F4,F5,F6,F8,F9 dispatched: BASE=57412bb51c2073d5dc349c3326e12e2bfb265d9f, severity: F1 med, rest low.
- ORCHESTRATOR ADJUDICATION (batch-baseline): rules landed at 57412bb before fixes, so every worker/branch tree is lint-RED on the OTHER findings' files by construction. Disposition: per-fix gate verdicts are judged with lint failures EXCUSED iff confined to still-unfixed batch files (all other gate sections must pass); per-merge regate judged the same way against the shrinking unfixed set; the batch's authoritative FULL gate (gate-full.sh, no excuses) runs on main after the FINAL merge. Per-fix `fixloop.sh gatefull` is run for F7 only (SDK + regenerated runtime — the one fix that can break Chromium invariants/knip), lint-baseline-interpreted; for single-file non-SDK fixes the final full gate is the net.
- F1 report: STATUS complete, commit 92ba6d0, branch worktree-agent-ab48a325be6e9fdde. gate.sh all sections pass except lint; lint errors confined to the 8 other findings' files; server:test 143 passed. Red-check: SKIPPED (structural-no-test).
- F7 report: STATUS complete, commit a04b4d4, branch worktree-agent-a4ac784be2115aea0. Class-A deviation: force-added src/runtime/generated/{runtime-html.ts,runtime-artifacts.json}. ORCHESTRATOR REJECTION of that deviation: src/runtime/generated/ is GITIGNORED (line 83) and has ZERO tracked files on main — the planner's "generated files are committed" premise was wrong; the gate regenerates them. Revision requested: amend commit to un-add the two generated files (source edit only).
- F8 report: STATUS complete, commit a2e1e9f. F4 report: STATUS complete, commit 2de7f70 (vstore 87/87). F5 report: STATUS complete, commit 16aadfd (vstore 87/87). F6 report: STATUS complete, commit 5ce51f4 (vstore 87/87). All: own file lints clean; gate lint failures confined to other batch files (excused per adjudication); red-check SKIPPED (structural).
- integrity: F1 exit 0; F4 exit 0; F5 exit 0; F6 exit 0; F8 exit 0; F7 exit 0 (allowlist glob covered the generated files — the rejection above is policy, not scope).
- F2 report: STATUS complete, commit 062a947, branch worktree-agent-a16b0068e3f814a81. storage:test 188/188; schema.ts lints clean; class-A deviation: extra diffField helper split (diffExistingFields still measured 21 after the sketch) — accepted, same push order preserved. integrity exit 0.
- F9 report: STATUS complete, commit 8314e60, branch worktree-agent-a16c63b5c97b393d3. class-A deviation: literal deletion tripped sonarjs/generator-without-yield; replaced generator with a hand-rolled never-resolving AsyncIterable (call site: neverYields() → neverYields). server:test 143/143, three keepalive checks confirmed firing. integrity exit 0.
- F7 revision 1 requested: amend commit to drop the two force-added gitignored generated files (source-only commit).
- F7 revision 1 applied: commit eabaeb1 (amend via reset --soft, own unmerged commit only), contains exactly src/sdk/index.tsx; generated files back to ignored/untracked; eslint clean; build succeeds. integrity re-run below.
- reviewers dispatched: server (F1,F8,F9), vstore (F4,F5,F6), storage (F2), sdk (F7 + gatefull).
- F3 report: STATUS complete, commit 9af3e21, branch worktree-agent-a6d9cb4ef5fca3f59. vstore 87/87; file lints clean; class-A deviations (explicit failures[] params, time→timed rename vs no-shadow, backend field name) — accepted, shape-net = DeviceVerdict typecheck. integrity exit 0.
- F7 gatefull (fresh checkout of eabaeb1): fast sections pass (static-checks 55/55, tripwires); FAILED at lint = the 8 other unfixed findings (excused per adjudication); gate stops at lint so knip/Chromium never ran. Disposition: F7's Chromium/knip verification DEFERRED to the final batch gate-full on merged main (authoritative, no excuses).
- reviewer (vstore F4/F5/F6): ACCEPT ×3 — claims independently reproduced (eslint clean, tsc clean, vstore 87/87 each).
- merged: F4 (worktree-agent-a8e81f61041f41955; commit-message typo "F2->F4" — content correct, history-rewrite not warranted); regate: all sections pass, lint excused (remaining 8 files exactly).
- merged: F5 (worktree-agent-a442f5688395a13a6); regate: sections pass, lint excused (remaining 7).
- merged: F6 (worktree-agent-a8bf1e65d4223bdc0); regate: sections pass, lint excused (remaining 6: pipeline, openrouter.suite, server-core.suite, schema, device-acceptance, sdk/index).
- reviewer (storage F2): ACCEPT — line-by-line push-order audit; diffField early-return equivalence verified; storage 188/188, eslint+tsc clean reproduced. Merge HELD for user ratification (severity high).
- reviewer (server F1/F8/F9): ACCEPT ×3 (independently re-ran lint + server suite 143/143 per branch; F9 iterator-close semantics verified against sse.ts).
- merged: F1, F8, F9 (regate after each: sections pass, lint excused, red set shrank 6→5→4... verified post-batch as 3: schema.ts, device-acceptance.ts, sdk/index.tsx).
- reviewer (F3/F7): ACCEPT ×2 (F3 strings/keys/order verbatim, looseObjectCount move proven benign; F7 commit confirmed source-only).
- merged: F3, F7 (regate after each: sections pass, lint excused; remaining red = schema.ts only → F2).
- F2 merge RATIFIED by user (AskUserQuestion, 2026-07-12). merged: F2. regate: FAST GATE PASSED — lint fully green repo-wide with sonarjs on; batch red set empty.
- final: authoritative ./scripts/gate-full.sh dispatched on merged main (no lint excuses); result recorded below.
- teardown: 9 worktrees + branches removed post-merge.
- FINAL: ./scripts/gate-full.sh on merged main → FULL GATE PASSED (openspec 17/17 incl. the two newly synced specs; Chromium invariants, knip, metro guard green with sonarjs rules on). All 9 findings terminal (9 merged, 0 parked). MEMORY proposals from workers: none. Batch complete 2026-07-12.
