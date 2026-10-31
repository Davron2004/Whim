# g10-storage-engine handoff

S2: fixed (structural) - `r.name as string` (sqlite_master.name is TEXT; String() was an identity on it)
S8: fixed (structural) - `replaceAll('"', '""')`
S9: fixed (structural) - `r.name as string`
S102: fixed (structural) - `scalar()` now typed `string | number | bigint | null | undefined` (what SQLite returns), so `String()` of it is a primitive conversion
S103: fixed (behavioral) - device file imports the shared `messageOf` from copy.ts
S104: fixed (structural) - same `scalar()` typing
S105: fixed (structural) - same `scalar()` typing
S106: accept-proposed
S107: fixed (structural) - `runAsync` returns `new Promise<void>` whose executor runs the statement, so a throw still surfaces as a rejection (as the async fn did)
S108: fixed (behavioral) - `sqliteCode` uses `messageOf`
S109: fixed (behavioral) - `messageOf` narrows before stringifying
S110: fixed (structural) - `firstValue()` typed as the primitive scalar union, so `String(check)` is a primitive conversion (output identical)

## Accept proposals
S106: `await tick()` in the write-during-copy polling loop must run sequentially: each iteration is one write attempt interleaved with the copy's event-loop turns; `Promise.all` would remove the interleaving the probe exists to measure.

## Red-check
`npm run -s storage:test` (new `test/copy-errors.suite.ts`, called from §H of `test/acceptance.ts`); revert `messageOf` in `src/host/storage-engine/copy.ts` to `err instanceof Error ? err.message : String(err)` (S2/S8/S9/S102/S104/S105/S107/S110 are structural)

## Commands
- see report (typecheck, eslint on the 5 files, `npm run -s storage:test`), run through capped-run.sh

## Deviations
none

## Revision 1
- S103/S108/S109 (MED): exported `messageOf` in `copy.ts` now narrows (Error -> message; string -> itself; number/boolean/bigint -> String; object with string `message` -> that; else `non-Error <typeof> thrown`, `null` named); `sqliteCode` uses it; `copy-device-acceptance.ts` imports it instead of its own copy.
- Test: `test/copy-errors.suite.ts` drives `copyStore` with a node opener whose `runAsync` rejects with `{ message: 'database or disk is full' }`, asserting `no_space` and the text in the error message, plus `messageOf` known answers. Red with the helper reverted: 5 failures (`io`, `[object Object]`); green with it: 313 checks.
- LOW casts: not changed (review: not blocking).
- Commands: `storage:test` exit 0 (313 checks; red run exit 1 with 5 FAILED), `npx eslint --max-warnings 0` on copy.ts + copy-device-acceptance.ts exit 0 (one nested-ternary fix applied first), `npm run -s typecheck` exit 0.
