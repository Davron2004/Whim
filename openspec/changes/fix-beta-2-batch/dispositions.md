# Dispositions: fix-beta-2-batch

Nested on the active staging branch `integration/beta-2` (no second staging branch cut). Three findings: F204, F193, F177.

## Ledger

- 2026-10-30 run-start (nested, shift 2 integration orchestrator): run-branch `integration/beta-2`. Adaptation build → gate → fix: fix-worker builds + runs touched suites + commits + handoff; a Sonnet runner does gate/integrity/ratchet/red-check/device passes once each; an Opus reviewer verifies; orchestrator merges + runner regate. Rulings: (2) #204 Language row above the summary; (18) #193 verify-first on emulator-5560, clean repro → only the contrast test lands. Devices: emulator-5560, one cloned iOS 27 sim (iPhone 17), ≤2 virtual devices, no physical phone.
- stale checks at `f7cef4f8`: F177 exit 0 (live), F204 exit 0 (live); F193 has no EVIDENCE block by design (verify-first device repro is its stale check).
- F177 dispatched: BASE `ee97addf`, worktree-created `fix/F177` at `.claude/worktrees/F177`, fix-worker on SONNET effort medium (self-contained test redesign with a precise protocol, per plan). Allowlist: copy.suite.ts + handoff.
