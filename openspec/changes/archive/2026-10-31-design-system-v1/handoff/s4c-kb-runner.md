# s4c-kb runner verdict (branch chain/design-system-v1-s4c-kb, tip 8cac6ebe, BASE e21ba88f)

Overall: PASS

1. Tree clean (only untracked .gitkeep/logs); attribution lines in e21ba88f..HEAD: 0.
2. Fast gate (capped-run 6144 MB / 3000 s): exit 0, "FAST GATE PASSED", `^FAIL` count 0, not CAPPED.
3. Integrity (FIXLOOP_INTEGRATION_BRANCH=integration/beta-2, allow/s4c-kb.txt): exit 0, INTEGRITY OK.
   Changed: MainApplication.kt, WhimKeyboardModule.kt, WhimKeyboardPackage.kt, handoff/s4c-kb.md, KeyboardShell.tsx,
   keyboard-shell-ui.suite.tsx, native-host.tsx, NativeWhimKeyboard.ts.
4. Removal ratchet (in gate): ran from 0ccd05d2 (base predates ratchet), 152 files compared, passed; only prior
   `authorised:` lines (failure-screen, orb-menu, prompt-flow-screens, prompt-flow-wiring, tile-colour, theme, tints),
   none from s4c-kb files.
5. Red-check: KeyboardShell.tsx showFor -> setFocusTo('current'); `launcher:test --only keyboard-shell-ui` exit 1,
   25 failures (incl. "first frame after the window is served raises the keyboard", "every request named the focused
   row field, none the page before's field" on Android 14 and 17, "show ended hidden ... asks again", "once the
   keyboard is up it asks no more", "focused again before the keyboard came, it asks again"). Restored with git checkout; tree clean.
6. Native compile: `./gradlew :app:compileReleaseKotlin` (capped 8192 MB, taskpolicy -b): exit 0, BUILD SUCCESSFUL.
