# g08-saved-data-suite handoff

S1: fixed (structural)
S3: fixed (structural)
S4: fixed (structural)
S5: fixed (structural)
S6: fixed (structural)
S10: fixed (structural)
S11: fixed (structural)
S12: fixed (structural)

Fix: Sonar could not follow `ok`/`eq` destructured from the `h` parameter, so all 8 tests looked assertion-free. `runSavedDataTests` now defines local `ok`/`eq` that assert through `node:assert` (`nodeAssert.ok` / `nodeAssert.deepStrictEqual`, message keeps the got/want text) and then forward to `h.ok`/`h.eq` so the shared harness's pass count is unchanged (26 checks). A failed assertion throws and the existing `test` wrapper records it through `fail`.

## Accept proposals
none

## Red-check
none: all structural (test-only change). Manual check: flipping one `eq` expectation (`never-ran` -> `true`) made `npm run storage:test -- --only saved-data` exit 1 with the AssertionError reported as a THREW failure; reverted.

## Commands run
- `npm run build` exit 0
- `npm run storage:test -- --only saved-data` (capped) exit 0, 26 checks passed
- deliberately false condition: exit 1 (reverted)
- `npm run -s typecheck` (capped) exit 0
- `npx eslint --max-warnings 0 <file>`: exit 1 only because test files are in the eslint ignore list ("File ignored by default"); no lint findings

## Deviations
- Sonar's recognition of the local wrapper helpers could not be verified locally (needs a scan); if S2699 persists, the helpers would need to move into acceptance.ts (outside this allowlist).

## Revision 1

Review: reviews/g04-g08-g09-1.md (g08 section).
- [MED] saved-data.suite.ts helpers: replaced throw-then-forward with the prescribed record-not-throw shape (modelled on acceptance.ts `record`). `ok`/`eq` run `nodeAssert.ok` / `nodeAssert.deepStrictEqual` in a try; a non-AssertionError is rethrown; an AssertionError goes to `h.fail(msg)` and the test continues (one run reports every failure); on success the real arguments are forwarded to `h.ok(cond, msg)` / `h.eq(a, b, msg)` (pass count kept, no `h.ok(true, ...)` dummies).
- [LOW] `eq` no longer builds the inspect message on passing calls: the got/want text is built only in the catch.

## Red-check
none: all structural (test-only change). Manual proof instead: with two checks in one test mutated false (`'zero'` expectation `false`->`true`, length `0`->`99`) `npm run storage:test -- --only saved-data` exited 1 with `2 FAILED, 24 passed` and both failures listed (`got false, want true`, `got 0, want 99`), i.e. the test did not stop at the first. Mutation reverted. Passing run: 26 checks passed, equal to the BASE (98f556f2) count of 26.

## Revision 1 commands
- `npm run build` exit 0
- `npm run storage:test -- --only saved-data` (capped): BASE version 26 passed; fixed version exit 0, 26 passed; mutated exit 1, 2 FAILED / 24 passed; reverted, exit 0, 26 passed
- `npm run -s typecheck` (capped): exit 0 (first attempt hit the 180 s cap on the busy machine, exit 137; rerun with --secs 400)
- eslint: not run (test file is eslint-ignored)
