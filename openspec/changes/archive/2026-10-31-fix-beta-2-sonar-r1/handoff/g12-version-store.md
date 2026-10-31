# g12-version-store handoff

S303: accept-proposed
S304: accept-proposed
S317: fixed (behavioral)
S322: accept-proposed
S323: accept-proposed
S324: fixed (structural)
S325: accept-proposed
S326: accept-proposed
S327: accept-proposed
S328: accept-proposed
S329: accept-proposed
S330: fixed (structural)

## Accept proposals
S303: timeline() isLineageCorrect runs git.isDescendent DAG walks sharing one memo cache; running them all concurrently multiplies whole-history walks (memory/IO on Hermes) and races the cache fill; sequential is deliberate.
S304: timeline() readCommitCached loop. isomorphic-git 1.38.4 `git.readCommit` without a shared cache loads and SHA-checks the whole pack per call; concurrently that is N packs in memory (N = every snapshot on the line; `limit` applies after the sort), an OOM risk on Hermes. Sequential is deliberate.
S322: mkdirp creates parent before child (exists then mkdir per path segment); order-dependent.
S323: same site as S322 (the mkdir half of the same line).
S325: snapshot() writes the working file then stages it; index updates are a read-modify-write on one index file, must be serial.
S326: same loop as S325 (git.add on the shared index).
S327: snapshot() untracked-file removal: unlink then git.remove mutate the same index; ordered after the add loop and serial.
S328: same loop as S327 (exists/unlink half).
S329: same loop as S327 (git.remove on the shared index).

## Red-check
`npm run -s vstore:test` ; prod file src/host/version-store/engine.ts: revert `remove()` to a synchronous `this.paths` call before returning a promise (`const { dir } = this.paths(appId); return Promise.resolve(...)`) -> test "§remove reports an invalid app id as a rejected promise, never a synchronous throw" goes red (re-verified in revision 1: 2 failures). S324/S330 are structural (Promise.all over resolveRef, order preserved).

## Commands
- npm run build: exit 0
- npm run -s vstore:test: exit 0 (120 checks passed); with the sync-throw revert: 2 failed
- npx eslint --max-warnings 0 engine.ts: exit 0 (test file is eslint-ignored by config)
- npm run -s typecheck: see Revision 1

## Deviations
none

## Revision 1
Review: reviews/g07-g10-g12-1.md (g12 section).
- HIGH (S304): reverted the timeline() `Promise.all` over `readCommitCached` to the original sequential loop; S304 is now an Accept proposal with the reviewer's reason (above).
- MED (S317): `remove()` is now `return new Promise((resolve) => { const { dir } = this.paths(appId); resolve({ removed: this.backend.removeTree(dir) > 0 }); });`, so it rejects with the original error and no `String(err)` wrapping.
- LOW: the remove test now asserts the rejection reason is an Error matching `invalid app id` (the original), not just that it rejected.
- Red-check: reverting `remove()` to the sync-throw form turns the test red (2 failed); restored, 120 passed.
- Commands: vstore:test exit 0 (120 passed); eslint engine.ts exit 0; npm run -s typecheck exit 0.
