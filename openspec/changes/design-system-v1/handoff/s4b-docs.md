# s4b-docs: chain-24 triage F5, F7 and the SPEC-ALIGN bullets

Branch `chain/design-system-v1-s4b-docs`, BASE `a33565b1`.

## Code
- F5: `src/host/ui/GroupedList.tsx`. A `GroupedRow` with an icon AND a subtitle now pins the icon
  to the top (`alignSelf: flex-start`, `marginTop = iconTopOffset(fontScale)`), so its centre is the middle
  of the title's first line (`(body lineHeight x min(fontScale, 2) - 20) / 2`; the icon does not scale, ruling 6).
  Single-line icon rows are unchanged (the icon sits in a style-less wrapper View, still centred).
  Other users of the rule: `CopyQuestionSheet` rows (icon + subtitle) now top-align too, by design.
- F7: `GroupedRow` gains `dot?: 'danger'` (8 pt dot in the icon's 20 pt slot, decorative, separator
  inset as an icon row). `WhimSheet.tsx` passes it on the See why row only.

## Tests
- `consent-gate-ui.suite.tsx`: first-run summary rows' icons are flex-start with centre = half the first line, at 1x and 2x.
- `whim-sheet-ui.suite.tsx`: one `danger` 8 pt dot while See why shows; none before a failure, none once a new change runs.
- Red-checks (both mutated at once, log `~/.cache/whim-run/s4b-docs-red.log`): F5 mutated to
  `marginTop: 0` (weaker variant, still flex-start) -> 6 failures (got 10, want 12 / 24); F7 with `dot` removed -> 1 failure.

## Docs and specs (wording per the triage)
- `specs/app-launcher/spec.md` "The Whim sheet is a running app's one menu": History pushes on the native
  stack; its Back and system back reopen the app with the sheet closed (Home if it cannot); scenario added.
  The requirement was 514 chars; restated to 488 (the 40 pt tile, "changed <when>" and "without closing the app" left to system.md).
- `docs/design/system.md`: §9 Whim sheet (same sentence), §6 Keyboard (iOS Done bar, actions above it),
  §9 Report ("What gets sent" row appears once a reason is chosen).
- `specs/content-reporting/spec.md`: MODIFIED "Closing the sheet sends nothing" (header copied from the live spec):
  inside the Whim sheet Back/Cancel/system back go to the sheet menu, Close to the app; nothing sent, draft dropped,
  back never reaches the app. 1.14.1 requires the live scenario name "Back closes an unsent sheet" to be kept: kept, with new content.
- `specs/launcher-screen-exits/spec.md`: native-stack requirement now the standard pop on Android for beta
  (#164, Q2) plus "while the keyboard is up the first back puts it away"; restated 686 -> 488 chars. Scenario
  "Predictive back on Android" renamed "Back on Android pops without a preview"; "Back with the keyboard up" added.
  The other requirement's "Android predictive back" parenthesis reworded to "Android back".
- `tasks.md` 14.2: reworded to the D7 fallback, still `[x]`.

## Validation
`openspec validate design-system-v1 --strict` on 1.4.1: valid. On 1.14.1: valid without `--strict`;
`--strict` exits 1 only on 28 pre-existing ">500 characters" warnings (none on a requirement touched here).

## Not touched
KeyboardShell, PlanPage, LauncherRoot, NativeStack, AdvancedScreen, MainActivity.kt.

## Fix pass
- launcher-screen-exits :53 restores "(when opened from History or Settings)" and "a gesture pop SHALL update it as the header back does" (482 chars); content-reporting :45 now "System back SHALL NOT reach the app".
- "Android predictive back" -> "Android back" in system.md (M13 row, §9 intro) and proposal.md.
- system.md Grouped list: icon beside the title's first line with a subtitle; optional 8 pt danger dot in the icon slot.
- New test in whim-sheet-ui.suite.tsx: icon rows without a subtitle (History, Report, Back to your apps) keep no alignSelf/marginTop. Red-check: `iconPlace = true ? {...}` in GroupedList.tsx fails it (6 checks); reverted.
- launcher:test consent-gate-ui,whim-sheet-ui 0 (448 checks), typecheck 0, eslint 0, openspec validate --strict 1.4.1 and 1.14.1 valid.
