# VERIFY g02-launcher-screens (Opus, round 1): REJECT

- [MED] src/host/launcher/HistoryScreen.tsx:103 (S44) and src/host/launcher/LauncherRoot.tsx:1352 (S49): both fixes change the text produced for a thrown non-Error object (History log detail `[object Object]` -> `non-Error object thrown`; user-visible open-failure alert `[object Object]` -> `Unknown error`). Rule guide: S6551 needs a behavioral red/green test when the produced string changes; the handoff called both structural and no test exists. Required: launcher-suite tests (node:assert-backed `h.*`) that throw a plain object through `historyOperationFailed` and through `openFailed` and assert the new log detail and alert message; each must go red on the old code.
- [LOW] HistoryScreen.tsx:103 and LauncherRoot.tsx:1352: `typeof e === 'object'` is true for `null`; a thrown `null` used to show `null`. Use `e !== null && typeof e === 'object'`.
- [LOW] HomeScreen.tsx:453: the new `.catch` logs `'unknown'` for a non-Error while `makeCopy` (line 433) logs `String(e)`; unreachable, but make them match.
- Other fixes preserve behavior: S14/S25/S45/S46/S92 `.catch` into existing error paths (unreachable: callees catch internally); S7 callers still get a Promise; S93 arrow passes `(cell, index)`.
- accept-proposals: agree S52 (findLast not in TS lib).
