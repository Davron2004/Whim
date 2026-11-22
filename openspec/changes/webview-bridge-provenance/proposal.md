## Why

React Native trusts every message that arrives on the WebView's `ReactNativeWebView` bridge, and nothing checks which frame sent it (research.md Part A census: every consumer UNSAFE). If a frame other than the outer page can post on that bridge, it can forge a paint, a crash, a verdict, a log line or a syscall under the app's own manifest. That other frame could be the mini-app's own frame (on an older Android WebView, or through `webkit.messageHandlers` on iOS), or a `data:` page the mini-app frame navigates itself to. Whether such a frame can reach the bridge differs by device and is unmeasured, and no containment probe would notice if it could. The authentication fix and the exposure probes are one problem: the probes find out where the bridge leaks and keep checking, and the token makes a leak harmless. Planning them separately would leave either a fix without evidence or evidence without a fix. This is the follow-up promised by `docs/security/2026-11-19-verdict-channel.md` and task 10.5 of `upgrade-to-latest-dependencies`.

## What Changes

- **Authenticated outer page → RN hop.**
  - React Native mints a fresh random token for each page load of each WebView and hands it to the outer page through a main-frame-only injection.
  - The outer page keeps the token in a closure and puts it in front of every message it sends to RN.
  - RN drops any message without the current token before parsing it. This covers every kind: paint, error, syscall, ui-event, nav-depth, probes, delivery, rejected-forgery, host log, the warm-slot answer and the new exposure report.
  - Without a token, the outer page posts the same messages with no token. Stub hosts (synthrun, the owner's invariants, desktop suites) therefore keep working unchanged, while RN refuses everything that lacks a token.
- **Second layer in native code.**
  - Android: on the `addWebMessageListener` path, RN drops messages whose `isMainFrame` is false. This builds on the existing #74 subclass seam.
  - iOS: RN drops script messages whose `frameInfo.isMainFrame` is false, through the existing #74 swizzle seam.
  - A debug-only switch forces the Android `addJavascriptInterface` fallback path, so that path can be tested on an emulator.
- **In-frame bridge probes (counted, hard).**
  - `neutralize.js` records whether a native bridge (`ReactNativeWebView`, or `webkit.messageHandlers.ReactNativeWebView`) was present in the mini-app frame, then removes it.
  - The loader captures that record before app code runs.
  - New `reach` probes fail containment if app code can reach any native bridge object, own or inherited, other than the loader's stub.
  - Whether a bridge was present at the start is reported in a side field, `bridge`, and is not counted.
- **Navigated-frame exposure probe (diagnostic, device only).**
  - Once per page load, after the token arrives, the outer page creates a throwaway frame with the mini-app frame's sandbox and CSP.
  - That frame navigates itself to a `data:` page, which reports what it can see and posts a fixed canary straight to the native bridge.
  - RN records whether the canary arrived, then drops it.
  - The result is logged and shown on the dev probe screen. It never affects `contained`.
- **Exposure telemetry (owner decision 2026-11-22).** Each distinct exposure result is uploaded as one `info`-level diagnostics record (`exposure`, `webview`) under the existing error-details consent: no new consent screen, no version bump, no re-prompt. The error-details copy on the first-run sheet, consent screen, Settings and privacy page is reworded (en/fr) to say it also covers automatic safety checks, worded so people are comfortable accepting.
- **iOS sub-frame navigation refusal (owner decision 2026-11-22).** A native policy swizzle refuses every non-main-frame navigation except `about:srcdoc`/`about:blank`, closing the `data:` (and `blob:`) self-navigation route on iOS. It is narrowed to `data:` + `blob:` if the device run shows it breaks anything. The exposure probe reports `refused` there, told apart from a timeout.
- **Reproduction on device, then verification.**
  - A new adversarial fixture, `bridge-reach`, plus the probes, is run on four cases: Android with a current WebView (listener path), Android with the forced fallback, iOS simulator, and the release build of the first case.
  - The findings update the security doc and a new decision.

## Capabilities

### New Capabilities
- `webview-message-provenance`: RN accepts a WebView message only when it is proven to come from the outer runtime page. This covers the per-page-load token, its main-frame-only delivery, the drop of every token-less message before parsing, the native main-frame filter as a second layer, and the device-only exposure probe with its canary record.

### Modified Capabilities
- `sandbox-isolation`: adds requirements that the mini-app frame holds no native bridge object apart from the loader stub, enforced by counted hard probes, that bridge presence at start is reported in a side field, and that iOS refuses sub-frame navigations to anything but `about:srcdoc`/`about:blank`.
- `device-diagnostics`: the allowlist gains `exposure` and `webview`, valid only on the bridge-exposure record; that `info`-level record is the one non-error upload, deduplicated by result, under the same consent gate.

## Impact

- **Runtime (web):**
  - `src/runtime/web/neutralize.js`, `loader.js`, `probes.js`
  - `build/assemble.mjs` (outer page). This is a control-plane (`CONFIG_SET`) file, so its edits are bootstrapped: committed into the chain's base before gating.
  - `build/build.mjs` (fixture registration)
- **Host (RN):**
  - `src/host/launcher/useMiniAppHost.ts`, `MiniAppView.tsx`, `webview-pool.ts`, `DevProbeScreen.tsx`, `dev-probe-fixtures.ts`
  - `src/host/NetworkDenyProbeScreen.tsx`
  - a new shared verifier module
  - the launcher test suites that send messages directly to `onMessage`, through the `native-host.tsx` mock
- **Native:** `android/.../NetworkDeniedWebViewManager.kt` (or a sibling view subclass), `ios/Whim/WhimWebViewNetworkDeny.m` (or a sibling swizzle), and a static check beside `checks/test/release/native-network-deny.suite.ts`.
- **Unchanged:**
  - `invariants/`: probes run inside it, but its stub hosts deliver no token, so the outer page posts without one. Task 1.4 confirms the new probes pass under `bridge/runner.mjs`, which defines `ReactNativeWebView` in every frame. Any owner edit that proves necessary is escalated, never made by an agent.
  - synthrun: no token and no exposure probe. Its `contained` reading gains the new counted probes.
  - The CSP and the frame's sandbox attributes.
- **Consent copy and diagnostics:** `contract/src/index.ts`, `contract/src/disclosure-manifest.ts` (description only), `src/host/logging/diagnostic.ts`/`diagnostics.ts`, `src/host/launcher/copy.ts`, `deploy/site/privacy.html` (+ fr). `AI_CONSENT_VERSION` stays 2.
- **Docs:** `docs/security/2026-11-19-verdict-channel.md` (findings + status), a new decision in `docs/decisions.md`, the README's probe count, and a `docs/capabilities.md` line at archive.
- **No new dependency.** No `node_modules` patch: this repo's installs skip install scripts (research.md Part A, Integration points).
