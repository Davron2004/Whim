# Task 5.3 rerun: iOS simulator device run after chain-8 (2026-11-22)

**Verdict: PASS.** The release-blocking defect from the first run (`ios-5.3.md`) is gone. Nothing was shimmed,
patched or changed, and the merged fix was verified as-is. On iOS, sub-frame `about:blank` loads no longer cost
the WebView its token. Every launch and every relaunch paints. The drop counter stays at 0 everywhere. The
product path Home → Tip Splitter, the exact path that crashed before, opens, stays open, takes input, and
reopens.

## Setup

- Simulator: `whim-wbp-5.3-rerun`, cloned (`simctl clone`) from the warmed iPhone 17 `D9A1CB1F…`, runtime
  iOS 27.0 (24A434), Xcode 27.2 (27B52), arm64. It was shut down and deleted after the run. There was no
  PosterBoard dialog.
- Build: worktree `chain/webview-bridge-provenance-chain-5c` at staging `6989ab40` (chain-8 merged), with no
  local changes. `npm run build` gave no diff against the committed generated files. A system `pod install`
  (CocoaPods 1.17.0) ran first, then `xcodebuild -workspace Whim.xcworkspace -scheme Whim -configuration
  Debug -sdk iphonesimulator ARCHS=arm64 -derivedDataPath build/sim build`. Afterwards, `ios/Podfile.lock`
  (ReactCodegen checksum, COCOAPODS version) and `ios/Whim.xcodeproj/project.pbxproj` (a 2-line re-sort of
  `WhimRandomModule.mm`) were restored.
- JS: Metro from the worktree on port 8082, with the app launched with `-RCT_jsLocation localhost:8082`.
- Driving: `scripts/ios-ui-driver`. DevProbe was opened by long-pressing "Your apps". The driver did not
  hang on any WebView screen in this run.
- Logs: `xcrun simctl spawn <udid> log stream` (process Whim plus WebKit policy lines). The excerpt is in
  `ios-5.3-rerun/device-log-excerpt.txt`.
- Screenshots: `ios-5.3-rerun/*.png`. They are git-ignored, local in the worktree, and to be uploaded per
  `docs/EVIDENCE.md`. All of them were inspected.

## Results

| # | Check | Result | Values | Evidence |
|---|---|---|---|---|
| 1 | Build compiles `ios/Whim/WhimWebViewMainFrame.m` | **PASS** | `** BUILD SUCCEEDED **`. `WhimWebViewMainFrame.m` compiled with 0 warnings and 0 errors. No `WhimMainFrame:` NSLog line was seen in the whole run, so both swizzles installed. | build log (scratch) |
| 2 | DevProbe idle | **PASS** | `bridge: — · dropped: 0 · exposure: refused · visible android=false ios=false · canary=false · webkit`. The screenshot was taken 14 s after the record (`bridge-exposure {exposure:'refused', webview:'webkit', canaryReachedNative:false, surface:'dev-probe'}` at 20:03:12.604). The probe frame's navigation was refused natively at 20:03:09.604 (`policy 0`, frame 21474836482). | `01-devprobe-idle.png` |
| 3 | DevProbe tip-splitter ×3 | **PASS** | Launch 1: `CONTAINED ✓ 52/52`, paint 222 ms, gen 1, syscalls 0, `T7: false`, `bridge: android absent, ios present/removed`, `dropped: 0`. Launch 2: 52/52, paint 65 ms, dropped 0. Launch 3: 52/52, paint 70 ms, dropped 0. Page log on each launch: `CONTAINED=true 52/52 gen=1 T7anyPoison=false` and a `PAINT {"appName":"Tip Splitter"}` (host generations 2, 3, 4). Each launch recreates the mini-app `about:blank` frame, which was the old trigger, and none of them cost the token. | `02-…-1.png`, `03-…-2.png`, `04-…-3.png` |
| 3a | Probe `webkit.messageHandlers unreachable` | **PASS** | 52/52 passed with 0 failed. This probe is one of the 52 counted (`probes.js:154`, category `reach`). WKWebView therefore let neutralize remove and shadow `window.webkit` in the mini-app frame. The on-screen panel and logs show the totals only, not per-probe rows. | 02–04 |
| 4 | DevProbe bridge-reach | **PASS** | `CONTAINED ✓ 52/52` (unchanged), real paint 61 ms (`PAINT … "Bridge Reach"`), syscalls 0, `last tap: —` (no forged `bridge-reach:` report), no crash screen, `dropped: 0`. Frame text: "webkit handler: absent" / "navigating this frame to a data: document…" / "still here: the navigation was refused". WebKit at 20:06:33.748, mini-app frame 21474836489, nav 64: `Client responded with policy 0` → `policyAction=Ignore`. The realm was kept. No forged frame was sent, because the handler is absent in-realm and the `data:` document never ran. | `06-devprobe-bridge-reach.png` |
| 5 | Product: Home → Tip Splitter, interact, back, reopen | **PASS** | Open 1: `tap to first paint {tapToPaintMs:238, paintMs:75, webView:'warm'}`, page `CONTAINED=true 52/52`. The app was still open 30 s later (well past the paint timeout), with no "ran into a problem". People `+` gave 2→3 and per person $60→$40, with page log `UI-EVENT press People` (a signed page→RN message accepted). Typing `5` into Bill gave 1005, Tip $201.00, Total $1206.00, per person $402.00. Whim menu → "Back to your apps" returned Home. Open 2: `tapToPaintMs:174, paintMs:65`, 52/52, painted and stayed open (state resets to 100/2; the fixture uses in-memory `useState`). Pool exposure records: `refused`/`webkit` at 19:59:42, 20:07:14 and 20:08:47. | `07-…-open-1.png`, `08-…-people-plus.png`, `09-…-bill-typed.png`, `10-product-whim-menu.png`, `11-product-back-home.png`, `12-…-open-2.png` |
| 5a | Host drop log (`runtime webview dropped unsigned messages`) | **Not emitted** | The log only fires when a pool slot's WebView unmounts with `count > 0`. No such line appeared in the whole run. The first run logged `{webKey: 3, count: 9}`. No log line in the run matches `dropped`, `failed`, `NoBridgeToken`, `paint-timeout`, `crash`, `error`, `secure random` or `LEAK`. | `device-log-excerpt.txt` |
| 6 | LEAK / climbing drops | **None** | Every verdict was CONTAINED 52/52, and every on-screen drop counter read 0. | all |

Extra observation: a second DevProbe instance (Home → DevProbe again, a new WebView and so a new token) also
gave `CONTAINED ✓ 52/52`, paint 69 ms, `dropped: 0`, exposure `refused`/`webkit` (surface `dev-probe`,
20:09:53) (`14-devprobe-second-instance-tip-splitter.png`).

### Native navigation policy over the whole run (D9)

Six sub-frame navigations were refused (`policy 0`). Five were exposure-probe navigations, one per WebView
instance (19:59:39 pool, 20:03:09 dev-probe, 20:07:11 pool, 20:08:44 pool, 20:09:50 dev-probe), each about 3 s
before its `refused` record. The sixth was bridge-reach's `data:` navigation (20:06:33). All 46 other client
decisions were `policy 1` (allowed), and every mini-app frame painted. D9 broke nothing legitimate.

## Not observable / not covered

- **D6 native sub-frame script-message filter:** not exercised directly. With `window.webkit` removed in the
  mini-app frame, no sub-frame code can reach a handler to post, so the filter's early return never had
  traffic. That includes the `ReactNativeHistoryShim` path, which chain-8 cut.
- **Per-probe rows** (for example the exact `webkit.messageHandlers unreachable` entry): neither the DevProbe UI
  nor the logs list them. 52/52 with 0 failed implies it passed.
- **Syscalls in the product path:** Tip Splitter makes no syscalls (in-memory state only). The interaction
  shows signed page→RN UI events and RN→page renders working, not syscalls. Every DevProbe launch showed
  `syscalls: 0`, which is expected for these fixtures.
- **`data:` document reaching `__whimControl` / a token:** it never ran, because the navigation was refused.

## Side findings (pre-existing, not this change)

- **DevProbe: the first tap on a chip after opening the screen is ignored.** Seen twice on two fresh DevProbe
  instances (20:04 and 20:10). A coordinate tap at (56,194), inside `tip-splitter`'s frame `[12,181 88x26]`,
  produced no launch and no log line. The same tap repeated 10 s later launched at once. It looks driver-side
  or touch-responder-side, not bridge-related: no `NoBridgeToken` or other log line appeared, and the drop
  counter stayed 0. The cause was not investigated. It affects only the dev-only screen.
  (`13-devprobe-coordinate-tap-retry.png`)
- **The dev `Logs` pill overlaps the product's round "Whim menu" button** (bottom right, menu frame
  `[338,776 52x52]`, Logs `[333,791 52x32]`). The menu circle peeks out above and around the pill, and you have
  to tap its uncovered top edge to open it. On Home the pill also sits over the right end of the "Make an
  app…" bar. Dev builds only. (`07-…`, `11-…`)
- **The Logs panel shows UTC times without a label** (`01:05:57.252` against a 20:06 status bar).
  (`05-devprobe-logs.png`)
- These persist from the first run: the yellow LogBox toast "Open debugger to view warnings." (Reanimated
  `Dependencies…`, the deprecated `promiseRejectionTrackingOptions` deep import, and on DevProbe `SafeAreaView
  has been deprecated`). DevProbe's status-bar strip is light above the dark bar. The committed
  `ios/Podfile.lock` is stale against a fresh `pod install` (CocoaPods 1.15.2 vs 1.17.0, ReactCodegen checksum).
- A clean Debug build under `taskpolicy -b` on the loaded machine took about 35 min.

## Teardown

The UI driver was stopped, the log stream killed, Metro (8082) stopped, and the simulator shut down and
deleted. The Android emulator and port 8081 were not touched.
