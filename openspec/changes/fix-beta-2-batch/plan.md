# Plan: fix-beta-2-batch

Planner output (side-track planner, 2026-10-30). Read-only: no code was run. Each DONE spec below is for a `fix-worker`; the E2E lines are for a separate runner (builders do not run device passes).

## Checklist

- [ ] F204 — first-run sheet: Language row above the summary
- [ ] F193 — Report page title and Cancel in Android dark mode (verify-first)
- [ ] F177 — copy suite live-write timing check cannot fail from scheduling

## F204

- reconciled: LIVE at `485aecef`. `FirstRunBody` still renders the Language `GroupedSection` last, after the summary rows, the privacy/details section and the expandable disclosure (`FirstRunSheet.tsx:229-231`). No requirement pins the row's position (`legal-text-localization` only requires a one-tap switch on the terms step and consent screen), so the change is spec-silent; only `docs/design/system.md` §9 ("First run" row, which lists Language after Full details) names the order.
- fix sketch: in `FirstRunBody`, move the Language `GroupedSection` from after `{expanded ? <Disclosure/> : null}` to directly after the `head` View and before the three summary rows. Keep the row's `onPress`/value untouched. Update system.md §9 so the row order reads: lead, Language, three summary rows, Privacy policy, Full details, then the terms row.
- DONE (observable): on first run the Language row is the first row under the lead sentence; on an iPhone 17 (Dynamic Type default) both the Language row and the first summary row are fully visible without scrolling, in English and French; the footer (terms row, Agree, Not now) stays pinned as before (`FIELDLESS_FOOTER_SHARE` untouched); switching language still re-renders every string in the other language and persists the choice; tapping Full details still expands in place; at the largest text size the sheet scrolls cleanly, no clipped row.
- allowlist:
  - `src/host/launcher/FirstRunSheet.tsx`
  - `src/host/launcher/test/terms-flow-ui.suite.tsx`
  - `docs/design/system.md`
  - `docs/design/mockups/index.html` (only if the mockup draws the first-run sheet with the row last)
- test-class: behavioral
- test: in the suite that renders `FirstRunSheet` (`terms-flow-ui.suite.tsx`, or `keyboard-shell-ui.suite.tsx` if that is where it is mounted), assert that in render order the Language row precedes the first summary row (`firstRunSentTitle`) and follows the lead (`firstRunLead`), in `en` and `fr`; and that pressing it calls `onLanguageChange` with the other language. Expected red without the fix: the order assertion fails (Language renders last).
- E2E repro (runner, iOS: ONE cloned iOS 27 simulator, iPhone 17, default text size; Android: emulator-5560; own server set to the local stub first): fresh install, tap the composer to open the first-run sheet. BEFORE: screenshot shows the Language row below the fold. AFTER: Language row visible under the lead without scrolling; repeat in French (phone language fr-CA) and at the largest text size (sheet scrolls, nothing clipped); light and dark. Pixel check: row spacing equals the other group gaps (24 pt).
- suggested builder model: **opus**. A layout call judged against a device (what actually fits above the fold, French wraps, the footer share) is live judgment; the code move is tiny but the verification is not.
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/launcher/FirstRunSheet.tsx
        <GroupedRow title={copy.firstRunLanguage} trailing={{ kind: 'value', text: copy.legalLanguageSwitch }} onPress={() => onLanguageChange(otherLegalLanguage(language))} />
```

## F193

- reconciled: POSSIBLY FIXED, no static evidence of the defect remains. The issue named a `SheetModal` card that stayed light; `ReportSheet` was deleted in chain 19i (`5c3a86ef`), Report now lives either on the native stack (`ReportScreen`, host `screen`) or as a page inside the Whim sheet (`ReportPage`, host `sheet`), and 16n-b (`6b27c2c9`) put the Report groups on the `sheet-group` token and made dark-sheet controls follow the scheme. Chain 22 then reworked the sheet card (card opacity, `shrinkInto`). Nothing in `ReportScreen.tsx` hard-codes a light colour (its only `colors.*` use is `t.colors.bg`). Whether the title ("Report a problem", `title2`) and the Cancel button still lose contrast on Android in dark mode can only be answered on a device.
- verify-first protocol (the runner's repro is the stale check; there is no EVIDENCE block, so `fixloop.sh stale` is not applicable and the orchestrator skips it for this finding):
  1. Runner, Android emulator-5560, dark mode (`adb -s emulator-5560 shell cmd uimode night yes`), own server = local stub, an app installed. Open the app, tap the orb, Report a problem (Whim-sheet page); then Home > tile menu > History > Report (native-stack screen). Screenshot both, zoomed on the title and Cancel. Also repeat in light mode as the control.
  2. If both pages read cleanly: the finding is ALREADY-FIXED. Ledger `skipped (fixed by <commit>, device-verified)`; still land the standing contrast test below (it passes at HEAD; test-class `invariant`, no revert-red needed), then close #193 citing 6b27c2c9 and the device screenshots.
  3. If either page shows the bug: the runner records which page and which element, the orchestrator writes the EVIDENCE block from the root cause the fix-worker finds, and the worker fixes it with the test below red first.
- DONE (observable): in dark mode on Android the Report page's title, section header, Cancel and Send are all at least 4.5:1 against the surface they sit on, on both hosts (screen and Whim-sheet page); light mode unchanged.
- allowlist:
  - `src/host/launcher/test/shell-surfaces-ui.suite.tsx`
  - `src/host/launcher/ReportScreen.tsx` (only if the device shows the defect)
  - `src/host/ui/Sheet.tsx` (only if the device shows the defect)
  - `src/host/launcher/WhimSheet.tsx` (only if the device shows the defect)
- test-class: behavioral if a defect is found, else invariant
- test: render `ReportPage` and `ReportScreen` under `resolveTokens({ scheme: 'dark', platform: 'android', ... })` (the harness already has `contrastOf`, used in `keyboard-shell-ui.suite.tsx`), read the resolved text colour of the title and of the Cancel label, and assert `contrastOf(textColour, <the surface behind it>) >= 4.5`, taking the surface from the same tokens (`sheet` for the page, `bg` for the screen). Expected red without a fix: only if the defect is live (then the old colour fails the ratio); at HEAD it passes.
- E2E repro: step 1 above, before and after.
- suggested builder model: **sonnet** for the runner's device repro and for the contrast test; escalate to **opus** only if the repro shows a layering bug in `Sheet`. Why: the first half is a mechanical check with a clear pass line.
- severity: med
- class-1 grant: none

## F177

- reconciled: LIVE at `485aecef`. The test still asserts `waited >= HOLD_MS / 2` where `started` is taken after the parent handles the child's `held` data event (`copy.suite.ts:276`). The write itself is a synchronous `node:sqlite` call on the parent thread, so the parent cannot await its own blocked write, and the child's hold is a `setTimeout` that starts when it prints `held`.
- cause: both clocks start at different moments (child at `held`, parent at event handling). If the parent is scheduled more than HOLD_MS/2 late, the lock is nearly gone before the write starts.
- fix sketch (design, deterministic; the builder may refine but not weaken):
  - the child holds its read transaction until it SEES a marker file the parent creates immediately before the append (`fs.writeFileSync`), polling at a few ms; it then holds for a fixed HOLD_AFTER_MARKER from its OWN observation and commits; it prints `committed <Date.now()>` after COMMIT (stdout line).
  - the parent records `doneAt = Date.now()` straight after `store.records.append` returns, reads the child's `committed` timestamp, and asserts: the append did not throw; `doneAt >= committedAt - 25` (the write could not return before the lock was released; same machine, same clock); `exited` is 0; the row is in the store. Drop the `waited >= HOLD_MS / 2` threshold and keep `waited < BUSY_TIMEOUT_MS` only if it cannot be hit by scheduling (a bound of 5000 ms against a hold of a few hundred ms is fine).
  - A parent descheduled after the marker write and before the append can make the write start after the commit; the test then passes without proving the wait. That can never fail the test, and the engine-mutation below keeps it non-vacuous in normal runs. No retry, no longer timeout, no tolerance widened in place of the redesign.
- DONE (observable): the "live-engine write that meets the snapshot's lock" test cannot fail from scheduling delay alone; it still fails when the engine does not wait for the lock.
- allowlist:
  - `src/host/storage-engine/test/copy.suite.ts`
- test-class: behavioral (test-only change; there are no prod files, so `fixloop.sh redcheck` has nothing to revert: the runner uses the two mutations below instead)
- test: the redesigned test itself. Expected red-without: (1) ENGINE MUTATION: set the busy timeout used by the live engine to 0 (`BUSY_TIMEOUT_MS = 0` in `src/host/storage-engine/busy-timeout.ts`, local and uncommitted) and the test fails (the append throws SQLITE_BUSY, or returns before `committedAt`); (2) SCHEDULING MUTATION: add a temporary `await new Promise(r => setTimeout(r, 600))` in the parent between receiving `held` and the append, and the OLD test fails with `waited < 200` while the NEW test passes. Both mutations are run by the reviewer/runner and reverted.
- E2E repro: `npm run storage:test` through the watchdog, then the same under CPU load: start N busy-loop Node processes by PID (N = core count, kill by PID afterwards), run the suite 3 times; before the fix the old test fails under load only intermittently, so the deterministic proof is mutation (2), not the load run. Do not hunt for the flake with repeat runs (PO: no flake hunts).
- suggested builder model: **sonnet**. Why: self-contained test redesign with a precise protocol and two named mutations.
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/storage-engine/test/copy.suite.ts
      ok(waited >= HOLD_MS / 2, `live write during a snapshot: the write waited for the lock instead of slipping past it (${waited} ms)`);
```
