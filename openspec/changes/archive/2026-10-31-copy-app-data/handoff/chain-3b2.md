# Handoff: chain 3b2 (question UI + docs), copy-app-data

BASE `d54a0d54`, branch `chain/copy-app-data-3b2`. Tasks 3.1–3.4, 4.1–4.2 and the UI half of 3.0. Not ticked.

## What shipped, per task
- **3.1** Precondition met: design-system-v1 15.1–15.6 and 20.1–20.4 are `[x]` in its tasks.md. chain-15 already
  built `CopyQuestionSheet` and gated it on `access.canCopyData` (no placeholder flag left). Kept as is.
- **3.0 (UI)** `LauncherRoot` passes `hasSavedData: (appId) => hasSavedData({ appId })` to `new StoreAccess`, and gives Home
  and History `hasSavedData={onAskSavedData}`, which runs `access.hasSavedData(app)` (the ORIGINAL entry) under
  `runAppOp(... 'fork' ...)`, resolving `null` when the slot is taken. When `canCopyData` is true, Home and History ask it
  first: `false` means fresh at once with no question, `null` means nothing happens. History without the prop asks
  `access.hasSavedData` itself, under its row-action flight.
- **3.2** History asks through the same sheet. New: when the row's hidden-data line shows (`restoreDiffLine === 'reassurance'`),
  the question shows the line under its answers as the section footer (`COPY.copyQuestionHiddenData`).
- **3.3** Failure: `fork-op.ts#copyFailure(error, data)`. A `'copy'` that rejects with `DataCopyError` gives `no_space` →
  `copyNoRoomToast`, `source_unreadable` → `copyUnreadableToast`, `verify_failed`/`io` → `copyDataFailedToast`, each with a
  toast action "Start fresh" that runs `fork(…, { data: 'fresh' })` only when tapped. Any other failure keeps
  `copyFailedToast` with no action. Busy and re-trigger: unchanged `runAppOp` / `RowActionFlight`. No leftover share keys
  or suites were found (design-system-v1 had already deleted them; `fork-ui.suite.tsx` now tests the new question).
- **4.1** `docs/decisions.md` #84. **4.2** `docs/capabilities.md`: new `app-data-copy` line, `linked-apps` amended.

## Decisions / deviations
- [A] The hidden-data line in the copy question uses copy-specific words. The existing `historyHiddenData` says "If you use
  this version … comes back when you return", and its own key comment says it must not be used for a copy. New key:
  "If you copy the data, this version won't show some of it. It isn't deleted." It is computed from the same diff and shown
  before the answer, not after "Copy the data" is chosen.
- [A] "Start fresh" after a failure is offered as the toast's action (6 s), not as a second sheet.
- `docs/decisions.md` #84 includes the chain-4 probe numbers that task 5.1 asked to record in the decision entry.

## Files
`src/host/launcher/{LauncherRoot.tsx,HomeScreen.tsx,HistoryScreen.tsx,CopyQuestionSheet.tsx,copy.ts,fork-op.ts}`,
`src/host/launcher/test/{fork-ui.suite.tsx,home-grid-ui.suite.tsx,history-ui.suite.tsx,app-busy.suite.ts,launcher-interactions.suite.tsx,native-storage.ts}`,
`docs/decisions.md`, `docs/capabilities.md`.

## Tests (new)
- fork-ui (real LauncherRoot): an app with nothing saved is copied fresh, unasked, and leaves no `timer.db`; a legacy copy
  (`storageGroupId`) whose founder's store has data IS asked. Each `DataCopyError` kind shows its words with "Start fresh",
  adds no tile, frees the tile; tapping "Start fresh" forks fresh.
- home-grid-ui: `hasSavedData` false → fresh, `null` → nothing, true → asked; it is asked of the long-pressed app.
- history-ui: the question from v2 (hides notes) shows the line under its answers, and "Copy the data" forks v2 with `copy`.
  From v1 after going back to v2 (nothing hidden), there is no line. A real file-backed rig: nothing saved → fresh, unasked;
  saved → asked. A real garbled original → `source_unreadable` words, "Start fresh" makes a fresh v1 copy with no file.
- Existing LauncherRoot-level copy tests now seed a kv row (`saveUserData`) so they still reach the question.
  launcher-interactions' "delete spares a copy" now copies its never-saved example fresh, unasked.
- Red-checks, each failing the named tests: wiring `hasSavedData({ appId: app.id })` (skips `engineAppId`) → legacy-copy
  test 2 fail; `onMakeCopy(false)` → hidden-line 2 fail; `startFresh: false` for kinds → 4 fail; Home always asks →
  2 tests fail; History skips the read → 1 test fails; "Start fresh" on every failure → home-grid "no action" fails.

## Exit codes
`launcher:test` full 20000/0 (exit 0); `checks:test` PASS 457/0 (exit 0); `typecheck` 0; eslint on touched files 0.
openspec was not re-validated: no spec or tasks text changed.

## Device check list for chain-5 (5.3/5.4)
1. App with records and kv → Make a copy → the sheet shows two rows; "Copy the data" → the copy shows the data.
2. A brand-new app that never saved → Make a copy → no sheet, "Copy made" at once, empty copy.
3. History on an older version that lacks a current field → Make a copy from here → the sheet footer line shows;
   "Copy the data" → the copy runs the old code over the data.
4. The tile shows busy during a large copy; a long-press while it runs opens no menu.
5. Fill the device/sim disk → "Copy the data" → "There wasn't room to copy the data…" toast with "Start fresh".
6. Check pixels: the footer line under the grouped section in light and dark at 100% and 200% text, and that the toast's
   two-line message plus its action fit at 360 pt.

## Fix pass (review-3b2.md, ruling 40 REVISED)
- Fixtures that expect the question now declare `storage` (fork-ui `app`/`appNamed` and Notes/Notes Copy, app-busy fork
  fixture, history Make a copy test uses the Water Counter by name). Timer in fork-ui's "saved nothing" test keeps
  `capabilities: []` as the declares-no-storage case (retitled), so both the current and the 3b1r code agree.
- HistoryScreen: `askCopy(row)` no longer takes the row's captured line; after the saved-data read (and only when
  data is saved) it reads `fieldsLeavingViewOnRestore` itself, so a diff still `pending` at the tap shows the footer.
  A failed diff read says nothing (logged as `hidden-data`). The row actions stay held across both reads.
- Consequence: the question now comes up after one more async read, so seven history-ui sites that pressed Make a copy and
  read the sheet at once now `waitFor(sheetsOpen === 1)`. New test holds `access.diff` open across the tap
  (red against the tap-time capture: footer got 0, want 1).
- Docs: decisions #84 describes the declared-storage mechanism and per-platform probe times; the app-data-copy spec's
  requirement leads with SHALL and carries the skip rule plus a scenario; system.md History row names the footer line.
  Dropped the constants-only `Set` check. tasks.md untouched (3b1r owns it).
- Exit codes: `launcher:test --only fork-ui,history-ui,app-busy,home-grid-ui` 0 (764/0), full `launcher:test` 0 (20002/0); typecheck 0; eslint 0;
  openspec validate copy-app-data --strict: 1.4.1 valid, 1.14.1 the same 4 pre-existing >500-char warnings (none added).

## Fix pass 2 (after the 3b1r merge)
- Merged `integration/beta-2` (3b1r: `hasSavedData` per ruling 40 REVISED, `declarationOf`) into the branch; no conflicts.
- fork-ui "declares no storage": Timer is now installed through `StoreAccess.install` over the launcher's version store with a
  saved `manifest.json` of `capabilities: []`, so it is a realistic no-storage app (fresh, unasked, no file). The saved-data read
  takes a few loop turns, so the test awaits the "Copy made" toast and the Notes Copy question instead of reading at once.
  Red-check: Timer's manifest `{}` (no capabilities key) → the question shows, test fails (exit 1, "timed out waiting for Copy made").
- Specs: app-data-copy says "nothing saved (no key-value or record rows, or storage never declared)" without code names;
  mini-app-versioning says "no other file of the version than manifest and schema", kept under 500 chars (no new warning).
- chain-3b1r.md trimmed to 60 lines (MED 2 BLOCKED folded into its resolution).
- Exit codes: `--only fork-ui,history-ui,app-busy,home-grid-ui,saved-data` 0 (804/0); typecheck 0; eslint 0; storage 0 (304);
  vstore 0 (118); openspec 1.4.1 --strict valid, 1.14.1 exit 0 (same 4 pre-existing warnings under --strict). Full launcher 0 (20028/0, --mb 4096).
