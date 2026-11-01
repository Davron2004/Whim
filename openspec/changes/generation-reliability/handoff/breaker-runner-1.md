# breaker runner verdict: PASS
Branch chain/generation-reliability-breaker, BASE 612c9de5, tip d1c7b99d.

1. Fast gate: exit 0, FAST GATE PASSED (handoff/breaker-gate.log)
2. server:e2e: exit 0, no FAIL lines (handoff/breaker-e2e.log)
3. Integrity: INTEGRITY OK, exit 0 (18 changed files, all in allowlist)
4. Removal ratchet: PASS, exit 0, no drops
5. Red-check (admission,routes-unary,routes-generate; generate.ts/clarify.ts/rewrite.ts/app.ts reverted to BASE): RED, a tsc BUILD failure not an assertion failure
   (lifecycle.ts and admission.suite.ts: 'providerBreaker' does not exist in AppOptions). The route-level behavior reds are the builder's mutation reds in breaker-report.md (4.1-4.6, each type-satisfying).
6. typecheck:tests: 2 server/contract diagnostics (same as BASE 2)
7. git log: 2 commits, no attribution lines
