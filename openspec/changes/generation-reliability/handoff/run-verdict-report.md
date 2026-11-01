# chain-run-verdict report

Branch `chain/generation-reliability-run-verdict`, BASE b6a3b2d6. tasks.md not ticked (orchestrator does).

## Tasks

- 1.1 done. `synthrun/contract.ts` (`UNOBSERVED_PHASES`, `UnobservedPhase`, `RunReport.unobservedPhase?`),
  `synthrun/observe.ts` (first-cause recording at `onException`, `recordMountError`, `awaitMount`; stamp in
  `finalizeContainmentVerdict`), `synthrun/report.ts` (copy while `contained === null`).
- 1.2 done. `stages/run.ts` split and one re-run; `RunOutcome` extended in `machine.ts`.
- 1.3 done. `buildAndRun` -> `repairNeverMounted`; repair while budget remains, else `repair_exhausted`.
- 1.4 done. `terminal failure` gains `phase`, `rerun`; `run never mounted` info line; doc comments updated.
- 1.5 done. `server/test/e2e.ts` `testModuleScopeThrowIsRepaired`; `heldRunTurns()` has a repair turn.

## Tests added or rewritten

- `synthrun/test/resilience.ts`: "unobserved phase: each cause is named by the channel..." (module-eval,
  mount-timeout, throw-after-paint with the probes frame dropped by an init script = none, contained run has no
  field). Reached via `--only resilience`.
- `server/test/run-stage.suite.ts`: new `testNeverMountedCandidateIsRepairable`, `testHarnessFaultIsRerunOnce`
  (includes the `[probes]` discriminating control, a re-run that is never-mounted-but-terminal, abort skips
  re-run), `testRerunVerdictIsHandledAsAFirstRunsWould`. Rewritten (assertion count kept): the mount_timeout
  "names the first check" case now uses a probes-phase `runtime_throw`.
- `server/test/run-stage-fixtures.ts`: `sequencedRunCandidate`.
- `server/test/machine.suite.ts`: new `testNeverMountedCandidateIsRepaired`,
  `testNeverMountedWithNoRepairLeftIsRepairExhausted`; rewritten (not deleted) the unobserved-terminal fixture
  and the three log cases (phase/rerun added to the expectations, plus a no message/hint/symbol field check).
- `server/test/e2e.ts` + `e2e-fixtures.ts`: as above.

## Red before (BASE behaviour, run by temporarily restoring BASE production files, then restored from HEAD)

- 1.1 (`synthrun:test --only resilience`, BASE observe/report/contract): `3 FAILED, 92 passed`:
  "a module-scope Intl.NumberFormat throw is attributed to module-eval (got undefined)", "the mount hang is
  attributed to mount-timeout (got undefined)", "a throw after paint ... phase is none (got undefined)".
- 1.2 (`server:test --only run-stage`, stage mutated to BASE mapping): `56 passed, 20 failed`, e.g. "module-eval:
  the outcome is the repairable arm", "a probes-phase report is run exactly twice -- got 1, expected 2".
- 1.3/1.4 (`--only machine`, machine's repairable branch disabled): "never mounted: a repair pair ran, with attempt 1
  -- got [], expected [ 'start:1', 'done:1' ]"; "the model saw plan, generate and exactly one repair turn -- got 2,
  expected 3"; the three log cases fail on missing `phase`/`rerun`.
- 1.5 (`server:e2e`, BASE synthrun + machine + run.ts): `60 passed, 7 failed`: "the run ends in a result ... --
  failure: We couldn’t verify this app ran safely. Please try again. (attempts 1)", "a repair stage ran, once --
  got 0, expected 1".

## Commands (all through capped-run.sh)

- `npm run -s synthrun:test -- --only resilience`: exit 0 (95 checks).
- `npm run -s server:test -- --only run-stage,machine`: exit 0 (590 passed); later `--only run-stage,machine,routes-generate,request-edge`: exit 0 (1375 passed).
- `npm run -s server:e2e`: exit 0 (68 passed, 0 failed).
- `npm run -s typecheck`: OK (173 suite files). `npx tsc --noEmit -p server/tsconfig.json`: clean.
- `npx eslint --max-warnings 0` on every touched file: exit 0 (after extracting `repairNeverMounted` for sonarjs cognitive complexity).

## Deviations

- [A] The `RunOutcome` null verdict has two arms told apart by `repairable: true|false` (not a flat extra field), so
  both consumers stay exhaustive. Existing machine-suite fixtures got `repairable:false`, `phase`, `rerun`.
- [A] The tasks name `resilience.ts` "beside the existing `containment_unobserved` / mount-hang cases"; those live
  in `synthrun/test/acceptance.ts`, so the new case sits in `resilience.ts` as scoped, not beside them.
- [A] `run never mounted` is logged only when the candidate is sent to repair (not when the budget is spent); the
  repair-exhausted terminal line keeps that run's phase instead.
- `docs/deploy.md` describes `terminal failure` lines but lists no field set; not touched.
