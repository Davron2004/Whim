# harness-s4 handoff (builder) - branch chain/harness-s4, BASE ded0b62b

Nothing in the gate's CONFIG_SET and nothing under src/host/** (except the two run.mjs runners) was touched.
Logs: /Users/davrondjabborov/.cache/whim-run/hs4-*.log

## 1. #238 fixloop-preflight flake - commit 3cef2ec6
- Cause: `assert_contains`/`assert_not_contains` were `printf '%s' "$hay" | grep -qiF` under `pipefail`.
  `grep -q` exits on its first match; if `printf` is still writing it takes SIGPIPE ("printf: write error:
  Broken pipe"), the pipeline fails, and present text reads as "absent". Scheduling decides, so it only
  shows under load. "checkout stderr is preserved" and "undiverged base ... still an ancestor" both go through
  those helpers (the ancestor case reads a fixture-private note: no shared state), so one cause covers all
  three symptoms. NOT reproduced locally (3 MB hay still passed): the cause rests on the issue's logs.
- Fix: `contains()` (bash `[[ == *x* ]]` with `nocasematch`, no pipeline) behind both helpers; the redcheck
  `worktree list | grep -q` now reads captured output. No assertion added or removed.
- File: scripts/test/fixloop-preflight.test.sh. Normal run: 89 passed, exit 0.
- RUNNER repro (red on BASE, green on the tip; use your own scratch dir for PIDS/logs): spin every core, loop
  the test 15x, then kill the spinners by PID:
  `for i in $(seq 1 $(sysctl -n hw.ncpu)); do (while :; do :; done) & echo $! >> $S/spin.pids; done; for n in $(seq 15); do bash scripts/test/fixloop-preflight.test.sh >$S/pf.$n.log 2>&1 || echo "run $n FAILED"; done; kill $(cat $S/spin.pids)`
  BASE should fail some runs ("Broken pipe" / "expected the output to mention"), the tip none. If BASE never
  fails, report the red as unproven, not disproven.

## 2. #230 Modal drag header enumerated as a slider - commit (see git log)
- The SDK Slider already has `role="slider"` and aria-valuenow/min/max (controls.tsx): no SDK change, no
  sdk:test/build needed. synthrun/sweep.ts enumerates `[role="slider"]` instead of `div` + `touchAction:'none'`.
- Test: synthrun/test/sweep-reach.ts "slider: an open Modal sheet's drag header is not a slider, and a real
  Slider is still dragged" (open Modal -> no `slider` in actionsLog; new FIXTURE_SLIDER -> slider enumerated,
  value moved off 50). `node synthrun/test/run.mjs --only sweep-reach`: 126 checks passed, exit 0 (~4 min).
- Red-check: old sweep.ts -> exactly 1 failure, "no slider fingerprint came from the Modal's drag header
  (acted on: ... slider:slider ...)", exit 1 (hs4-sr-red.log).

## 3. `--only` for the Node suite runners - commit 3211e221 (+ follow-up, see git log)
- `scripts/lib/only-filter.mjs` (+ .d.mts): an esbuild plugin removes from the ENTRY (`acceptance.ts`) the
  statements `[await] runX()/testX()` (named import from a `./` sibling, or a function declared in the entry;
  name = module specifier / function name, punctuation ignored) and `[await] test('title', ...)` (name = title)
  that match no `--only` pattern (case-insensitive substring; repeatable or comma-separated). Calls inside arrow
  functions are never filtered. Acceptance files untouched, so new suites are filterable at once and the
  launcher acceptance.ts (edited by every launcher chain) cannot conflict.
- Wired (6 lines each) into launcher, bridge, checks, server, vstore, storage, synthrun; sdk's runner filters its
  `*.acceptance.ts` list. NOT wired: evals (esbuild stdin entry), scripts/*/run.mjs, server e2e/firestore runners.
- No match -> exit 1, "no suite matched --only ..." plus what exists. Without `--only` nothing changes (plugin not
  installed). server:test still runs its two tsc projects first.
- Usage: `npm run launcher:test -- --only haptic-moments-ui` (1.7 s, 176 checks). CLAUDE.md: one line in ## Commands.
- Test: checks/test/repo/only-filter.suite.ts (7 tests: arg forms; suite/title/local-function matching; union;
  no-match keeps nothing; real bridge runner runs one test and fails on no-match; bare run runs all), registered
  in checks/test/acceptance.ts. `node checks/test/run.mjs --only only-filter`: PASS 7, FAIL 0.
- Red-checks: bridge runner without `filter?.assertMatched()` -> the no-match test fails; `matchesOnly` returning
  true -> 4 only-filter tests fail.

## Checks run (final tip)
eslint --max-warnings 0 (touched files; the bridge/storage/vstore run.mjs are eslint-ignored): exit 0.
`npm run -s typecheck`: exit 0. `node checks/test/run.mjs` bare: PASS 450, FAIL 0, exit 0.
`bash scripts/test/fixloop-preflight.test.sh`: 89 passed, exit 0. Not run (not touched): sdk:test, build, gate.

## Fix pass (review) - commit 5f5e1374; review copied to handoff/review-harness-s4.md
- HIGH (1) decide at the call: `findSuites` records each entry-declared suite's titles; `visit` no longer descends into
  those declarations, so a kept call runs its whole body, and a title match keeps the enclosing call (`unit.titles`).
  (2) backstop: `scripts/lib/only-ran.mjs` `onlyRanNothing(n)`; `parseOnly` arms `WHIM_ONLY_FILTER=1`; wired in the final
  report of launcher, bridge, checks (harness.ts), server (harness.ts), vstore, storage, synthrun. sdk:test runs whole
  files, no report to wire. (3) fixtures: LOCAL_SUITES cases (a)/(b) plus the real checks/test/acceptance.ts
  (StorageSurfaceScanner body intact; imports/screens/capabilities keep their calls) and a spawned real checks runner.
- Red-checks (`node checks/test/run.mjs --only only-filter`): old filter (c18aa4a1) -> 5 FAIL, exit 1; weaker variant
  without the title-keeps-call rule -> 3 FAIL (case b); `onlyRanNothing` always false -> 1 FAIL (empty checks report).
- LOWs: `typescript` loaded lazily (filterSource is now async); realpath compare of args.path vs entry; comment at the
  bridge titles (§A duplicate registration, §G4/§G5/§G8) in src/host/bridge/test/acceptance.ts; CLAUDE.md line 52 stays
  one line and says "suite name or test title; sdk:test: a suite file name".
- MEDIUM (#238 repro): runner's, unchanged.
- Verified by hand: `npm run checks:test -- --only StorageSurfaceScanner` -> PASS 7, exit 0; `launcher:test -- --only
  haptic-moments-ui` -> 176 checks, exit 0; bare `npm run checks:test` -> PASS 455 FAIL 0 (450 + 5 new tests), exit 0;
  `synthrun --only observers` -> 90 checks (was an emptied suite), `server:test --only diagnostics` 33 passed,
  storage/vstore filtered runs exit 0, their no-match runs exit 1. eslint --max-warnings 0 and typecheck: exit 0.
- Not run: bridge/storage/vstore acceptance files are eslint-ignored; sdk:test, gate.
