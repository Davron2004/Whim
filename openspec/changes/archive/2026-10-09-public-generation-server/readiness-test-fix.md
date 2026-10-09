# Readiness timeout test correction

The replay correction's server suite exposed a flaky negative control in
`server/test/deploy-config.suite.ts`: the old-sleep mutant finished in 1062 ms
instead of exceeding 4.5 seconds. Its hanging probe consumed a one-second probe
budget; integer `SECONDS` could then reach the two-second total deadline before
the mutated sleep ran. A passing rerun does not resolve this defect.

## Scope and proof

Only `server/test/deploy-config.suite.ts` and `handoff/readiness-test.md` may change.
Keep the hanging-child timeout case unchanged. Move the sleep mutant into a
separate fresh `withSandbox` case with `STUB_READINESS_FAILS=999`, which immediately
records IAP 4003 on every probe. Do not set `STUB_READINESS_HANG` there.

Run the corrected helper with a two-second total and one-second probe budget.
Require exit 1, named readiness failure, actual IAP 4003 fixture evidence and
elapsed time below 4.5 seconds. Then replace exactly one real
`sleep "$sleep_for"` with `sleep 5` in a temporary copy. Run that helper with the
same limits and assert exit 1, named failure, IAP evidence and elapsed time at
least 4.5 seconds. Capture shell tracing for the synthetic mutant and require an
executed `sleep 5` command, so the negative control cannot pass without reaching
the mutation. Use independent elapsed measurements and an eight-second process
timeout. Never print real deployment configuration or secrets.

No deployment, runtime, Compose or protected gate/configuration change. Run the
server suite, the fast gate and an independent review. Record the existing
failure, the corrected results and the executed mutant evidence in the short
handoff. A full gate on the merged staging tip is required before live retry.
