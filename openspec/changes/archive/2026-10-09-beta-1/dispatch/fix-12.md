# fix-12: final reviewer's medium findings (+ #135)

1. **M1: sheets are one accessibility element on iOS.** `src/host/launcher/ConfirmSheet.tsx:40-42` (new in fix-11,
   used by "Make a new ID") puts its buttons inside the dimmed backdrop's `Pressable`, which is accessible by
   default (RN `Pressable.js:252`). On iOS the whole sheet collapses into one element, and a VoiceOver activation
   runs the backdrop's Cancel. The system Alert it replaced was fully accessible. The same structure exists in the
   HomeScreen long-press sheet (`HomeScreen.tsx:225-227`; the real 382511 Maestro dump
   `checks/test/release/fixtures/upgrade-check-ios/tile-menu-382511.json` shows it as one element, #135) and in
   History's restore/copy confirms. Fix all of them the way `SheetModal.tsx:92` and `Orb.tsx` already do: the
   backdrop is a SIBLING behind the card with `accessibilityRole="none"` (or `accessible={false}` on each wrapping
   Pressable), and each action is its own accessible button with a label. The scrim still dismisses on tap. Test
   with the rendered harness that each action is a separate accessible element and that activating an action runs
   that action, not Cancel. Red-check against the current structure.
2. **M2: the spec for History's back.** `openspec/specs/app-launcher/spec.md:280` says History's own back binding
   returns to Home; fix-11 now returns to the app History was opened over (from the orb). Add a MODIFIED delta to
   `openspec/changes/beta-1/specs/app-launcher/spec.md`: copy the live requirement whole and change only the back
   behaviour, plus a scenario "opened from the orb → back returns to the app". SHALL/MUST leads the first line;
   `openspec validate beta-1 --strict` stays green.
3. **L1: History back can't strand the user.** `LauncherRoot.tsx:921-926` with `onOpen` at `:893-904`: if reopening
   the app fails (a bundle read fails and becomes an Alert), the screen stays on History and Back just repeats the
   failing open. Fall back to Home when the open doesn't land. Test it with a failing store read.
4. **L6: the seed test checks the keyboard doesn't cover the label.** `checks/test/release/upgrade-check.suite.ts`:
   the fix-8b case checks the keyboard-dropping label is plain, in the app and in a scroll view, but not that it
   sits above the keyboard, which is the failure fix-8b itself hit. Assert its bounds end above the keyboard's top
   in the fixture (ABOUT at y≈1009, keyboard from y=1517), and red-check with a label under the keyboard.
Scope: `ConfirmSheet.tsx`, `HomeScreen.tsx` (its sheet only), the History confirm UI, `LauncherRoot.tsx` (History
back only), the app-launcher spec delta, `checks/test/release/upgrade-check.suite.ts`, and tests.
