# Review 3b2 (Opus high, shift 4b): ACCEPT with findings

Diff d54a0d54..3894cce0. Report honesty: matches diff; no attribution lines.
1. MED fork-ui.suite.tsx:31,:62,:87,:123; app-busy.suite.ts:165: fixtures `timer`, `notes`, `notes-copy` declare no storage
   (`manifest: { capabilities: [] }`, no schemaArtifact) and reach the question only via a kv row. Under ruling 40 REVISED they
   get false without opening → question skipped → these tests fail after 3b1r. Give them declared storage.
2. LOW history-ui.suite.tsx:1341: uses `home().props.apps[0]`; ensure the app declares storage (or pick Water Counter by name, as :1435).
3. INFO fork-ui.suite.tsx:97: `hasDatabase('timer.db') === false` stays right (timer declares no storage) = the ruling's
   "no-storage app → false + no file" test; retitle to say "an app that declares no storage".
4. MED docs/decisions.md:1749 (#84): describe the revised mechanism (no version declared storage → false, nothing touched; else
   open + count rows; transient file possible, never deleted).
5. LOW #84 probe bullet: "175–595 ms" vs progress.md 176–595 (Android), 162–413 (iOS); use per-platform or 162–595.
6. LOW HistoryScreen.tsx:764: `hidesData` captured at tap; a `pending` diff never shows the footer. Compute when the sheet opens
   (after the saved-data read) or keep live.
7. MED (spec gap) specs/app-data-copy/spec.md "Making a copy asks…": no skip rule for an app with nothing saved (ruling 3 only in
   proposal/tasks/system.md:785). Add a scenario (SHALL leads line 1); task 3.0 text stale after ruling 40 REVISED (3b1r).
8. LOW docs/design/system.md:785: History row doesn't mention the copy question's footer line (`COPY.copyQuestionHiddenData`).
9. LOW fork-ui.suite.tsx:117: `new Set([...]).size === 4` checks constants only; drop or keep.
Class-A deviations: new key copyQuestionHiddenData ACCEPTABLE; "Start fresh" as the 6 s toast action ACCEPTABLE (spec only
requires offering it and no silent empty copy; original unchanged, Make a copy re-asks; toasts pause under a screen reader).
Checks: engineAppId via access.hasSavedData(app) (store-access.ts:269-271); busy/re-trigger preserved; promises awaited; capabilities.md accurate.
