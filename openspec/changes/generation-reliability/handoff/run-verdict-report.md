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

## Fix round 1 (review `run-verdict-review-1.md`: findings 1, 2, 3, 4, 5, 7; 6 accepted as-is, parked loader issue filed by the orchestrator)

| # | Change | Test | Red evidence (mutation, types kept) |
|---|---|---|---|
| 1 | `RunOutcome` `contained:false` arm carries `rerun`; stage sets it; `contained-failure` carries it to the `terminal failure` line. `handoff/run-verdict.md` updated. | `machine.suite` case "containment_failed after a re-run" (sequenced unobserved then breach, asserts `rerun:true`); `run-stage.suite` asserts `rerun` true after a re-run breach and false on a first-run breach | stage hardcoded `rerun: false` on the breach arm: both fail ("and it says the candidate was re-run — got false, expected true", terminal-line case) |
| 2 | `e2e.ts`: the diagnostics line must match `/runtime_throw[^\n]*Currency code is required/`; the streamed `diagnostic` event message must hold it too | `server:e2e` module-scope throw case | `toWireDiagnostic` sending `message: d.kind`: both fail |
| 3 | Fixture now throws from a timer armed by a first-render `useEffect` (400 ms, after the paint frame), run with a wider quiet window | `synthrun` resilience "unobserved phase" | `if (state.paintAtMs === null)` removed from the module-eval stamp: "a throw in an effect after the first paint ... (got module-eval)" |
| 4 | Test-side transport rewrite (`rewriteProbesFrames`: drop / loader `[probes]` error frame / non-boolean `contained`, keeping the real `trusted` flag) replaces `dropProbesFrames` | same case: asserts `probes` and `none` | `LOADER_PHASES` recording removed: "got mount-timeout"; unobserved stamp changed to `mount-timeout`: the malformed case fails "got mount-timeout" |
| 5 | Comment in `machine.suite.ts` says the machine never calls `run` twice and the stage owns the one re-run | - | - |
| 7 | `RunOutcome` delivered arm gains optional `rerunOf` (first run's phase); the machine logs info `run re-run {phase}` | `machine.suite` "a re-run that then delivers is logged": one line with `phase:'probes'` and no content; none without a re-run | log line deleted: the case fails (`got []`) |

Note on 3: a throw from the effect BODY (synchronous on first render) was tried first and measured as `module-eval`:
the effect runs before the loader's double-rAF `paint` frame, so the CDP exception beats it. This is safe (the candidate
goes to repair) but differs from the spec scenario's wording; the test comment records it as out of scope, and the fix would
need a new channel (a loader `mounted` frame).

Commands (all through `capped-run.sh`): `npm run -s typecheck` exit 0; `npx eslint --max-warnings 0` on the 6 touched TS files exit 0;
`server:test --only run-stage,machine` exit 0 (601 passed, 0 failed); `synthrun:test --only resilience` exit 0 (100 checks);
`server:e2e` exit 0 (68 passed). Red runs exited 1 as shown above; every mutation was restored (`git diff` shows only the intended change).
