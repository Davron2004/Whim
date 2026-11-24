# Plan: fix-rn088-deprecations

## Checklist

- [x] gh-281 — dev rejection tracking owned; no RN deep import, no LogBox filter
- [x] gh-310 — iOS Done bar off InputAccessoryView; opacity:0 workaround gone

## gh-281
- reconciled: `src/host/platform/install-diagnostics.ts:18,36-43,47-50,57` — LogBox import, `ignoreLogs` filter for the
  deep-import warning, eslint-disabled `require('react-native/Libraries/promiseRejectionTrackingOptions')` in `__DEV__`,
  passed as `previousRejectionTracking`. RN's options: `onUnhandled` → non-fatal `ExceptionsManager.handleException`
  of `Uncaught (in promise, id: N): "<msg>"` (a LogBox *error*); `onHandled` → console.warn "Promise rejection handled…".
- fix sketch: export an RN-free `devRejectionTracking(isDev, sink)` from `src/host/logging/crash-capture.ts` (next to
  `RejectionTracking`): undefined when !isDev (release unchanged); `onUnhandled(id, r)` emits
  `Uncaught (in promise, id: ${id})` + `: "${msg}"` when msg non-empty (undefined → '', Error → Error.prototype.toString,
  string as-is, else JSON.stringify in try/catch falling back to String(r)); `onHandled(id)` emits RN's handled text
  verbatim. Orchestrator call: unhandled goes to `console.error` (matches RN's error-level LogBox entry), handled to
  `console.warn` — so the sink is `{ error, warn }`. install-diagnostics: delete LogBox import, ignoreLogs block, local
  devRejectionTracking + eslint-disable + deep require; pass `devRejectionTracking(__DEV__, console)`. Update the
  "defers to React Native's own" comments (crash-capture.ts:8-9, install-diagnostics.ts:45-46).
- spec: device-diagnostics "Uncaught host errors…" (spec.md:103-116) not contradicted; no delta.
- test-class: behavioral — diagnostics.suite.ts (launcher:test, `runDiagnosticsTests`), cases (a)-(f): Error, undefined,
  string/object/cyclic reason, onHandled text, isDev=false → undefined, end-to-end through installCrashCapture with a
  fake Hermes host (seam error record + one sink call each way). red-without: export missing → suite fails.
- verification: debug launch on a simulator shows no LogBox toast at launch; grep src/ for
  `promiseRejectionTrackingOptions|ignoreLogs` empty; lint green.
- severity: low

## gh-310
- reconciled: `src/host/launcher/KeyboardShell.tsx:25,826,846,863,866-871,887-900,914` — every iOS multiline
  `KeyboardTextInput` (WhimSheet, TextArea in Describe/Plan/Report) links an `InputAccessoryView` DoneBar; `doneBarHost:
  { opacity: 0 }` is the wbp-d3 workaround; test `keyboard-shell-ui.suite.tsx:1208-1220` pins it. KeyboardProvider is
  mounted (`App.tsx:65`); react-native-keyboard-controller 1.23.1.
- rejected alternatives: RN's `inputAccessoryViewButtonLabel` only builds a native toolbar for number-pad keyboards
  (RCTTextInputComponentView.mm:685); `KeyboardToolbar` follows keyboard appearance not tokens, adds arrows, 42pt,
  15pt/600 primary Done, no hairline, floating pill on iOS 26+ — would not keep the look.
- fix sketch: `KeyboardStickyView` hosting the existing `doneBar` row unchanged (surface, separator hairline, Done in
  `text` headline, DONE_LABEL_MAX_SCALE, Keyboard.dismiss). Mounted per window (sheet/OverlayModal root; ReportScreen
  screen frame) through a small context a focused iOS multiline field signals; absolute at the window bottom, hidden
  off-screen when closed. Keyboard overlap/padding (`useKeyboardOverlap`, Sheet `sheetBottomPadding`) add the bar's
  height while it shows, so Continue/Save and the caret stay clear (spec app-launcher:702-719). Delete InputAccessoryView
  import, useId/doneBarId, inputAccessoryViewID wiring, doneBarHost + wbp-d3 comment; drop the keyboardDidChangeFrame
  correction and the one-frame autoFocus only if they existed solely for the accessory (verify on simulator).
  Orchestrator calls: keep the full-width strip look; Android unchanged (no bar).
- spec: app-launcher:702-719 and design/system.md:607 stay true; no delta.
- test-class: behavioral — keyboard-shell-ui.suite.tsx: mock exports KeyboardStickyView; iOS multiline focused → no
  InputAccessoryView, bar mounted in a keyboard-tracked view outside the ScrollView, padding clears keyboard+bar, Done
  dismisses; Android no bar. wbp-d3 test deleted with `Check-removal:` trailer.
  red-without: HEAD renders InputAccessoryView and no sticky bar.
- verification: iOS simulator debug build, light + dark: no LogBox toast at launch or opening the Whim menu field;
  bar look; no white box; field tappable; Done dismisses; Describe Continue / Plan Save visible above bar; ReportScreen;
  one-line fields no bar; drag-dismiss; Orb placement. Android emulator sanity: no bar, padding unchanged.
- severity: low (UI refactor — orchestrator reviews screenshots before merge)
