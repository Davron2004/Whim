# Findings: fix-wbp-issues

- source: GitHub issues #299–#308 (filed from openspec/changes/webview-bridge-provenance/issues-to-file.md); nested run on integration/webview-bridge-provenance before PR #309 merges. Owner asked for all ten to be fixed in this PR (2026-11-23); #308's owner call is taken by the orchestrator under that instruction: reword the notice to name the safety checks, matching the consent sheet.

## gh-299: Static checks don't flag frame self-navigation or bridge names (checks/contract.ts:259)

- severity: low
- source: https://github.com/Davron2004/Whim/issues/299

- **Body:** The static passes (`FORBIDDEN_DIRECT_NAMES`/`FORBIDDEN_MEMBER_PATHS`, `checks/contract.ts:259-282`)
  let a candidate write `location.href = 'data:text/html,…'` (bare or through `window`/`globalThis`), or name
  `ReactNativeWebView` or `webkit`, without a finding. At runtime this is contained (decision #89: the token
  refuses the navigated document's posts, iOS refuses the navigation, the frame holds no bridge), so this is
  about steering the model and catching hostile candidates before the run, not containment. Done looks like:
  the forbidden-global pass reports `location` assignment/`assign`/`replace` and the two bridge names
  (through any global root or alias), with fix hints; `checks/test` cases for each form, red-checked; the SDK
  reference stays clean (the SDK's own `events.ts` is not candidate source). Check the false-positive rate on
  the corpus first (`docs/app-corpus.md`).

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-300: Settings → Advanced: "Send error details" switch looks dark or disabled in both states

- severity: low
- source: https://github.com/Davron2004/Whim/issues/300

- **Body:** On Android the switch is a black track with a grey thumb when on and a grey track with a black
  thumb when off (`android-5.1-rerun-5.4.md`, screenshots `b14` vs `b20`); the on state reads as disabled.
  Where: `src/host/launcher/AdvancedScreen.tsx:179` (`GroupedRow` `trailing: switch`) and the switch styling
  it uses. Done looks like: the on state uses the accent track, both states are distinguishable in light and
  dark, checked on Android and iOS.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-301: Settings → Advanced: "Server address" label sits further left than other section labels

- severity: low
- source: https://github.com/Davron2004/Whim/issues/301

- **Body:** The "Server address" label and its helper lines align with the card's outer edge (x ≈ 60 px on
  a 1344 px screen) while "This phone" and "Server" align with the text inside the card (≈ 110 px)
  (`android-5.1-rerun-5.4.md`, `b14`). Where: `src/host/launcher/AdvancedScreen.tsx:200`. Done looks like:
  every section label and hint on the screen shares one inset, verified by screenshot on both platforms.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-302: First-run sheet: "What stays on your phone" uses a phone-call icon

- severity: low
- source: https://github.com/Davron2004/Whim/issues/302

- **Body:** The row uses a telephone-handset icon, which reads as "calling" rather than "this device"
  (`android-5.1-rerun-5.4.md`, `b03`). Where: `src/host/launcher/FirstRunSheet.tsx:224` (`icon="phone"`).
  Done looks like: a device/smartphone glyph from the vendored icon set.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-303: Dev builds: Logs chip overlaps the Whim menu orb and clips the composer; Logs panel shows UTC unlabeled

- severity: low
- source: https://github.com/Davron2004/Whim/issues/303

- **Body:** The dev `Logs` pill (`src/host/launcher/LauncherRoot.tsx:757`) covers the round Whim menu button
  in a running app (only its top edge is tappable) and sits over the right end of the "Make an app…" bar on
  Home, clipped by it (`ios-5.3-rerun.md` `07`, `11`; `android-5.1-rerun-5.4.md` `a0-launch.png`). The Logs
  panel prints times in UTC with no label (`src/host/launcher/dev-log-view.ts:67`, `formatRecordTime`;
  `ios-5.3-rerun.md` `05`), which reads as wrong next to the status-bar clock. Done looks like: the pill is
  placed clear of the orb and the composer on both platforms, and the time carries a `UTC` marker (keep UTC:
  it lines up two devices' logs). Dev-only.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-304: DevProbe: first fixture tap after opening is ignored; status-bar strip is light above the dark bar

- severity: low
- source: https://github.com/Davron2004/Whim/issues/304

- **Body:** After opening DevProbe by long-pressing "Your apps", the first tap on a fixture chip does
  nothing, on both platforms, every time (`android-5.1-5.2.md` side observation 1, `ios-5.3-rerun.md`
  `13`); a tap anywhere first works around it, which points at a responder left by the long-press. And the
  status-bar strip above the dark probe bar is the light app background (`android-5.1-5.2.md`, `ios-5.3.md`):
  `src/host/launcher/DevProbeScreen.tsx:11` uses React Native's deprecated `SafeAreaView`, whose background
  does not reach under the status bar. Done looks like: the first tap launches; the screen uses
  `react-native-safe-area-context` like the other probe screens, with its dark background under the status
  bar. Dev-only.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-305: Dev launch shows the "Open debugger to view warnings" toast every time

- severity: low
- source: https://github.com/Davron2004/Whim/issues/305

- **Body:** Every debug launch on both platforms shows the yellow LogBox toast, from three warnings:
  (a) the deprecated deep import `react-native/Libraries/promiseRejectionTrackingOptions` at
  `src/host/platform/install-diagnostics.ts:40`; (b) `SafeAreaView has been deprecated`
  (`src/host/launcher/DevProbeScreen.tsx:11`, see issue 6); (c) `[Reanimated] Dependencies should only be
  used on the web and are always ignored on native` (call site not located: look for a Reanimated hook
  given a dependency array). Done looks like: a debug launch with no warning toast; (a) needs a public
  replacement or a documented, filtered exception.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-306: iOS: committed Podfile.lock is stale, and pod install re-sorts WhimRandomModule.mm in project.pbxproj

- severity: low
- source: https://github.com/Davron2004/Whim/issues/306

- **Body:** A fresh `pod install` (CocoaPods 1.17.0) changes `ios/Podfile.lock` (the ReactCodegen checksum
  and the `COCOAPODS` version, committed as 1.15.2) and re-sorts the two `WhimRandomModule.mm` entries in
  `ios/Whim.xcodeproj/project.pbxproj` (order only). Every iOS build run had to restore both files
  (`ios-5.3.md`, `ios-5.3-rerun.md`). Done looks like: both files committed in the state `pod install`
  produces with the CocoaPods version the docs name, so a clean install leaves the tree clean.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-307: bundle exec pod install fails in a fresh checkout; the release doc still leads with it

- severity: low
- source: https://github.com/Davron2004/Whim/issues/307

- **Body:** Every runner in this change found `bundle exec pod install` failing (Gemfile gems not installed,
  or vendored gems without native extensions) and used the system CocoaPods 1.17.0 instead.
  `docs/release/mobile.md:161` gives `bundle exec pod install` as the step; `:164` and `:373` describe the
  failure and a workaround. Done looks like: one documented install path that works in a fresh worktree
  (either `bundle install` as an explicit first step that succeeds, or system CocoaPods with the version
  pinned and checked), with the doc and issue 8's lockfile agreeing on the CocoaPods version.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.

## gh-308: The v1-upgrade "what's new" copy still says "error details when something goes wrong"

- severity: low
- source: https://github.com/Davron2004/Whim/issues/308

- **Body:** Error details now also include automatic app safety check results (decision #89), and the
  consent screen, first-run sheet, Settings hint and privacy pages were reworded, but the upgrade notice in
  `src/host/launcher/copy.ts:676` and its `covers` phrase `'category:error-details': 'error details when
  something goes wrong'` (`copy.ts:678`; French `copy.ts:699`) were not. The sentence is still true, only
  stale. It needs an owner call because a `covers` phrase names a widening the v1 consenters are told
  about, and the disclosure release check (`checks/test/release/disclosure.suite.ts`) requires every phrase
  to occur in `text`. Done looks like: the owner decides whether to reword; if so, `text` and its `covers`
  phrase change together in both languages and `npm run checks:test -- --only disclosure` stays green.

Found during the `webview-bridge-provenance` run (2026-11-22); see `openspec/changes/webview-bridge-provenance/issues-to-file.md`.


## Round 2: device verification of the merged tip d2e0ff80 (2026-11-23)

Source: the Android (`Whim_Verify`, emulator-5560, debug + Metro) and iOS (iOS 27 simulator clone, debug + Metro)
screenshot passes over the round-1 fixes. Screenshots: scratchpad `dev-android/`, `dev-ios/`.

## wbp-d1: an early mini-app launch from DevProbe fails with NoBridgeToken (iOS)

- severity: med
- files: src/host/launcher/DevProbeScreen.tsx, the bridge-token path (src/host/launcher/runtime-message-auth.ts and its consumers)
- symptom: tapping a fixture chip within ~1 s of DevProbe opening gives a blank panel, "running… —", `err: no bridge
  token`; Logs: `whim:page error "mini-app failed" where=launch · errorClass=NoBridgeToken · appId=tip-splitter`
  (3/3). A second tap, or waiting ~2 s, works (CONTAINED 52/52). Must establish whether the product launch path
  (opening an app right after the WebView mounts) can hit the same race.

## wbp-d2: the dev LogBox "Open debugger to view warnings" toast still shows (both platforms)

- severity: low
- files: src/host/platform/install-diagnostics.ts, App.tsx
- symptom: on every debug launch. Console: `Deep imports from the 'react-native' package are deprecated
  ('react-native/Libraries/promiseRejectionTrackingOptions')` from install-diagnostics.ts 49:19 (the
  `LogBox.ignoreLogs` added for gh-305 does not keep it out of LogBox), and `[Reanimated] Reduced motion setting is
  overwritten with mode 'system'.` (App.tsx:66 `ReducedMotionConfig`). The toast also covers the composer bar.

## wbp-d3: the Whim menu sheet's "What should change?" field paints a white rectangle (iOS)

- severity: med
- files: the Whim menu sheet's text field (src/host/launcher/WhimSheet*.tsx, src/host/ui/TextField.tsx)
- symptom: a white rectangle over the rounded field, extending past its right border to the screen edge, no
  placeholder; persists after 3 s (`dev-ios/x-whim-menu-textfield-artifact.png`). Product screen.

## wbp-d4: iOS dark-mode switch knob is near-black

- severity: low
- files: src/host/ui/GroupedList.tsx (RowSwitch), src/design/tokens.ts
- symptom: in dark mode the iOS knob is `on-ink` dark (#1A1614) on both the green ON and grey OFF tracks; the
  native iOS switch knob is white in both schemes (`dev-ios/i05-dark-off.png`, `i06-dark-on.png`).

## wbp-d5: Advanced still says "Checked once AI features are on" after consent

- severity: low
- files: src/host/launcher/AdvancedScreen.tsx, copy.ts
- symptom: the line shows under the server address even after AI features were consented to and a request had
  gone to the server.

## wbp-d6: DevProbe's chip row shifts while status text arrives (dev-only)

- severity: low
- files: src/host/launcher/DevProbeScreen.tsx
- symptom: the chip row moves y=166 → 181 → 194 pt as the bridge and exposure status lines arrive and wrap, so an
  early tap lands on the old position.

## Round 3: side findings from the round-2 device runs (2026-11-23)

## wbp-d7: Settings → AI features: "Continuer en français" sits under the header back button (iOS)

- severity: low
- files: the AI-features consent screen (src/host/launcher/*Consent*.tsx / settings screens)
- symptom: the language-switch label overlaps the native header's back button. Product screen.

## wbp-d8: the dev Logs screen keeps a white status bar on a light background (dev-only)

- severity: low
- files: src/host/launcher/LauncherRoot.tsx (DevLogTools), src/host/launcher/dev-log-view.ts
- symptom: opened over DevProbe (dark, light-content status bar) or Home, the Logs panel's status-bar clock stays
  white on the light panel.
