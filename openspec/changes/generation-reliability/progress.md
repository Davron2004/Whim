# progress: generation-reliability (ledger)

- run-start: staging `integration/beta-2-fixes` cut from main 899a2bbc (MAIN_TIP). Issues #57, #58, #66.
- research: research.md (researcher, Sonnet) and rc-58.md (#58 root cause, Opus): module-scope candidate throw → no paint → no probes → `run_unverified`; reproduced with real Chromium (probe/rc-58 58b8df82). #57 generate/repair resend already live since beta-1 D10; residual = plan turn. Production: 17 generations, 0 terminal failures, 0 upstream failures since 2026-10-07.
- proposal: 37b76676 (Opus proposer), amended b6a3b2d6 (structured `failure.cause`, D11). openspec 1.4.1 --strict + 1.14.1: exit 0.
- dispatched: chain-run-verdict BASE b6a3b2d6, .claude/worktrees/generation-reliability-run-verdict (chain/generation-reliability-run-verdict)
- dispatched: chain-wire BASE b6a3b2d6, .claude/worktrees/generation-reliability-wire (chain/generation-reliability-wire)
- report: chain-wire complete, tip 1abfe2b6 (class-A deviations: 3 extra test files). runner + Opus reviewer dispatched.
- review chain-wire #1 (Opus): REJECT, 2 med (weakened 2**53 boundary literal; device fixtures not from errorForLevel) + 4 low (downgrade path skips field strip; tautological conjunct; re-enable after Retry-After untested; cause must outrank repair-count kind). handoff/wire-review-1.md
- report: chain-run-verdict complete, tip 47c44fdd (class-A: RunOutcome null split by repairable; synthrun/report.ts touched). Opus reviewer dispatched.
- review chain-run-verdict #1 (Opus): REJECT — safety core holds; 2 med (rerun missing on contained:false log; tautological e2e currency assertion) + 5 low. Fixer dispatched for 1-5,7; 6 accepted → parked loader issue. handoff/run-verdict-review-1.md
- runner chain-wire #1: FAIL — gate red: deploy-config smoke envelope (smoke.sh/lib.sh hardcode protocol 1 vs bench-envelope level 2); integrity 0, ratchet 0, device redcheck RED, server redcheck coarse RED. handoff/wire-runner-1.md. Wire fixer dispatched (review #1 findings 1-6 + gate).
- fix round 1 chain-run-verdict: tip 2a6bcf18 (findings 1-5,7 fixed; 3 used post-paint timer, effect-body race recorded out of scope). Runner #1 + Opus re-review dispatched.
- re-review chain-run-verdict #2 (Opus): ACCEPT (findings 1-5,7 resolved). Spec scenario wording tightened on staging aa2e11b4. handoff/run-verdict-review-2.md
- fix round 1 chain-wire: tip e718ffdd (gate: WHIM_SMOKE_PROTOCOL_LEVEL in deploy/lib.sh pinned to PROTOCOL_LEVEL; review findings 1-6). Opus re-review dispatched; runner #2 queued behind run-verdict runner.
- re-review chain-wire #2 (Opus): ACCEPT (findings 1-6 + gate resolved). handoff/wire-review-2.md
- runner chain-run-verdict #1: PASS (gate 0, e2e 0, integrity 0, ratchet 0, redchecks RED: server coarse/type-kept mutation reds in report, synthrun + e2e assertion RED). handoff/run-verdict-runner.md
- merged: chain-run-verdict at ba91fad7 (tasks 1.1–1.5 ticked). Regate deferred to after the chain-wire merge (one gate at a time; the post-wire regate covers both merges).
- runner chain-wire #2: PASS (gate 0, ratchet 0, redchecks device/deploy RED, 2.5 pin RED by scratch mutation, typecheck-tests diagnostics count equal to BASE). integrity exit 4 = design.md (change folder planning artifact, D11 precedence edit) — adjudicated: accepted, same change. handoff/wire-runner-2.md
- merged: chain-wire (tasks 2.1–2.6 ticked). Post-merge regate (covers run-verdict + wire) next.
