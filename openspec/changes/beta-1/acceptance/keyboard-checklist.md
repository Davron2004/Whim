# 10.4 keyboard checklist (from chain-6's report; risks in progress.md R10)

Check on a newly created iOS simulator and a fresh API 36 Android emulator.

## Known risks, reproduce first
- **iOS inset + footer avoider:** a low focused field can be clipped by the pinned footer (~76pt) and leave blank
  space at the scroll's end. Try plan row 4 or later, and "Other" on clarify question 2 or 3.
- **Android 15+ edge-to-edge:** `adjustResize` may not resize the window, so nothing lifts Continue.

## Per screen
- **Compose** (also opened by "Change it", "Prompt again" and history's "Change it from here").
  Frame `ComposeStep.tsx:65`, field `:92`.
  - iOS: opens with no keyboard and the suggestions visible. With the keyboard up, Continue sits about 24pt
    above the Done bar. Done, a tap on empty space or the header, and dragging down each dismiss without
    continuing. No blank space at the end of the scroll.
  - Android: Continue stays above the keyboard. Drag or an empty-space tap dismisses. Back closes the keyboard
    first. There's no Done bar.
- **Plan editing.** Frame `PlanStep.tsx:127`, field `:163`.
  - iOS: edit the last row (the 4th or later) and check the cursor isn't cut off above Build it. Done dismisses
    without saving. Save and Cancel work with the keyboard up.
  - Android: the same, with no Done bar.
- **Clarify "Other"** (`OtherAnswerField`). Frame `ClarifyStep.tsx:93`, field `:250`.
  - Both: type in "Other" on the last question; the field stays visible above Next and Return dismisses. Pills
    react to the first tap while the keyboard is up.
- **Report sheet.** Frame `ReportSheet.tsx:192`, field `:234`. SheetModal's avoider (`SheetModal.tsx:66`) is the
  only one.
  - iOS: the sheet rises above the keyboard, and Send and Cancel stay pinned and visible. The Done bar attaches
    inside the Modal. Tapping the scrim still closes the sheet.
  - Both: Send and Cancel are pinned below the scrolling draft even with the keyboard down (a new layout).
- **Settings server address** (internal builds, Advanced). Frame `SettingsScreen.tsx:177`, field `:301`.
  - iOS: focusing it scrolls it above the keyboard with no extra padding, and the switches respond while typing.
  - Android: it stays above the keyboard.
