# Deployment acceptance fixes — 2026-09-15

## Observed failures

The attended task 15.4 run used deployed commit
`2acb69cfe0b079d811199b4be1e8085d04b306ab`.

1. `resize.sh --profile event` changed the VM to `e2-standard-8`, then its
   deployment and recovery both failed with IAP 4003, port 22 unavailable.
   A later same-tag deployment succeeded and passed smoke. `resize.sh` checks
   Compute API state immediately after start but never waits for SSH readiness.
2. Cloud Build `4731e19b-1e57-4a5c-b371-1fda0775b3cb` built the replay image.
   `run.sh start` then stopped production and failed with
   `required variable WHIM_LOADTEST_IMAGE is missing a value`. It prefixes
   `WHIM_COMPOSE` with `sudo env`; `WHIM_COMPOSE` already starts with `sudo`,
   so the second privilege transition removes the variable. No failure cleanup
   restored production. The operator's `run.sh stop` restored it and passed smoke.

Research: `deploy/resize.sh:97–108`, `deploy/deploy.sh:169–175`,
`deploy/lib.sh:105–108`, `deploy/loadtest/run.sh:55–74`, and the load-test compose
override's required image variable. The existing fake gcloud logs remote command
text without executing it, so it did not reproduce the nested-sudo behavior.

## Chain acceptance-fixes

Continue the current change and staging run. One chain owns all three repairs
because they share the deployment test fixture and operator documentation.

Allowed files: `deploy/lib.sh`, `deploy/resize.sh`, `deploy/loadtest/run.sh`,
`server/test/deploy-config.suite.ts`, `docs/deploy.md`, and
`openspec/changes/public-generation-server/handoff/loadtest.md` (updated behavior
only, at most 120 lines). No configuration, runtime, application, or security
policy changes; no remote commands from the builder.

1. Wait for IAP SSH with a bounded, idempotent readiness probe after each
   resize-triggered VM start, including recovery. Invoke the actual tag deployment
   only after readiness succeeds, once. Bound persistent failure and name the
   failed step. Do not add blanket retries around arbitrary remote mutations.
2. Pass the exact replay image to Compose through one effective privilege
   transition. Keep the clean-checkout/deployed-tag check and secret exclusion.
3. If start fails after production was stopped, restore the base Compose service
   and verify it with production smoke. Return the original failure even when
   recovery succeeds; if recovery also fails, report both causes. Do not claim
   recovery from an ignored nonzero exit or leave the replay service running.
4. Add behavioral tests, run the fast gate, and update the operator runbook and
   load-test contract to match. Report all red/green results and exact commands.

## Required proof

- Execute the generated remote start command in a fake VM shell with a sudo
  stand-in that sanitizes the environment and a Compose stand-in that requires
  the image variable. The previous command must fail with the observed missing
  variable; the fixed command must pass the exact image through.
- Force a start failure after stop. Require base-Compose restoration and smoke.
  Force recovery failure too and require a visible error preserving both causes.
- Simulate IAP readiness failing with 4003, then succeeding. Prove that only the
  harmless readiness probe repeats and deployment runs exactly once afterwards.
  Persistent failure must be bounded and report the failed readiness step.
- Keep all existing deployment tests and security assertions intact. Do not
  replace behavioral checks with source-text presence checks.

The orchestrator records dispatch, reviews the independent verification, merges
and regates. No task 15.4 checkbox changes until a real load test meets its
original acceptance requirements. Uncovered behavior or protected-file needs
must be reported before expanding this boundary.
