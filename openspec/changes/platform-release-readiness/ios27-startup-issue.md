# iOS 27 release build crashes before React Native starts

Status: startup fixed on the iOS 27 simulator by `f02062d`, integrated as
`adf271e`. The normal Release build starts, seeded mini-apps render, and storage
survives process restart. Broader release acceptance below remains separate.
Original failure recorded 2026-09-18.

## Reproduction

- Source: `865f7af0c431984f0abf9fce3b514063cfd912a7`.
- Xcode 27.0 (27A266a), iOS Simulator SDK 27.0, iPhone 18 Pro on iOS 27.0.
- App: `com.anycognition.whim`, version 1.0.0/build 1, arm64 Release.

1. Use the recorded source in an isolated checkout with Node 22, pinned CocoaPods
   dependencies, and freshly generated runtime assets (`npm run build`).
2. Build `ios/Whim.xcworkspace`, scheme `Whim`, configuration `Release`, SDK
   `iphonesimulator`, targeting iOS 27 with `ONLY_ACTIVE_ARCH=YES` and
   `CODE_SIGNING_ALLOWED=NO`. Keep all probe flags disabled and native denial on.
3. Install the resulting `Whim.app` and launch `com.anycognition.whim`.

Expected: the normal launcher appears. Actual: compilation succeeds, but UIKit
terminates startup before React Native renders. The native log reports:

```text
Application failed to launch: UIScene life cycle is required for apps built with this SDK.
```

Both crash reports show `EXC_BREAKPOINT` / `SIGTRAP` on the main thread in
`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke`,
with the native error naming `UIApplication_RuntimeIssues.m:106`.

| September 18 run (America/Toronto) | Process | Result |
| --- | ---: | --- |
| 18:58:32; native-deny probe enabled | 42430 | Crash before any probe bundle loaded, approximately 0.55 seconds after launch |
| 19:00:33; normal build, all controls restored | 47968 | Same startup crash |

## Cause and fix requirements

`ios/Whim/AppDelegate.swift` creates `UIWindow(frame:)` and starts React Native in
the application delegate. `ios/Whim/Info.plist` has no scene configuration. This
matches Apple's [scene-lifecycle requirement](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle).

Move window startup to a configured `UIWindowScene` connection. Preserve React
Native factory/delegate lifetime, launch background, native WebView restrictions,
and cold-start/warm universal-link delivery. Adding a manifest alone is insufficient
if window startup or link callbacks remain disconnected.

This report does not establish failure on older SDK/runtime combinations. The
September 15 iOS 26.5 acceptance remains valid historical evidence. The earlier
XCTest/SpringBoard crash and intentional missing-rule recovery are separate issues.

## Acceptance before closure

- [x] Fresh normal Release build launches under Xcode 27/iOS 27 without this crash.
- [x] Seeded apps render; navigation and persistence survive process restart.
- [ ] Cold-start and warm universal links reach the intended destination.
- [ ] Native-deny probe executes every variant with zero forbidden traffic, and
      removing the restriction produces traffic in the negative control.
- [ ] Missing native rules reach the bounded recovery UI; Retry and Home work.
- [ ] Temporary controls are restored and the normal artifact reinstalled.

Physical signed-iPhone acceptance remains separate. The failed probe's canary
correctly exited 1 with `bundles=0 hits=0 tls=0` and all variants missing; zero
traffic from an app that never started is not containment evidence.

## Evidence and cleanup

Local receipts: `/tmp/pr35-ios-normal-build.log`,
`/tmp/pr35-ios-normal-native.log`, `/tmp/pr35-ios-positive-native.log`, and
`/tmp/pr35-ios-positive-canary.log`. Crash reports:
`~/Library/Logs/DiagnosticReports/Whim-2026-09-18-185842.ips` and
`Whim-2026-09-18-190034.ips` in the same directory. These local files may later be
removed; the environment, error and observed results are preserved above.

After the original reproduction, all temporary source/lockfile edits were
restored, the then-unfixed normal artifact was reinstalled, the temporary
checkout was removed, and the simulator was shut down. No production deployment
occurred.

## Correction verified — 2026-09-18, 20:05–20:09 America/Toronto

The Release build from `adf271e` compiled and launched on the same iPhone 18 Pro
iOS 27 simulator. Tip Splitter rendered by 4.400 seconds after a warm URL launch
request. Water Counter rendered by 2.404 seconds after a cold URL launch request.
These are screenshot upper bounds, not exact paint measurements.

The owner confirmed that tapping to increment Water Counter, returning Home,
and reopening the app worked within five seconds. The owner then made further
taps; screenshots immediately before and after a process restart both show
3 glasses and 3 history entries. After restart, the complete saved state was
visible by 2.422 seconds. No new Whim crash report appeared during these runs.

Cold and warm URL-context delivery were exercised with `devicectl process launch
--payload-url` using the configured `whim.anycognition.ca` host. This does not
prove associated-domain NSUserActivity delivery from another app. That check,
the full native-deny probe/negative control, and signed physical-device
acceptance remain in the release checklist. The existing Hermes polyfills and
WebView denial were unchanged; all temporary lockfile changes were restored.

Receipts, screenshots and timing JSON are in
`~/.cache/whim-ios-scene-2026-09-18/`. The installed executable matches the build
at SHA-256 `9524a27c927048978b43edd4050f642374628b088c6794ea84ac1eab296e5a98`.
The full integrated repository gate exited 0 with `FULL GATE PASSED`.
