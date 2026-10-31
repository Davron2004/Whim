# g02-launcher-screens handoff

S7: fixed (structural)
S14: fixed (structural)
S25: fixed (structural)
S44: fixed (behavioral)
S45: fixed (structural)
S46: fixed (structural)
S49: fixed (behavioral)
S52: accept-proposed
S92: fixed (structural)
S93: fixed (structural)

Notes: S14/S25/S45/S46/S92 route a rejection to the module's existing error path with `.catch` (`openFailed`, `historyOperationFailed`, `log.warn`); the promises already handle their own errors, so the handlers are unreachable in practice (`void` is banned by eslint no-void + sonarjs/void-use). S44/S49 only change the diagnostic/alert text for a thrown non-Error object. S93 wraps `renderCell` in an arrow passing (cell, index) as before.

## Accept proposals
S52: `Array.prototype.findLast` is not in the project's TS lib (typecheck: TS2339 on `readonly RunJournalEntry[]`); enabling it needs a tsconfig lib change (out of lane scope) and Hermes support is unverified.

## Red-check
none: see Revision 1

## Commands run
- `npx eslint --max-warnings 0` on the 3 touched files: exit 0
- `npm run -s typecheck`: exit 0 (after reverting the S52 change; the first run exited 2 on findLast)
- `npm run -s launcher:test -- --only home-grid-ui,history-ui,history-logic,history-wait` (--mb 4096): exit 0 ("launcher acceptance green")

## Deviations
- S52 reverted to `.filter().at(-1)` (accept proposal above).

## Revision 1

Review (g02-launcher-screens-1.md) findings:
- MED S44/S49 reclassified behavioral (status lines above rewritten). Added to `src/host/launcher/test/history-ui.suite.tsx`: (1) a History read that throws `{code:7}` / `null` / `'offline'` logs `detail` `non-Error object thrown` / `null` / `offline`; (2) a reopen from History whose `activeLaunch` throws `{code:7}` / `null` alerts `Unknown error` / `null`.
- LOW null guard: `HistoryScreen.tsx` thrownText and `LauncherRoot.tsx` openFailed now test `e !== null && typeof e === 'object'`, so a thrown `null` still shows `null` (covered by the tests above).
- LOW HomeScreen answerCopy `.catch` now logs `String(e)` like `makeCopy` (callback param is `any`, not narrowed-unknown; unreachable in practice, no test).

## Red-check (updated)
`npm run -s launcher:test -- --only history-ui`
Prod files whose revert turns it red: `src/host/launcher/HistoryScreen.tsx`, `src/host/launcher/LauncherRoot.tsx`. Verified once by checking both out at BASE 98f556f2: 2 failures ("got '[object Object]'") for the object cases; restored afterwards.

## Revision 1 commands
- `launcher:test -- --only history-ui` (--mb 4096): exit 0, 447 checks passed (with the fix); exit non-zero, 445 passed 2 failed on BASE versions
- `npx eslint --max-warnings 0` on HistoryScreen/LauncherRoot/HomeScreen: exit 0
- `npm run -s typecheck`: exit 0
