# g03-server handoff

S134: accept-proposed
S142: fixed (structural)
S143: fixed (structural)
S173: fixed (structural; revision 1)
S174: fixed (structural; revision 1)
S175: fixed (structural; revision 1)
S176: fixed (structural; revision 1)
S301: fixed (structural; check() returns Promise.resolve/Promise.reject, same async contract incl. rejection)

## Accept proposals
S134: per-row Firestore transactions in a migration; deliberately sequential (bounded contention, ordered outcomes map); Promise.all would start unbounded transactions and reject early while others commit.

## Red-check
none: all structural

## Commands
- npm run -s typecheck: 0
- npx eslint --max-warnings 0 report.ts policy.ts: 0
- npm run -s server:test (first pass): not recorded

## Revision 1
- S173/S175/S176: `ResolveTracker.track` (server/src/usage/resolve.ts) now returns void; no caller used the result. resolver.suite.ts calls `tracker.track(slow)` and awaits `slow` directly, same assertions.
- S174: server/src/routes/generate.ts settles admitted rows with `await Promise.all(admittedRows.map(...settleFailedAdmission...))` then `throw err` (settleFailedAdmission catches and logs everything; rows are distinct).
- Red-check: none, all structural (return type and loop form; no observable behavior change).
- Commands: typecheck exit 0; eslint --max-warnings 0 resolve.ts generate.ts exit 0; `npm run -s server:test` (capped-run --mb 4096 --secs 570) EXIT=0, "5180 passed, 0 failed".
