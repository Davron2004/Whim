# Readiness timeout test handoff

## Fixture boundary

- `server/test/deploy-config.suite.ts` is the only test file changed.
- The existing hanging-child case remains unchanged and still uses
  `STUB_READINESS_HANG=1` with an eight-second process timeout.
- A fresh `withSandbox` case runs both the corrected helper and the temporary
  old-sleep mutant with `STUB_READINESS_FAILS=999`. Every probe fails
  immediately with the fixture's IAP 4003 diagnostic.
- No production, deployment, configuration, gate, simulator, or remote action
  changed.

## Failure and behavioral proof

The pre-fix replay run failed at
`/tmp/whim-replay-compose-server-green.log:4593`: the old-sleep check completed
in 1062 ms, below its required 4500 ms. The shared hanging fixture had exhausted
the helper's integer-second deadline before the mutant reached its sleep.

The new case gives the normal helper and mutant separate elapsed measurements.
Both use a two-second total budget, a one-second probe budget, and an eight-second
process timeout. Each must exit 1, name its readiness step, and have IAP 4003 in
its own fake-gcloud log entries.

The first corrected run measured 1327 ms for the normal helper and 5078 ms for
the mutant. The mutant replaces the sole real `sleep "$sleep_for"` call with
`sleep 5`; bash tracing produced the required executed-command marker
`+ sleep 5`. The test requires the normal helper to finish below 4500 ms and the
mutant to take at least 4500 ms.

## Validation

- `npm run server:test` exited 0: 2526 passed, 0 failed. Log:
  `/tmp/whim-readiness-server-green.log`.
- `./scripts/gate.sh` exited 0 with `FAST GATE PASSED`. Log:
  `/tmp/whim-readiness-gate.log`.
- Node was `v22.23.1`.

No deviations or uncovered cases. Independent review, integrity checking,
merge, and the merged-tip full gate remain with the orchestrator.
