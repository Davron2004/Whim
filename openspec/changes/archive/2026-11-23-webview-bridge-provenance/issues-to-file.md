# Issues to file: webview-bridge-provenance (task 6.3)

Every entry below is meant to be filed as a GitHub issue with the label `ai-proposed`. Rows of the
research.md pattern census (Part A and Part B) were re-checked against the final code on the staging
tip `7786dd2c`.

## Census re-check

| Census row (research.md) | Verdict then | Now | Why |
|---|---|---|---|
| A `useMiniAppHost.ts:318` `onMessage` | UNSAFE | Fixed | `channel.receive(raw)` verifies the `W1.<token>.` envelope before parsing (`useMiniAppHost.ts:355`); `runtime-message-auth-ui.suite.tsx` |
| A `boot-state.ts:100` `paintAccepted` | UNSAFE | Fixed | Reached only through the verifier, so `trusted` can only come from the outer page |
| A `useMiniAppHost.ts:103` `handleErrorFrame` | UNSAFE | Fixed | Same |
| A `useMiniAppHost.ts:367` `probes` | UNSAFE | Fixed | Same |
| A `MiniAppView.tsx:229` `onSlotMessage` / `WARM_ANSWER` | UNSAFE | Fixed | Verifier first (`MiniAppView.tsx:261`); the warm answer is a signed page answer to `__whimControl.warm()` (`webview-pool.ts:56`) |
| A `NetworkDenyProbeScreen.tsx:188` | UNSAFE | Fixed | `run.channel.receive` (`NetworkDenyProbeScreen.tsx:207`) |
| A `RNCWebView.java:255` listener drops `isMainFrame` | UNSAFE | Fixed | `MainFrameOnlyWebView.kt:31-32` returns before forwarding a non-main-frame post; device 5.1 |
| A `RNCWebView.java:446` fallback, no frame identity | UNSAFE | Fixed (by the token) | No native fix is possible; the token refuses every forged frame (device 5.2: drops 1 → 5, no effect) |
| A `RNCWebViewImpl.m:798` iOS receiver | NOT-CHECKED | Fixed | `WhimWebViewMainFrame.m:73` drops sub-frame posts to every handler; `window.webkit` removed from the frame (device 5.3 rerun) |
| A `synthrun/capability.ts` main-frame guard | NOT-CHECKED | SAFE, read now | `capability.ts:160` refuses `source.frame !== source.page.mainFrame()` before dispatch; pinned by `synthrun/test/acceptance.ts:803` ("confinement: a hand-rolled syscall frame to whimHostDispatch …") |
| B `loader.js:107` stub overwrite unrecorded | NOT-CHECKED | Fixed | `neutralize.js` records and removes first (`neutralize.js:38`), the loader captures the record (`loader.js:98`) |
| B `neutralize.js` never reads the bridge | NOT-CHECKED | Fixed | Same |
| B `probes.js:104-105` parent/top only | NOT-CHECKED | Fixed | Three counted `reach` probes (`probes.js:136, 145, 154`) |
| B `MiniAppView.tsx:267` → `useMiniAppHost.ts:318` | UNSAFE | Fixed | As Part A |
| B `DevProbeScreen.tsx:67`, `NetworkDenyProbeScreen.tsx` | UNSAFE | Fixed | As Part A |
| B `src/sdk/events.ts:16-17` relies on the stub | NOT-CHECKED | Fixed (now checked) | Probe "frame bridge is the loader stub" fails containment if anything else is there |
| B `invariants/sandbox-isolation/bridge/runner.mjs:112` | UNSAFE (for this property) | No action | Its every-frame `ReactNativeWebView` is configurable; neutralize removes it and the probes pass (task 1.4); owner file unchanged |
| B `fixtures/adversarial/evil.app.tsx:56`, `timer-ticker.app.tsx:37` | NOT-CHECKED | Fixed (now checked) | Their "loader stub" assumption is now enforced by the same counted probe |
| B `checks/contract.ts:245-282` names no `location` / bridge | NOT-CHECKED | **To file** | Unchanged: `FORBIDDEN_DIRECT_NAMES` (`checks/contract.ts:259`) names neither `location`, `ReactNativeWebView` nor `webkit` |

One census row is filed below. No other row is left unsafe or unchecked.

## Census issues

### 1. Static checks don't flag frame self-navigation or bridge names (`checks/contract.ts:259`)

- **Labels:** `ai-proposed`
- **Body:** The static passes (`FORBIDDEN_DIRECT_NAMES`/`FORBIDDEN_MEMBER_PATHS`, `checks/contract.ts:259-282`)
  let a candidate write `location.href = 'data:text/html,…'` (bare or through `window`/`globalThis`), or name
  `ReactNativeWebView` or `webkit`, without a finding. At runtime this is contained (decision #89: the token
  refuses the navigated document's posts, iOS refuses the navigation, the frame holds no bridge), so this is
  about steering the model and catching hostile candidates before the run, not containment. Done looks like:
  the forbidden-global pass reports `location` assignment/`assign`/`replace` and the two bridge names
  (through any global root or alias), with fix hints; `checks/test` cases for each form, red-checked; the SDK
  reference stays clean (the SDK's own `events.ts` is not candidate source). Check the false-positive rate on
  the corpus first (`docs/app-corpus.md`).

## Side findings (not this change)

Found during the device runs (evidence files in `openspec/changes/webview-bridge-provenance/evidence/`).

### 2. Settings → Advanced: "Send error details" switch looks dark or disabled in both states

- **Labels:** `ai-proposed`
- **Body:** On Android the switch is a black track with a grey thumb when on and a grey track with a black
  thumb when off (`android-5.1-rerun-5.4.md`, screenshots `b14` vs `b20`); the on state reads as disabled.
  Where: `src/host/launcher/AdvancedScreen.tsx:179` (`GroupedRow` `trailing: switch`) and the switch styling
  it uses. Done looks like: the on state uses the accent track, both states are distinguishable in light and
  dark, checked on Android and iOS.

### 3. Settings → Advanced: "Server address" label sits further left than other section labels

- **Labels:** `ai-proposed`
- **Body:** The "Server address" label and its helper lines align with the card's outer edge (x ≈ 60 px on
  a 1344 px screen) while "This phone" and "Server" align with the text inside the card (≈ 110 px)
  (`android-5.1-rerun-5.4.md`, `b14`). Where: `src/host/launcher/AdvancedScreen.tsx:200`. Done looks like:
  every section label and hint on the screen shares one inset, verified by screenshot on both platforms.

### 4. First-run sheet: "What stays on your phone" uses a phone-call icon

- **Labels:** `ai-proposed`
- **Body:** The row uses a telephone-handset icon, which reads as "calling" rather than "this device"
  (`android-5.1-rerun-5.4.md`, `b03`). Where: `src/host/launcher/FirstRunSheet.tsx:224` (`icon="phone"`).
  Done looks like: a device/smartphone glyph from the vendored icon set.

### 5. Dev builds: Logs chip overlaps the Whim menu orb and clips the composer; Logs panel shows UTC unlabeled

- **Labels:** `ai-proposed`
- **Body:** The dev `Logs` pill (`src/host/launcher/LauncherRoot.tsx:757`) covers the round Whim menu button
  in a running app (only its top edge is tappable) and sits over the right end of the "Make an app…" bar on
  Home, clipped by it (`ios-5.3-rerun.md` `07`, `11`; `android-5.1-rerun-5.4.md` `a0-launch.png`). The Logs
  panel prints times in UTC with no label (`src/host/launcher/dev-log-view.ts:67`, `formatRecordTime`;
  `ios-5.3-rerun.md` `05`), which reads as wrong next to the status-bar clock. Done looks like: the pill is
  placed clear of the orb and the composer on both platforms, and the time carries a `UTC` marker (keep UTC:
  it lines up two devices' logs). Dev-only.

### 6. DevProbe: first fixture tap after opening is ignored; status-bar strip is light above the dark bar

- **Labels:** `ai-proposed`
- **Body:** After opening DevProbe by long-pressing "Your apps", the first tap on a fixture chip does
  nothing, on both platforms, every time (`android-5.1-5.2.md` side observation 1, `ios-5.3-rerun.md`
  `13`); a tap anywhere first works around it, which points at a responder left by the long-press. And the
  status-bar strip above the dark probe bar is the light app background (`android-5.1-5.2.md`, `ios-5.3.md`):
  `src/host/launcher/DevProbeScreen.tsx:11` uses React Native's deprecated `SafeAreaView`, whose background
  does not reach under the status bar. Done looks like: the first tap launches; the screen uses
  `react-native-safe-area-context` like the other probe screens, with its dark background under the status
  bar. Dev-only.

### 7. Dev launch shows the "Open debugger to view warnings" toast every time

- **Labels:** `ai-proposed`
- **Body:** Every debug launch on both platforms shows the yellow LogBox toast, from three warnings:
  (a) the deprecated deep import `react-native/Libraries/promiseRejectionTrackingOptions` at
  `src/host/platform/install-diagnostics.ts:40`; (b) `SafeAreaView has been deprecated`
  (`src/host/launcher/DevProbeScreen.tsx:11`, see issue 6); (c) `[Reanimated] Dependencies should only be
  used on the web and are always ignored on native` (call site not located: look for a Reanimated hook
  given a dependency array). Done looks like: a debug launch with no warning toast; (a) needs a public
  replacement or a documented, filtered exception.

### 8. iOS: committed Podfile.lock is stale, and pod install re-sorts WhimRandomModule.mm in project.pbxproj

- **Labels:** `ai-proposed`
- **Body:** A fresh `pod install` (CocoaPods 1.17.0) changes `ios/Podfile.lock` (the ReactCodegen checksum
  and the `COCOAPODS` version, committed as 1.15.2) and re-sorts the two `WhimRandomModule.mm` entries in
  `ios/Whim.xcodeproj/project.pbxproj` (order only). Every iOS build run had to restore both files
  (`ios-5.3.md`, `ios-5.3-rerun.md`). Done looks like: both files committed in the state `pod install`
  produces with the CocoaPods version the docs name, so a clean install leaves the tree clean.

### 9. `bundle exec pod install` fails in a fresh checkout; the release doc still leads with it

- **Labels:** `ai-proposed`
- **Body:** Every runner in this change found `bundle exec pod install` failing (Gemfile gems not installed,
  or vendored gems without native extensions) and used the system CocoaPods 1.17.0 instead.
  `docs/release/mobile.md:161` gives `bundle exec pod install` as the step; `:164` and `:373` describe the
  failure and a workaround. Done looks like: one documented install path that works in a fresh worktree
  (either `bundle install` as an explicit first step that succeeds, or system CocoaPods with the version
  pinned and checked), with the doc and issue 8's lockfile agreeing on the CocoaPods version.

### 10. The v1-upgrade "what's new" copy still says "error details when something goes wrong"

- **Labels:** `ai-proposed`
- **Body:** Error details now also include automatic app safety check results (decision #89), and the
  consent screen, first-run sheet, Settings hint and privacy pages were reworded, but the upgrade notice in
  `src/host/launcher/copy.ts:676` and its `covers` phrase `'category:error-details': 'error details when
  something goes wrong'` (`copy.ts:678`; French `copy.ts:699`) were not. The sentence is still true, only
  stale. It needs an owner call because a `covers` phrase names a widening the v1 consenters are told
  about, and the disclosure release check (`checks/test/release/disclosure.suite.ts`) requires every phrase
  to occur in `text`. Done looks like: the owner decides whether to reword; if so, `text` and its `covers`
  phrase change together in both languages and `npm run checks:test -- --only disclosure` stays green.
