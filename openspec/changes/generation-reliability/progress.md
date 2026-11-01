# progress: generation-reliability (ledger)

- run-start: staging `integration/beta-2-fixes` cut from main 899a2bbc (MAIN_TIP). Issues #57, #58, #66.
- research: research.md (researcher, Sonnet) and rc-58.md (#58 root cause, Opus): module-scope candidate throw → no paint → no probes → `run_unverified`; reproduced with real Chromium (probe/rc-58 58b8df82). #57 generate/repair resend already live since beta-1 D10; residual = plan turn. Production: 17 generations, 0 terminal failures, 0 upstream failures since 2026-10-07.
- proposal: 37b76676 (Opus proposer), amended b6a3b2d6 (structured `failure.cause`, D11). openspec 1.4.1 --strict + 1.14.1: exit 0.
- dispatched: chain-run-verdict BASE b6a3b2d6, .claude/worktrees/generation-reliability-run-verdict (chain/generation-reliability-run-verdict)
- dispatched: chain-wire BASE b6a3b2d6, .claude/worktrees/generation-reliability-wire (chain/generation-reliability-wire)
