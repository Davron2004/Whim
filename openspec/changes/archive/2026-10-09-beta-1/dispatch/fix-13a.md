# fix-13a: Android sheet windows and update-required ghost caption

This is the Android portion of the pending fix-13 from the September 26 handoff. It closes the remaining Android device findings for task 10.4.

1. Reproduce the Home tile action sheet and Make a new ID confirmation on the pre-fix offline build on the dedicated Whim_Verify emulator at port 5560. Record the status-bar dim and gesture-bar/card bounds before changing code. Do not touch any other emulator.
2. Make ConfirmSheet and every Home ActionSheet draw the scrim under both Android system bars. Use the existing full-window Modal convention from SheetModal; make the card clear the bottom safe-area inset. Preserve the sibling backdrop/card arrangement and individually accessible actions established by fix-12. Scrim taps still dismiss; action activation must run the action.
3. An update-remedy pending record must display an update-needed ghost caption and retain its route back to the update screen. Carry the existing failure remedy from the record to AppTile. Ordinary failed records must retain their failed caption and interrupted records their interrupted caption. Do not replace the global failed copy.
4. Run the relevant existing rendered launcher suites. Add a behavioral regression only where it checks the record-to-tile outcome or effective window/card behavior; do not add a test that merely repeats a prop literal. Preserve fix-12's accessibility activation tests. Run the fast gate and commit.

Scope: `src/host/launcher/ConfirmSheet.tsx`, `HomeScreen.tsx` (ActionSheet and pending-tile path only), `app-tile.tsx`, `copy.ts` (new update caption only), and relevant `home-grid-ui`, `privacy-settings-ui`, or `flow-messages-ui` launcher tests. No KeyboardShell, PlanStep, shared test helper, runtime, storage, native configuration, or release-script changes. Evidence goes only in `openspec/changes/beta-1/acceptance/android-4/`; report it separately from source commits if another agent is using the main tree.

Acceptance: screenshots show the scrim covering status and gesture bars, sheet controls above the bottom inset, and the update ghost with its correct caption. Rendered activation still exposes each action. The ordinary-failure path retains its semantics. The owner will run the final combined build and device sweep after merge.
