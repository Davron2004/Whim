# Findings: fix-beta-2-batch

- source: GitHub issues #204, #193, #177 (bodies below, trimmed to the symptom), plus the PO rulings in `/Users/davrondjabborov/.cache/whim-run/po-decisions.md` (2026-10-30, owner-delegated). Reconciled against `integration/beta-2` at `485aecef`.
- lane note: the other seven items of the beta-2 batch change spec-visible behaviour or touch CONFIG_SET, so they are in the whim-harness change `beta-2-spec-fixes`, not here.

## F204: First-run sheet: the Language row sits below the fold on an iPhone 17 at default text size

- severity: low
- files: `src/host/launcher/FirstRunSheet.tsx` (`FirstRunBody`), `docs/design/system.md` §9 "First run" row
- symptom: from #204 (partly fixed by chain 16n-b/16n-b2, merged `6740009d`): "Still open: on an iPhone 17 at default size the Language row is below the fold, because the first legal paragraph is taller than the visible area. That needs an owner call (move Language above the summary, or accept a scroll)". PO ruling 2 (2026-10-30): move the Language row above the summary so it sits above the fold on iPhone 17.

## F193: Android dark mode: the Report page's title and Cancel are invisible on a light card

- severity: med
- files: `src/host/launcher/ReportScreen.tsx` (`ReportForm`, hosts `screen` and `sheet`), `src/host/ui/Sheet.tsx`, `src/host/launcher/WhimSheet.tsx` (`WhimReportPage`)
- symptom: from #193 (found by chain-16m's device check on an Android 17 emulator, dark mode, 2026-10-20): "the Report sheet draws its title and Cancel in dark-mode text colors on a card that stays light, so both are invisible. Either the card ignores the dark tokens, or the header reads the wrong role. iOS dark mode was not reported to have this problem."
- reconcile note: `ReportSheet` was removed in chain 19i and the dark-sheet controls were reworked in 16n-b (`6b27c2c9`, "Report groups on sheet-group in a sheet"). The planner could not find the defect by reading; a device repro decides (see plan.md). PO ruling: fix before testers.

## F177: copy suite: the live-write test's timing check fails when the machine is loaded

- severity: low
- files: `src/host/storage-engine/test/copy.suite.ts` (test "§H copy: a live-engine write that meets the snapshot's lock waits for it and succeeds")
- symptom: from #177: "A child process holds a read lock for 400 ms (`HOLD_MS`) and the test asserts `waited >= HOLD_MS / 2`. The child starts its timer when it prints `held`; the parent takes `started` only after it handles that `data` event. On a machine that schedules the parent more than 200 ms late, the lock is almost gone when the write starts, `waited` comes out under 200 ms and the test fails although the engine did the right thing. It fails, it does not hang." Done when the timing check cannot fail from scheduling alone, and the no-throw and in-store checks stay as they are. PO: fix by deterministic design, no retries, no longer timeouts.
