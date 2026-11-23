# Task 5.3: iOS simulator device run (2026-11-22)

**Verdict: FAIL, release-blocking on iOS.** On iOS, react-native-webview fires `onLoadStart` for the
`about:blank` sub-frame loads of an iframe the runtime page creates. RN treats that as a new page
load, mints a fresh token after the page already accepted the old one, and then drops every signed
message from the page. Result: no exposure record, no verdict, and the dev probe refuses every
launch (`no bridge token`). In the product shell, Tip Splitter paints but its paint frame is dropped,
so the slot times out and shows "Tip Splitter ran into a problem".

With a verification-only shim (uncommitted, reverted; see "Shimmed run"), every other 5.3 item passes.
That includes D9: the navigation refusal broke nothing legitimate. It also includes the in-frame bridge
removal, so Open Question 3 does not arise on iOS.

## Setup

- Simulator: iPhone 17 clone `whim-wbp-5.3` (cloned from a warmed device; deleted after the run), runtime
  iOS 27.0 (24A434), Xcode 27.2 (27B52), arm64.
- Build: worktree `chain/webview-bridge-provenance-chain-5b` at `a10f07a9` (chains 1, 2, 3, 4 and 7
  merged), Debug, `xcodebuild -workspace Whim.xcworkspace -scheme Whim -configuration Debug -sdk
  iphonesimulator ARCHS=arm64`. The build succeeded after system `pod install`. `Podfile.lock` and
  `project.pbxproj` were restored afterwards: pod install had re-sorted the pbxproj and changed the
  ReactCodegen checksum and the COCOAPODS version.
- JS: Metro from the worktree on **port 8082**, because another agent's Metro held 8081. The app was
  launched with the NSUserDefaults argument `-RCT_jsLocation localhost:8082`, with no build-setting change.
  `npm run build` produced no diff against the committed generated files.
- DevProbeScreen: long-press on the Home title "Your apps". `__DEV__` is true in Debug, so no flag was
  flipped. Driven with `scripts/ios-ui-driver` (coordinate taps; it did not hang on the WebView screen).
  App state was read from screenshots, the driver's `labels`, and `log stream` (RN `javascript` plus
  `com.apple.WebKit`).
- Screenshots are in `evidence/ios-5.3/*.png` (git-ignored by the repo's evidence rule, local in the
  worktree, to be uploaded per `docs/EVIDENCE.md`). Also there: `device-log-excerpt.txt`,
  `verify-shim.diff`, and `data-image.app.tsx.txt`.

## Defect: onLoadStart re-fires after onLoadEnd on iOS (unshimmed build)

Mechanism:
- The DevProbe/pool WebView loads `source={{html}}` with no `baseUrl`. `RNCWebViewImpl` loads it with
  baseURL `about:blank`, so `request.mainDocumentURL` is `about:blank`.
- `RNCWebViewImpl webView:decidePolicyForNavigationAction:` computes `isTopFrame = [request.URL
  isEqual:request.mainDocumentURL]` and fires `onLoadingStart` when it is true.
- An iframe appended by the page first loads `about:blank`, which equals the main document URL, so
  `isTopFrame` is YES for a sub-frame. The D9 swizzle allows `about:blank` and calls the original, but
  without D9 the original would run the same way, so D9 is not the cause.
- `useMiniAppHost.onLoadStart` → `RuntimeChannel.loadStart()` mints a new token and clears `authorized`.
  `onLoadEnd` does not fire again (sub-frame loads do not finish the main navigation), so the new token
  is never delivered, and the page refuses a second `auth` in any case (`TOKEN!==null`).

Triggers:
- The exposure probe frame (`runExposureProbe`, created on `auth`).
- `makeIframe()` on every launch or realm reset.

Logged native events (temporary `console.log` in DevProbeScreen):
```
18:46:04.320 onLoadStart {"url":"about:blank","loading":true,"title":"",...}            main page
18:46:05.553 onLoadStart {"url":"about:blank","loading":true,"title":"",...}            mini-app frame, before onLoadEnd (harmless)
18:46:05.560 onLoadEnd   {"url":"about:blank","loading":false,"title":"",...}           token delivered (auth)
18:46:05.575 onLoadStart {"url":"about:blank","loading":false,"title":"WHIM:pending",...}  exposure probe frame → token re-minted
```
On a dev-probe launch there are two more `onLoadStart` events (`title":"WHIM:CONTAINED"`,
`canGoBack:true`), one per frame the launch creates.

Observed without the shim:

| Surface | Value | Screenshot |
|---|---|---|
| DevProbe idle, 20 s after load | `bridge: —` · `dropped: 1` · `exposure: pending` (the signed exposure report was dropped as wrong-token; WebKit shows the probe ran and its navigation was refused at 18:42:43.454) | `02-devprobe-idle-exposure-pending.png` |
| DevProbe, tip-splitter tapped | `app: Tip Splitter` · `err: no bridge token` · verdict `running… —`, no paint (log: `mini-app failed {where:'launch', errorClass:'NoBridgeToken'}`) | `03-devprobe-tip-splitter-no-bridge-token.png` |
| Product, Home → Tip Splitter | app content painted under the "Opening…" tile, then `mini-app failed {where:'paint-timeout'}` and the crash screen "Tip Splitter ran into a problem" (log: `runtime webview dropped unsigned messages {webKey: 3, count: 9}`) | `04-…-painted-opening.png`, `05-…-paint-timeout-crash.png` |

This is the "climbing drop counter with no paint" case the brief warned about. The extra event comes
from sub-frame `about:blank` loads after `onLoadEnd`, not from a second main-frame load. Android is not
expected to be affected through this path, because `WebViewClient.onPageStarted` is main-frame only.
This run did not verify that; case 5.1 decides it.

## Shimmed run (verification only, uncommitted, reverted)

The shim is in `verify-shim.diff`: in `DevProbeScreen` only, `onLoadStart` events after the first
`onLoadEnd` are logged but not forwarded. Its purpose was to observe the rest of 5.3. It is not a
proposed fix.

| 5.3 item | Result | Values | Screenshot |
|---|---|---|---|
| Verdict (52 probes), tip-splitter | **PASS** | `CONTAINED ✓ 52/52`, paint 72 ms, gen 1, `T7: false`, syscalls 0; page log `CONTAINED=true 52/52 gen=1 T7anyPoison=false` | `07-shim-tip-splitter-contained-52.png` |
| `bridge` field | **PASS** | `android absent, ios present/removed` | 07, 08 |
| Open Question 3 (iOS handler removable?) | **Does not arise** | `bridge.ios.present=true, removed=true`. The 3 new `reach` probes pass (52/52). In bridge-reach's realm `window.webkit?.messageHandlers?.ReactNativeWebView` reads `absent`. | 08 |
| Exposure record | **PASS** | outcome `refused` · visible android=false ios=false · canaryReachedNative=false · webview `webkit` (log: `bridge-exposure {exposure:'refused', webview:'webkit', canaryReachedNative:false, surface:'dev-probe'}`) | `06-shim-devprobe-idle-exposure-refused.png` |
| Drop counter | **PASS** | `dropped: 0` idle, after tip-splitter, after bridge-reach, after data-image | 06–09 |
| bridge-reach: forged frames changed nothing | **PASS** | No forged frame was ever sent: the handler was absent in-realm and the `data:` document never ran. Verdict stays `CONTAINED ✓ 52/52`, paint is the real one (65 ms, page log `PAINT … "Bridge Reach"`), syscalls 0, no crash screen, `last tap: —` (no `bridge-reach:` report) | `08-shim-bridge-reach-refused.png` |
| bridge-reach: `data:` navigation refused, realm kept | **PASS** | On screen: "webkit handler: absent" / "navigating this frame to a data: document…" / "still here: the navigation was refused". WebKit 18:48:21.823 frame 21474836485 (mini-app frame): `Client responded with policy 0` → `policyAction=Ignore` | 08 |
| `data:` document found `__whimControl` / a token | **Not observable** (the document never ran, because the navigation was refused) | n/a | n/a |
| Mini-app frame paints under D9 | **PASS** | tip-splitter, bridge-reach and data-image all paint | 07–09 |
| `data:` image renders | **PASS** | No committed fixture renders a `data:` image (the SDK has no image component; nothing under `fixtures/` uses one). A temporary uncommitted raw fixture (`data-image.app.tsx.txt`, deleted after) appended a `data:image/png;base64` and a `data:image/svg+xml` `<img>`: both reported `loaded 48x48` and both render (magenta and cyan squares) | `09-shim-data-image-renders.png` |
| D9 breaks anything legitimate? | **No** | Every srcdoc frame load was allowed (`policy 1`). The only refusals (`policy 0`) were the exposure probe's and bridge-reach's `data:` navigations. No narrowing needed. | n/a |

`forged rejected` goes up by 1 on each launch. That is the probes' own `REJECTED-FORGERY
kind=spoof-probe` self-test (`probes.js`), as designed.

## Not observed / not covered

- The native script-message frame filter (D6, iOS) was not exercised: nothing in a sub-frame could reach
  the handler to post.
- No WhimMainFrame NSLog failure lines appeared, so both swizzles were installed.

## Side findings (pre-existing, not this change)

- Every launch shows the yellow LogBox toast "Open debugger to view warnings." from `[Reanimated]
  Dependencies should only be used on the web …` and the deprecated `react-native` deep import of
  `promiseRejectionTrackingOptions`. On DevProbe it also comes from `SafeAreaView has been deprecated`.
- On DevProbeScreen the status-bar strip is the light page colour above the dark bar. The screen's
  dark `SafeAreaView` background does not reach under the status bar.
- The committed `ios/Podfile.lock` is stale against a fresh `pod install` (the ReactCodegen checksum
  changes, and CocoaPods is 1.15.2 vs 1.17.0 installed).
