# s4b-kb: keyboard fixes F1 + F2 (triage-chain-24)

## Causes (from reading the code; no device was available to this piece)
- F1, Android plan row edit with no keyboard (API 37). `askForKeyboard` (KeyboardShell.tsx:752) stopped asking for good on
  the first `keyboardWillShow`, and on any blur (`blurred` was set by onBlur and never cleared by onFocus). Its own doc
  says a request can be "aborted by the system after layout": the library emits `keyboardWillShow` from the inset
  animation's onStart (KeyboardAnimationCallback.kt onStart), so an aborted show (onEnd then reports `keyboardDidHide`)
  had already ended the loop, leaving the field focused with no keyboard. A blur then refocus during the reveal ended it
  the same way. Which of the two API 37 hits is not proven: no logcat/ImeTracker lines in a2/a3r.
- F2, iOS Describe opens unfocused once a make has started (i2). KeyboardShell.tsx:797 (old) forced `overlayShown` true
  on iOS, so the field called `focus()` a frame after mount even when its sheet's `Modal` was not presented yet
  (OverlayModal mounts children at phase `up` before `onShow`, and keeps them through iOS `hiding`/re-present). A
  `becomeFirstResponder` on a view not in a window does nothing, and nothing focused it again.

## Fixes (src/host/launcher/KeyboardShell.tsx only)
- `askForKeyboard`: asks once a frame until `keyboardDidShow`, capped at `KEYBOARD_ASK_FRAMES` (120). After
  `keyboardWillShow` it waits up to `KEYBOARD_RISE_FRAMES` (30), then asks again; `keyboardDidHide` before the keyboard
  was up asks again next frame. No asks while blurred, resumes on refocus (onFocus clears `blurred`). Stops at once if
  the keyboard is already settled up (`settledUp && isVisible()`).
- `KeyboardTextInput`: `overlayShown = useContext(OverlayShownContext)` on both platforms. iOS focuses a frame after the
  Sheet's `onShow` (presented && open), so it still waits a frame for the Done bar.

## Tests (src/host/launcher/test/keyboard-shell-ui.suite.tsx)
- :902 (iOS half rewritten): unshown sheet, no focus(); after onShow none that frame, exactly one a frame later, never asked.
- :1001: the iOS case now plays onShow first.
- :1287 (new, Android 14 + 17, plan row): (a) willShow, then the field waits, then didHide, then it asks again and the
  keyboard comes, then no more asks. (b) willShow with nothing after it, then exactly one new ask after the rise wait.
  (c) blur, then no asks, then refocus, then it asks and the keyboard comes.

## Exit codes and red-checks
- `launcher:test --only keyboard-shell-ui` 0 (625 checks); full `launcher:test --mb 4096` 0 (20047 checks); typecheck 0; eslint 0.
- Red F1 (HEAD askForKeyboard + onFocus, F2 kept): 8 fail, all 3 scenarios x 2 Androids. Red F2 (old `|| Platform.OS !==
  'android'`): 2 fail (iOS asserts before onShow).

## Device recheck must look at
- API 37 plan row edit (the "Main screen" row and the "What it is" pencil row): keyboard up with no tap. API 29/34 too.
- If 37 still fails, capture `adb logcat -s ImeTracker InputMethodManager KeyboardController` during the edit.
- Android edge: Back pressed while the keyboard is still rising (<~250 ms) now raises it again within the 2 s window.
- iOS: Describe from the composer after a make started (i2's 3/3 path), first Describe after consent, change mode:
  focused, keyboard up, Done bar on it; also Whim sheet change field, Report note, plan row edit.
