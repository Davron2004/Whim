# fix-4 dispatch block: keyboard on Android 15+ (R10 confirmed) + Settings + sheet container

Evidence: `openspec/changes/beta-1/acceptance/android/03b2-kb-compose-typed-continue-hidden.png` and 03e, 03f,
03g, 08b. The device is API 37, targetSdk 36, `edgeToEdgeEnabled=false`, `android:windowSoftInputMode=adjustResize`.
On Android 15+ the system enforces edge-to-edge for apps targeting 35+, so `adjustResize` no longer resizes the
window. chain-6's wrapper deliberately adds no avoider on Android (it relied on `adjustResize`), so nothing
lifts the footer.

1. **Keyboard, Android (must).** On every screen that uses the shared wrapper (`src/host/launcher/KeyboardShell.tsx`,
   pure logic in `keyboard-shell.ts`), the focused field and the pinned primary action stay above the keyboard
   on Android 15+ AND on older Android, where `adjustResize` still resizes (don't double-lift there).
   - Compose (Continue), Plan editing (Build it, and the edited row, including the 4th+ row), Clarify "Other"
     (Continue/Next), and the Settings server field.
   - Prefer React Native built-ins (no new dependency; D3): e.g. KeyboardAvoidingView behaviour on Android
     driven by the keyboard frame when the window didn't resize, or measuring the IME inset. Decide from
     evidence: check what RN 0.85's KeyboardAvoidingView and `Keyboard` events report under edge-to-edge
     (read `node_modules/react-native` sources), and whether turning `edgeToEdgeEnabled` on (android/gradle.properties)
     plus RN's inset handling is the cleaner fix. If it's gradle.properties, that is not CONFIG_SET; say so.
   - Update `keyboard-shell.ts`'s per-platform table and its Node suite so the Android behaviour is pinned
     (red-check against today's "no avoider on Android").
2. **iOS keyboard (maybe).** The iOS acceptance is still running. If it confirms R10's iOS risk (a low field
   clipped by the footer; blank space at the scroll end), the dispatcher will SendMessage you the evidence
   during this chain. Keep the design able to take it.
3. **Settings.** Expanding "Advanced" doesn't scroll the revealed server field into view (it's half off-screen,
   `acceptance/android/02a2`). Scroll it into view when Advanced expands. The app also sends a server probe on
   every keystroke while the address is typed (`probeServer` for `localhost:`, `localhost:8`). Debounce it
   (e.g. 600 ms after the last keystroke, plus immediately on submit/blur), with a test using the fake clock.
4. **Sheet container.** The report sheet's dim layer misses the status bar and stops above the navigation bar,
   leaving an undimmed band with a card border showing (`acceptance/android/08b`). It's the same class as #105,
   which chain-8 fixed for the orb with a status-bar-translucent full-window layer. Make `SheetModal`'s dim cover
   the whole window on both platforms, including status bar and nav bar, without breaking keyboard avoidance
   inside the sheet.
5. **Report sheet switch** uses Android's default teal (`acceptance/android/08b`). Give it Whim's indigo via
   `trackColor`/`thumbColor`, matching the Settings switches (find their values; don't invent a colour).
Files: `KeyboardShell.tsx`, `keyboard-shell.ts`, the step screens that use it, `SettingsScreen.tsx`,
`SheetModal.tsx`, `ReportSheet.tsx`, android config if needed, and their tests. NOT `FailureScreen`,
`ConsentScreen`, `app-tile`, fixtures, SDK or `copy.ts` (a parallel chain owns those).
