# chain-4 handoff: whim-sheet-see-why-and-copy-label (+ #232)

## What changed
- `WhimSheet.tsx`: new props `failedChange: boolean`, `onSeeWhy()`. While `failedChange && !changing`, the first
  group (the one the Reload row sits in) shows a failed-change row (title `COPY.changeFailedToast`, trailing value
  `COPY.toastSeeWhy`, like the Reload row; label "The change didn't work, See why"). Below Reload when both show.
- `LauncherRoot.tsx`: passes `runningChange.failed !== undefined` and `seeWhy(runningChange.failed.id)`, the
  same `seeWhy` the toast action calls (D4): the sheet closes onto the Failure page over the app.
- `docs/design/system.md` §9 Whim sheet row mentions See why.
- `haptic-moments-ui.suite.tsx:40`: the two new required props added to its WhimSheet render (class A, typecheck).

## 4.4 finding (no data fix)
The rewind continuation already sets `forkedFrom`: `deliverResult` (behind tip) → `continueSharingData` →
`lineageEntry`, the same builder `fork` (Make a copy) uses, which writes `forkedFrom`; `update` spreads the
entry so it survives the landing. `store-access.ts` / `app-index.ts` untouched.

## Tests
- `whim-sheet-ui.suite.tsx` "a failed change of the running app shows See why…": no row before a failure; change
  fails, toast expired (its own `toastDuration` timer fired, toast gone); row on top, send area still there;
  tap → FailurePage (`changing: true`) in the sheet over the same launch; row stays after closing; a new change
  starts → Stop the change and no See why.
- `home-grid-ui.suite.tsx` "an entry made with Make a copy and the continuation…": entries from the real
  producers (`access.fork`, `deliverResult` on a rolled-back app over a memory store), setup asserts the
  continuation shares data and the copy does not, then Home shows both as "copy".

## Red-checks (run once, restored)
- WhimSheet/LauncherRoot at BASE a4349d5e: See why test red ("got 'What should change?', want 'See why'").
- Mutation `lineageEntry` sets `forkedFrom` only when no storage group: Copy test red (`['Water','Water','Water, copy']`).

## #232 cause and fix
Opening the sheet reads the whole chain (`listVersions` → `timeline` with no limit): measured 1.2 s for 102
versions on an already loaded machine (load avg ~20), all of it isomorphic-git reads. `waitFor`'s budget is a
fixed 5 s wall clock, so a >4x slowdown (4-5 concurrent launcher suites) times it out. Fix (test only): the
test records `access.timeline`'s promises and awaits the sheet's read inside act under a real (pre-capture)
120 s timer that fails by name, then the usual `waitFor` for the render. No assertion removed.
- Load runs (10 spinners on 10 cores, plus the machine's own load, whim-sheet suite alone via a scratch runner):
  before the fix GREEN (51 s, did NOT reproduce in isolation); after the fix green (48 s).
- Mechanism reproduced deterministically instead: the read delayed 6 s in the test (temporary) → old wait red
  with the exact #232 message, new wait green.

## For the device runner
Open an app, send a change the stub fails, wait out the toast (~6 s), tap the orb: a "The change didn't work · See why" row (below
Reload if one shows); tap → Failure page in the sheet, close → app.
Send another change: the row is gone while it runs. Check the row at the largest text size (the title wraps).
Copy: change an app after Use this version on an older one → the new tile reads "Copy".

## Fix pass (review-4)
- MEDIUM: the failed-change row now mirrors the Reload row: title `COPY.changeFailedToast`, trailing value
  `COPY.toastSeeWhy`, no chevron (Reload has none), no subtitle/hint. Label reads "The change didn't work, See why".
  Tap behaviour unchanged. Tests use `SEE_WHY_ROW` (the full label) for every selector.
- LOW: `reads.length > 0` setup assertion before awaiting the sheet's chain read.
- LOW: design system §9 rows 774/775 name the row's wording and the Whim sheet's See why row.
- Red-check (once, restored): old title/subtitle/chevron row -> 2 failures ("got 'See why', want 'The change
  didn't work, See why'" plus the press selector). Fixed tree: launcher:test green (EXIT 0), typecheck and eslint clean.
- Assertion count: +1 (the reads check), none removed.
