# Visual findings on chains 15 and 16: triage and fix chains (shift 2, 2026-10-10)

Sources: two device passes on build `895ae528` (before chain-16b), an Android emulator and an iOS
simulator, plus the 16b review leftovers (#174, #175). Evidence:
`~/Work/other/Whim-evidence/visual-2026-10-10/`. Ids below are `iOS-<n>` and `AND-<n>` from those two
reports. A researcher classified each against tip `c345d781` by reading code; nothing here was seen
on a device until the fix chains and the step-3 verifiers ran.

## Triage

Fixed by 16b, to confirm on a device:
- iOS-B1 (Agree leaves no Describe sheet, app dead). 16b added the hand-over; chain 16c reproduces it on a simulator anyway, because the fix rests on a 1 s timer that only the rig has run.
- AND-m4 (Android back closes the whole sheet).
- iOS-m7 / AND-m3, the Terms link inside the checkbox row.

Owned by a later chain:
- AND-M5, Stop leaves no "Stopped" tile: chain 17.
- AND-M3, the offline wording on Plan: task 17.4. The orphan "What I'll make" label is fixed now (16g).
- #175, dead `useSystemBack` on Making, Ready and Failure: chain 17, first tasks.
- #175, Terms link layout on a device: task 24.1.
- iOS-M5 / AND-M6, the composer string: task 21.1 (see decisions).
- AND-M6, no ambient light under the composer: task 22.2.
- AND-M1, the tile is not lifted above the scrim: task 22.3 (M12 menu lift). The menu covering its own row is fixed now (16f).

Not defects:
- iOS-M6. Water Counter is `blue`, light `#0852CB`, in `tokens.ts` and `system.md` §2.4. The mockup is off.
- iOS-m3. The plan is written before the answers by design (task 16.4).
- The Language row reading "Continuer en français". `legal-text-localization` defines the switch that way.
- The two re-consent notices above the first-run title. A legitimate state.
- AND-m6. `system.md` §3.2 gives dark tiles a 1.5 px inner rim.
- AND-m9. Drafts live in memory for the session (progress.md, chain-16 decision).
- The empty-state copy. `system.md` §9 asks for one line of examples and three chips; the mockup's words are not a requirement.

## Decisions taken for the owner

- Composer bar. The mark changes to the 24 pt ember now. The string stays "Describe an app…" until
  task 21.1: three live specs (`app-launcher`, `ai-data-consent`, `terms-acceptance`), the store review
  notes and the upgrade check quote it, so "Make an app…" needs a delta and belongs to the copy sweep.
- Customize tile keeps writing each pick at once, with no Done button. The delta spec says a choice is
  stored as an override and `handoff/home.md` says the sheet writes per pick. Only the mockup has Done.
- "Open" keeps `external-link`, and the first-run rows keep `phone` and `lock`. The vendored icon set
  has no `play`, `shield-check` or `eye`, and `system.md` names no glyph for these rows.
- Plan's "arriving" page gets no separate status line. `system.md` §9 has none; the busy button carries it.
- The back chevron on Plan shares the header row with the close button, so every making page starts
  its headline at the same height (`system.md` §6).
- The iOS "Done" bar above a multiline keyboard stays (`KeyboardShell` adds it on purpose). The blank
  band between Continue and that bar goes.
- The offline notice follows connectivity without a new dependency: a failed request or probe moves
  the state back to offline and the existing probe loop brings it back.

## Fix chains

Two waves. Chains in one wave share no file. `LauncherRoot.tsx` belongs to 16c in wave 1 and 16f in
wave 2; `copy.ts` belongs to 16g only. At most two virtual devices run at once: one iOS simulator and
the `Whim_Verify` emulator on port 5560.

Wave 1 (base: the staging tip after the removal ratchet lands)
- 16c, overlays on iOS (opus, iOS simulator). iOS-B1, iOS-B2, #175 a, b, c, d, f, g.
  Files: `src/host/launcher/LauncherRoot.tsx`, `src/host/ui/Sheet.tsx`, `src/host/ui/ContextMenu.tsx`,
  a new module beside them if needed, `terms-flow-ui`, `shell-surfaces-ui` and `prompt-flow-ui` suites.
- 16e, Home and tiles (sonnet, Android emulator). iOS-M2 / AND-M7 / iOS-m10, the composer mark,
  AND-M8, iOS-m4, iOS-m9 / AND-m5, AND-M9, AND-m7 (chips).
  Files: `HomeScreen.tsx`, `HomeSkeleton.tsx`, `ScrollEdgeFade.tsx`, `ComposerBar.tsx`, `AppTile.tsx`,
  `AppTile-geometry.ts`, `Ember.tsx`, `Toast.tsx`, `Chip.tsx`, `home-grid-ui` and `shell-status-ui` suites.
- 16g, first-run copy and Plan rows (sonnet, no device). #174, iOS-m6, AND-m2, the AND-M3 orphan
  label, the Full details chevron.
  Files: `copy.ts`, `FirstRunSheet.tsx`, `PlanPage.tsx`, `consent-coverage`, `consent-gate-ui` and
  `flow-screens-ui` suites.
- ios-ui-driver (sonnet, no device). The XCUITest driver as `scripts/ios-ui-driver/` with a README (#157).

Wave 2 (base: the staging tip after wave 1, `476a1a30` plus the ledger commit)
- 16d, sheet layout and keyboard (sonnet, iOS simulator). iOS-B3, iOS-M1, iOS-M3 / AND-M4 / AND-m8,
  iOS-M4, iOS-m1, iOS-m8, the close glyph at 200%; from the 16c review, the unused `onClosed` props.
  Files: `FirstRunSheet.tsx`, `MakingSheet.tsx`, `DescribePage.tsx`, `PlanPage.tsx`, `KeyboardShell.tsx`,
  `keyboard-shell.ts`, `ReportScreen.tsx`, `Sheet.tsx`, `handoff/making-sheet.md`, `keyboard-shell-ui` and
  `flow-screens-ui` suites.
- 16f, menu placement and review fixes (sonnet, Android emulator). AND-M1 (placement); from the 16c
  review, the overlay queue's stuck and unmount cases and its untested states; from the 16e review,
  the Undo target on Android (48), the two "plates line up" assertions that pass on old code, and the
  grid label back to 4 pt side padding.
  Files: `ContextMenu.tsx`, `OverlayModal.tsx`, `HomeScreen.tsx`, `Toast.tsx`, `AppTile-geometry.ts`,
  `AppTile.tsx`, `handoff/shell-surfaces.md`, `shell-surfaces-ui`, `terms-flow-ui` and `home-grid-ui` suites.
- 16h, the offline edge (sonnet, no device). AND-M2.
  Files: `connectivity.ts`, `connectivity-ux.ts`, `LauncherRoot.tsx`, `connectivity` suites.
