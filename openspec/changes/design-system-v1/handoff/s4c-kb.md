# s4c-kb: F1 plan-row keyboard, second pass (after r4a FAIL)

## Cause (confirmed on Whim_Verify API 37, build 99016857 = the s4b-kb loop)
- The ask loop asked for the wrong field. `KeyboardController.setFocusTo('current')` (keyboard-controller 1.22.6) re-focuses
  and shows `FocusedInputHolder`, the EditText its `OnGlobalFocusChangeListener` last saw take focus. That listener only fires
  for a view attached to its window (`View.handleFocusGainInternal` dispatches the global focus change only with `mAttachInfo`).
- The row field's `focus()` (in the mount effect) can run before the view is attached: Fabric runs view commands ahead of the
  mount items that insert the view (the view is pre-allocated, 0x0). The field takes focus detached; on attach the IMM learns
  of it and serves it, the library never does. So `setFocusTo('current')` asked for the previous page's field (the Describe
  field, or a previous row edit), detached, "not served", for all 120 frames, while the row field sat focused and served.
- Evidence `Whim-evidence/design-system-v1/s4c-kb/`: `logcat-base-1.txt` (trial 01:13: first ask: row field `#6bc` at 0,0-0,0 not served,
  then every ask to `#470` at 60,150-1284,456 = the Describe field's frame), `ime-base-1.txt:1690` (earlier trial, ~01:04: `mServedView` = `#68c`,
  laid out 48,138-1176,444), `top-base-1.txt:1320/1325` (same earlier trial: only `#5cc` and `#68c` are in the window: `#470` is detached).
  Same pattern in r4a `logcat-fail-whatitis-5.txt` (IME `onStartInput fieldId=2498` = the 0x0 field, asks to `#992`).
- A trial passes when the command happens to run after the mount: the field's own `focus()` then shows the keyboard
  (0 "not served" lines). Load decides which: so it varied by API level and run, and the frame count was never the issue.

## Fix
- New Android-only TurboModule `WhimKeyboard.showFor(viewTag)` (`src/native/NativeWhimKeyboard.ts`,
  `android/.../com/whim/keyboard/WhimKeyboardModule.kt` + Package, registered in `MainApplication.kt`): on the UI thread,
  resolves the tag; if that EditText is focused and `InputMethodManager.isActive(view)` (served; `isActive` runs the IMM's
  pending `checkFocus` first), calls `showSoftInput(view, 0)`. It never takes focus. iOS has no implementation (null).
- `askForKeyboard` (KeyboardShell.tsx) asks with `WhimKeyboard?.showFor(findNodeHandle(input.current))` instead of
  `setFocusTo('current')`. All other loop behaviour is unchanged (willShow wait, didHide re-ask, idle while blurred, 120-frame
  cap as a safety net only), so F2, the Back-during-rise bound and the other flows keep their paths. No package.json change.

## Tests (keyboard-shell-ui.suite.tsx, native-host.tsx)
- The suite's IME model now matches the device: a request raises the keyboard only if it names the focused field and that
  field is served; `setFocusTo('current')` names `PREVIOUS_FIELD` (an unmounted field), as measured. TextInput node mocks carry
  distinct `nativeTag`s; native-host registers `WhimKeyboard` (records `keyboardShows.tags`) and a `findNodeHandle`.
- Existing asks-counting checks now count `showFor` requests. New test: "Android plan: a row field that took focus before it
  was attached ... every request names the field itself" (Android 14 + 17: keyboard comes the first frame after served; all
  requests name the focused row field).
- `launcher:test --only keyboard-shell-ui` 633/0; full `launcher:test` 20283/0; typecheck 0; eslint (4 touched TS files) 0.
- Red-check, the s4b-kb loop (`setFocusTo('current')` back in the ask): 25 fail, including every "the keyboard comes" check
  in the plan-row and Describe asking tests and all 4 checks of the new test on both Androids.

## Device probe (API 37, emulator-5560, swiftshader, host load 23-35)
- Baseline, old build 99016857: plan-row edit keyboard up 5/8 (3 fails, 67-103 "not served" each).
- Fixed build (worktree tip, offline APK): **14/14** (7 "What it is", 7 "Main screen"; 4 trials had the one early
  "not served" from `focus()` and got the keyboard on the next ask, ~100 ms later). Logs `logcat-fix-*.txt`.
- Describe from Home: keyboard up (once). Back in the same adb call as the row tap, 4 trials: keyboard back up once after
  Back 1, Back 2 puts it away, page stays (the accepted s4b-kb bound, unchanged).
- Not probed on device: Whim sheet send, Advanced address, Report note, tap/drag during the rise (suite-covered; code path is
  the same loop).

## API 29/34 recheck must observe
- Plan rows (both kinds), ≥8 trials per level, keyboard up with no tap. 34: ImeTracker shows at most a few early "not served"
  lines, never a ~120 run or one naming another view. 29 (no ImeTracker lines): `mInputShown=true` ~3 s after the tap.
- Describe, Whim sheet change field, Report note, Advanced address still raise the keyboard; Back during the rise: at most one re-raise.

## Fix pass
- Evidence ids: `#6bc` is quoted from `logcat-base-1.txt` (01:13 trial); `#68c` only from `ime-base-1.txt`/`top-base-1.txt` (earlier trial ~01:04).
- `WhimKeyboardModule.showFor`: one `Log.d("WhimKeyboard", ...)` per view tag while a focused field is not served (cleared once served); no log on the normal path.
- `keyboard-shell-ui.suite.tsx`: comment that the rig models the before-attach case for every field; no behaviour change.
- Checks: `:app:compileReleaseKotlin` exit 0; launcher `--only keyboard-shell-ui` 633 passed; typecheck and eslint clean.
