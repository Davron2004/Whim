# g11-launcher-modules handoff

- S39: accept-proposed
- S40: fixed (behavioral)
- S41: fixed (behavioral)
- S42: accept-proposed
- S43: accept-proposed
- S94: fixed (structural)
- S97: fixed (structural)
- S98: accept-proposed
- S99: fixed (behavioral)
- S100: fixed (structural)
- S144: accept-proposed
- S145: accept-proposed
- S302: fixed (structural)

## Accept proposals

- S39, S42, S43 (store-access.ts declaredSchemas): the loop runs inside `serial(repo)`; `seen`/`schemas` are shared and the output order is the timeline order per member. The reads are isomorphic-git reads without a shared cache, which load the whole pack per call, so a `Promise.all` over them is a memory hazard. StoreAccess is the one sanctioned version-store path and keeps these sequential.
- S98 (data-copy-journal.ts sweepDataCopies): each iteration deletes an app's SQLite store through `deleteStorage` and then clears its journal record, and it runs at launch before any store is opened. Serial keeps launch I/O bounded and the per-record failure logs in journal order; it is not a throughput path.
- S144 (pending-purge.ts completeInterruptedPurges): `completePurge` deletes version-store repos and storage per marker; same isomorphic-git whole-pack memory hazard under concurrency, and purges of apps sharing a repo/storage group must not interleave.
- S145 (seed.ts): `access.install` writes the version-store repo and the app index per seed; install order is the grid order of the example apps, and installs on the shared store are deliberately serial (and memory-bounded for the same pack reason).

## Red-check

Command: `npm run -s launcher:test -- --only store-access`
Prod file whose revert turns it red: `src/host/launcher/store-access.ts` (`messageOf`; reverting it to `String(e)` fails the new test "store-access messageOf: a thrown value reads as text, never "[object Object]"": verified locally, 2 checks failed, then restored).

S40/S41/S99 share the exported `messageOf` helper (version-switches.ts and generation-request.ts now import it), so they are covered by that test. Produced string for a non-Error object thrown changes from "[object Object]" to its JSON; undefined/symbol/function read as their type.

## Commands run

- `npm run build`: 0
- `npx eslint --max-warnings 0` on the six touched prod files: EXIT=0
- `npm run -s launcher:test -- --only store-access,generation-request,history-ui,grid-composition,refusal-landing,shared-group,data-copy,data-copy-crash,fork-ui,flow-messages-ui,connectivity-ux`: EXIT=0, 1243 checks passed, 0 failed
- red-check (messageOf reverted to String(e)) `--only store-access`: 2 failed (expected), then restored
- `npm run -s typecheck`: EXIT=0

## Deviations

- `messageOf` in store-access.ts is now exported (was module-private), and carries an eslint-disable comment for its intentional silent JSON catch.
- S302: replaced `useState(0)` with `useReducer((n) => n + 1, 0)` (same re-render-once behavior) rather than inventing a named, unused state value.
