# g09-copy-suite handoff

S91: fixed (structural)
S111: fixed (structural)
S112: fixed (structural)
S113: fixed (structural)
S114: fixed (structural)
S115: fixed (structural)
S116: fixed (structural)
S117: fixed (structural)
S118: fixed (structural)
S119: fixed (structural)
S120: fixed (structural)
S121: fixed (structural)
S122: fixed (structural)
S123: fixed (structural)
S124: fixed (structural)

## Accept proposals
none

## Red-check
none: all structural (S2699 on a test suite; no product behavior changes). A deliberately false condition was shown to fail the suite instead (see commands).

## Fix
copy.suite.ts took `ok`/`eq` destructured from the `h` parameter, which Sonar cannot resolve to an assertion. They are now module-level helpers that delegate to `node:assert` (`nodeAssert.ok`, `nodeAssert.deepStrictEqual`) with the acceptance.ts record-not-throw pattern; failures go to `h.fail` through a module-level sink set by `runCopyTests`. Record-not-throw is load-bearing: the `corrupt` sanity check runs inside the copy's verify step, where a throw would be swallowed as `verify_failed`. `CopySuiteHelpers` is unchanged (saved-data.suite.ts imports it). Side effect: the copy checks no longer count in acceptance.ts's `N checks passed` total (they never reach `h.ok`/`h.eq`); failures still fail the run.

## Commands run
- `capped-run.sh -- npm run -s storage:test -- --only copy`: exit 1 by design (`--only` matches suite names; the copy tests are inside the storage suite, so it ran 0 tests)
- `capped-run.sh -- npm run -s storage:test`: exit 0, 224 checks passed, all 15 copy tests listed
- same with two checks made false (`{c1: 8}` sanity inside the verify step, `[3, 7, 13]`): exit 1, both reported by name; reverted
- `capped-run.sh -- npx eslint --max-warnings 0 copy.suite.ts`: exit 1 only because eslint ignores test files ("File ignored by default"), no rule findings
- `capped-run.sh -- npm run -s typecheck`: exit 0

## Deviations
none

## Revision 1
Review finding [MED] copy.suite.ts: passing checks no longer reached `h.ok`/`h.eq`, so the "N checks passed" total dropped (304 -> 224) and a filtered run of only the copy tests would read as "ran nothing".
- Fix: the module-level `ok`/`eq` (still wrapping `nodeAssert.ok` / `nodeAssert.deepStrictEqual` in try/catch, record-not-throw, non-AssertionError rethrown) now forward a passing check to the caller's `h.ok(cond, msg)` / `h.eq(a, b, msg)` (held in a module-level `sink`, set by `runCopyTests`), and send an AssertionError to `h.fail`. The got/want inspect message is built only on failure, never on a passing call. `record()` and `reportFailure` are gone. No `h.ok(true, ...)` dummies. F177 live-write timing logic untouched.
- Red-check: none: structural (test-helper plumbing). Proven instead (a) below, (b) below.

## Red-check (updated)
none: all structural. Mutation proof, not a red-check.

## Revision 1 commands
- `capped-run.sh -- npm run -s storage:test`: exit 0, `304 checks passed`.
- BASE total: `git checkout 98f556f2 -- copy.suite.ts`, same command: exit 0, `304 checks passed` (equal to the revised total; the first pass's 224 was the regression). Restored afterwards.
- Mutations (a): line 481 `{ c1: 7, c2: 1 }` -> `{ c1: 8, c2: 1 }` (the `corrupt` sanity eq, inside copyStore's verify step) and line 236 `[3, 7, 12]` -> `[3, 7, 13]`: exit 1, `2 FAILED, 302 passed`, both reported by name with got/want. Mutations reverted (diff clean of them); rerun exit 0, 304.
- `capped-run.sh --secs 600 -- npm run -s typecheck`: exit 0 (a first run with the default 180 s cap was CAPPED on the shared machine, exit 137, rerun with a longer cap).
