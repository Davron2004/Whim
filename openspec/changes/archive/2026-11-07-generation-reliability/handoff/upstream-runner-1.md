# upstream runner (BASE 6f30bc57, tip cd308d9b)

Verdict: PASS (red-check coarse RED)

1. Fast gate (capped-run 6144/1500, scripts/gate.sh): exit 0, "FAST GATE PASSED". Log: upstream-gate.log. typecheck:tests reports 3 server/contract diagnostics (see 6).
2. `npm run server:e2e`: exit 0. Log: upstream-e2e.log.
3. `fixloop.sh integrity` (FIXLOOP_INTEGRATION_BRANCH=integration/beta-2-fixes, allow-upstream.txt): INTEGRITY OK, exit 0.
4. Removal ratchet (--base 6f30bc57 --head chain/generation-reliability-upstream): PASS, exit 0, 4 verification files compared, no drops, no authorised: lines (machine.suite.ts counts did not drop).
5. Red-check (wrapper red-upstream-test.sh; PROD model.ts openrouter.ts machine.ts failure-codes.ts clarify.ts rewrite.ts reverted to BASE): exit 0 = RED, but COARSE RED: tsc build failure, not an assertion:
   server/test/machine.suite.ts(29,3): TS2305 no exported member 'PROVIDER_UNAVAILABLE_REASON'
   server/test/routes-generate.suite.ts(45,101): TS2305 same
   Type-satisfying mutation reds are in the builder's report (upstream-report.md "Red evidence": e.g. providerUnavailable=false, weaker `= !creditExhausted`, cause line removed, cause on internal_error too). Log: upstream-red.log.
6. Typecheck diagnostics: BASE has 2 (server/src/admission/credit.ts(46,29) TS2339 AbortSignal.timeout; server/src/openrouter.ts(496,35) TS2504 asyncIterator). Tip has 3: the same two (openrouter line moved to 503,35) plus NEW:
   server/src/model-failure.ts(44,34): error TS2339: Property 'reason' does not exist on type 'AbortSignal'.
   (`const reason: unknown = signal.reason;` in abortKind; tsconfig.tests.json's lib lacks AbortSignal.reason, same class as the existing credit.ts one; server/tsconfig.json passes.) tsc exit 2 in both, same as before.
7. git log 6f30bc57..tip: no Co-Authored-By / attribution lines.
