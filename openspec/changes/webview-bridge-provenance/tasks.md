## 1. In-frame bridge probes (runtime, web side)

- [ ] 1.1 In `src/runtime/web/neutralize.js`, as its first act, record `present` for `window.ReactNativeWebView` (own or inherited) and for `window.webkit.messageHandlers.ReactNativeWebView`. Remove each one with the existing delete-or-shadow technique, record `removed`, and freeze the record. The record never passes through `__WHIM_NEUTRALIZE_REPORT__` (design D4).
- [ ] 1.2 In `src/runtime/web/loader.js`, capture the frozen record at load alongside the other captured references, before any app code runs. Keep installing the transport stub as today. Add a `bridge` side field to the verdict built from the captured record. It is not counted in `total` or `contained` (spec sandbox-isolation "Bridge presence at start is reported, not counted").
- [ ] 1.3 In `src/runtime/web/probes.js`, add three counted `reach` probes:
  - "frame bridge is the loader stub", comparing own and inherited `ReactNativeWebView` with the captured stub identity;
  - "no native bridge on the window prototype chain";
  - "`webkit.messageHandlers.ReactNativeWebView` unreachable".

  None of them deletes or replaces the stub the running app uses (spec sandbox-isolation "The mini-app frame holds no native bridge object").
- [ ] 1.4 Run `npm run build`, `npm run invariants` and `npm run bridge:invariants` under the RSS watchdog. All must pass unchanged, including `invariants/sandbox-isolation/bridge/runner.mjs`, which defines `ReactNativeWebView` in every frame. If an owner file conflicts, stop and report: never edit `invariants/`.
- [ ] 1.5 Create `src/runtime/test/bridge-provenance.desktop.mjs` (npm script `runtime:provenance-verify`). It loads the built runtime page in headless Chromium, with a configurable `ReactNativeWebView` and a `webkit.messageHandlers.ReactNativeWebView` stub injected into every frame before load. Assert:
  - neutralize removes both;
  - the three probes pass;
  - `bridge` reports present/removed;
  - overwriting `__WHIM_NEUTRALIZE_REPORT__` from app code leaves `bridge` unchanged.

  Red-check it with a sabotaged variant where the injected bridge is non-configurable and non-writable: it must produce `contained: false`. Bootstrap edit: one `check "bridge-provenance" npm run -s runtime:provenance-verify` line in `scripts/gate-full.sh`.
- [ ] 1.6 Update the probe count, 49 → 52, wherever it is stated (README.md:42,94 and docs/security/* notes that cite the current count). Leave historical evidence lines that describe a past build alone.

## 2. Outer page: token, signed envelope, exposure probe (control plane: `build/assemble.mjs`)

- [ ] 2.1 In `build/assemble.mjs`, make `window.__whimControl({kind:'auth', token})` accept a token of exactly 32 lowercase hex characters, once per page load, kept only in the orchestration closure. A second `auth` is ignored. The token never enters anything sent to the iframe (spec webview-message-provenance "The token reaches only the outer page's main frame").
- [ ] 2.2 Route every post to RN (`toRN`, `rnLog`, the relay branches and the catch-all) through one signer that prefixes `W1.<token>.` when a token is held and posts unchanged otherwise. Before `auth`, buffer up to 64 host-log lines and count the rest. On `auth`, flush them signed and in order, followed by one summary line if any were dropped (design D2, D3).
- [ ] 2.3 Add `__whimControl({kind:'warm'})`, which answers the warm probe through the signer. Change `WARM_PROBE_JS`'s page-side contract to match; the host side of the change is task 3.4.
- [ ] 2.4 After `auth`, run the exposure probe once per page load (design D5):
  - a hidden iframe with `sandbox="allow-scripts"` and a `LOCKED_CSP` srcdoc whose script posts `navigating`, navigates the frame to a `data:` document, and posts `still-here` about 500 ms later if its realm survived (the navigation was refused);
  - that document reports `typeof` for both bridge objects through `parent.postMessage` under a non-`__whimHarness` key, and posts `WHIM-EXPOSURE-CANARY-1` straight to any visible bridge;
  - the outer page accepts reports only when `ev.source` is that probe frame's window, removes the frame, and sends a signed `bridge-exposure` report `{outcome: 'navigated'|'refused'|'timedOut', visible:{android,ios}, webview}`, with a 3 s limit; `webview` is `chrome-<major>` or `webkit`, read from the outer page's own user agent (design D5);
  - the probe never touches the forgery tally.
- [ ] 2.5 Add the `fixtures/adversarial/bridge-reach.app.tsx` fixture, registered in `build/build.mjs` `APPS` and in `src/host/launcher/dev-probe-fixtures.ts`. It:
  - posts a marked `probes` frame through `window.webkit.messageHandlers.ReactNativeWebView` when present;
  - navigates its frame to a `data:` document that looks for `__whimControl` and any 32-hex token-shaped string it can reach, reports what it sees through `parent.postMessage`, and posts forged unsigned `paint`, `probes {contained:false, marker}`, `error` and `syscall` frames straight to any visible bridge.
- [ ] 2.6 Extend `bridge-provenance.desktop.mjs` with the page cases:
  - `auth` is accepted once;
  - every post after `auth` is signed;
  - load-time log lines are flushed in order, with the overflow counted;
  - no exposure frame is created without `auth`;
  - a refused navigation (simulated by a probe frame whose navigation is blocked) reports `refused`, not `timedOut`;
  - the probe frame is removed after reporting and after a timeout;
  - an exposure-shaped post from the mini-app iframe is ignored;
  - the token never appears in any message sent to the iframe;
  - with no `auth` the page's output is byte-identical to today's for the same session.

  Run `npm run launcher:deliver-verify`, `npm run invariants` and `npm run bridge:invariants`; all must pass unchanged.

## 3. RN host: mint, deliver, verify (every consumer)

- [ ] 3.1 Add a pure, Node-importable module (no React Native imports) `src/host/launcher/runtime-message-auth.ts`. It holds:
  - `mintRuntimeToken()`, from the same secure source as the device id; it returns `null` on failure, with no fallback;
  - `acceptRuntimeMessage(raw, token)`, a constant-time prefix compare that returns the JSON body or a drop reason;
  - `isExposureCanary(raw)`, an exact match;
  - `exposureCode(record)`, mapping a recorded result onto the `device-diagnostics` `exposure` grammar (`refused` | `timed-out` | `navigated:<visible>[+canary]`), which group 7 uploads.
- [ ] 3.2 Mint a token at `onLoadStart` and deliver it at `onLoadEnd` (`injectJavaScript` of the `auth` control) for every runtime-page WebView: the product pool slots in `MiniAppView.tsx`/`webview-pool.ts`, the `useMiniAppHost` host (DevProbeScreen), and `NetworkDenyProbeScreen.tsx`. A reload, content-process termination or remount replaces the token. No delivery or launch is sent to a slot before its token is delivered.
- [ ] 3.3 Put the verifier at the head of every consumer:
  - `useMiniAppHost.onMessage`
  - `MiniAppView.onSlotMessage`, before the waiting-slot drop
  - `NetworkDenyProbeScreen.handleMessage`

  Check the canary first and record it per page load. Count dropped messages per WebView. Record `bridge-exposure` reports per page load and log them on the diagnostics channel. Show the exposure record, the drop count and the verdict's `bridge` field on DevProbeScreen.
- [ ] 3.4 Change `WARM_PROBE_JS` to call `__whimControl({kind:'warm'})`. The slot router accepts the signed warm answer only.
- [ ] 3.5 Add a helper in `src/host/launcher/test/native-host.tsx` that reads the token from the mock's recorded `auth` injection and signs frames. Move every existing suite that feeds `onMessage` directly onto it:
  - mini-app-host-ui
  - changing-in-use-ui
  - app-crashed-ui
  - app-morph-ui
  - launcher-stress-ui
  - mini-app-delivery

  Their assertions stay as they are.
- [ ] 3.6 Add `src/host/launcher/test/runtime-message-auth-ui.suite.tsx`. It covers:
  - each of the eleven kinds, unsigned → dropped with zero host-state change and the counter +1;
  - a wrong token → dropped;
  - the previous load's token after a reload → dropped;
  - the canary recorded and then dropped;
  - each of the four consumers dropping through the verifier.

  Red-check it against the weaker variant that checks the token only on `paint`/`probes`/`error`, plus a unit suite for the pure module. Run `npm run launcher:test` and `npm run gate` under the watchdog.

## 4. Native second layer

- [ ] 4.1 Android: a `RNCWebView` subclass, created by the existing `NetworkDeniedWebViewManager`, overrides `createRNCWebViewBridge`. On the web-message-listener path it registers the same listener but returns before forwarding when `isMainFrame` is false. The fallback path is unchanged. If the subclass cannot reach the bridge factory through the newarch manager, stop and report (design D6).
- [ ] 4.2 Android: add a debug-only `BuildConfig` switch, `WHIM_FORCE_JS_INTERFACE_BRIDGE`, that makes the subclass take the `addJavascriptInterface` path. Release build types cannot set it.
- [ ] 4.3 iOS: through the existing swizzle seam beside `WhimWebViewNetworkDeny.m`, swizzle `userContentController:didReceiveScriptMessage:` on the library's WebView implementation so that it returns early when the handler is `ReactNativeWebView` and `message.frameInfo.isMainFrame` is false.
- [ ] 4.4 Add `checks/test/release/webview-main-frame.suite.ts`, a static check, registered like `native-network-deny.suite.ts`. It asserts:
  - the Android override exists and drops non-main-frame posts;
  - `MainApplication` still replaces exactly one `RNCWebViewPackage`;
  - the force-fallback switch is unreachable from release build types;
  - the iOS swizzle exists and checks `isMainFrame`.

  Red-check it by removing the `isMainFrame` check and by enabling the switch in release.
- [ ] 4.5 iOS: swizzle RNCWebViewImpl's `webView:decidePolicyForNavigationAction:decisionHandler:` beside the 4.3 swizzle. When `navigationAction.targetFrame` exists, is not the main frame, and the URL is not `about:srcdoc` or `about:blank`, call `decisionHandler(WKNavigationActionPolicyCancel)` and return; otherwise call the original (spec sandbox-isolation "iOS refuses sub-frame navigations…", design D9). Extend `webview-main-frame.suite.ts` to assert the swizzle is installed once, checks `targetFrame.isMainFrame`, and allows exactly `about:srcdoc` and `about:blank`. Red-check against a removed frame check and against an allowlist widened with `data:`. Do not add a content rule: `native-network-deny.suite.ts` pins exactly two.
- [ ] 4.6 Build the offline Android release (`npm run android:release -- --device emulator-5560` build step only, or `assembleRelease`) and an iOS simulator build, so that both native layers compile. Write the upstream react-native-webview issue text (Android listener drops `isMainFrame`, iOS receiver ignores `frameInfo.isMainFrame`) to `docs/security/upstream-react-native-webview-main-frame.md` for the owner to file.

## 5. Device verification (four cases)

- [ ] 5.1 Android, current System WebView (listener path), debug build on Whim_Verify (emulator-5560). On DevProbeScreen, run tip-splitter and `bridge-reach`, then record:
  - the verdict (52 probes) and its `bridge` field;
  - the exposure record (`visible`, `canaryReachedNative`);
  - the drop counter;
  - that `bridge-reach`'s forged frames changed nothing (no paint release, no crash screen, no forged verdict, no syscall);
  - whether its `data:` document found `__whimControl` or a token.
- [ ] 5.2 Repeat 5.1 on a debug build with `WHIM_FORCE_JS_INTERFACE_BRIDGE` on (fallback path).
- [ ] 5.3 Repeat 5.1 on an iOS simulator build. Also confirm, under the D9 navigation refusal:
  - the mini-app frame paints and a `data:` image renders (tip-splitter or a fixture with one);
  - `bridge-reach`'s `data:` self-navigation is refused and its frame keeps its realm;
  - the exposure record's outcome is `refused`.

  If the refusal breaks anything legitimate, narrow its allowlist to refuse only `data:` and `blob:` (design D9), re-run, and record why.
- [ ] 5.4 Offline release build on Whim_Verify with the switch off. In the product shell:
  - generate or install an app and launch it, confirming it paints and its syscalls work (a storage app's write and read round-trip);
  - back navigation still works;
  - the exposure record appears in the diagnostics log for each pool slot;
  - with consent given and "Send error details" on, a local server's `/v1/diagnostics` log shows one `bridge-exposure` record per distinct result; with the switch off, none;
  - the reworded consent and Settings copy (group 7) reads well and fits on screen in English and French (screenshots);
  - no unsigned message is acted on.
- [ ] 5.5 Write the four cases' results into the evidence section of `docs/security/2026-11-19-verdict-channel.md`. If any counted in-frame probe fails on a real platform (notably if iOS `webkit.messageHandlers.ReactNativeWebView` cannot be removed from the frame), record the evidence and raise design Open Question 3 with the owner before closure. The owner decides then; do not pick a fix.

## 6. Docs and closure

- [ ] 6.1 Add the next decision to `docs/decisions.md`: the outer page → RN hop is authenticated per page load, the in-frame bridge probes are hard, the navigated-frame exposure probe is diagnostic, and the native main-frame filter is a second layer.
- [ ] 6.2 Update `docs/security/2026-11-19-verdict-channel.md`: change the device section's status from "proposed" to "fixed", cite the decision, and point to the tests that pin each property.
- [ ] 6.3 File an `ai-proposed` GitHub issue for every UNSAFE or NOT-CHECKED census row in research.md that this change does not fix. Known: the static passes do not flag `location` self-navigation (`checks/contract.ts`); `synthrun/capability.ts`'s main-frame guard was not read.

## 7. Exposure telemetry under the existing error-details consent (design D8)

- [ ] 7.1 Contract: add `exposure` (closed grammar from the `device-diagnostics` delta) and `webview` (`chrome-<n>` | `webkit`) to `DiagnosticRecord` in `contract/src/index.ts`, and to `DIAGNOSTIC_FIELDS` / `isDiagnosticRecord` / `toDiagnostic` in `src/host/logging/diagnostic.ts`, so that only the bridge-exposure record can carry them; an ordinary error record's `exposure`/`webview` are dropped.
- [ ] 7.2 Transport: in `src/host/logging/diagnostics.ts`, dedupe the bridge-exposure record by `(message, exposure, webview)`. Enqueue it already projected at `info` level through `enqueueDiagnostic` from the RN exposure handler (chain 3's record, via `exposureCode`). The gate in `diagnostics-target.ts` is reused unchanged.
- [ ] 7.3 Copy (en and fr), reworded, not widened (design D8):
  - `consentSentErrors`, `firstRunSentErrors` and `settingsErrorDetailsHint` in `src/host/launcher/copy.ts` and their French keys;
  - the error-details row description in `contract/src/disclosure-manifest.ts` (v2, description only; `diffManifests` must stay empty and `AI_CONSENT_VERSION` stays 2);
  - the error-details "When/Why" cells in `deploy/site/privacy.html` and `deploy/site/fr/privacy.html`.

  The new sentence says error details also include automatic safety checks of how the phone runs apps, frames them as protecting the user, keeps "technical only, never what you typed or saved", and stays as short as today's. Check it fits the first-run sheet and Settings at the largest font scale.
- [ ] 7.4 Tests: extend `src/host/logging/test/diagnostics.suite.ts` (projection, dedupe by result, a changed result is a new record, gate off → nothing sent and nothing queued, no token/URL/app id in the body), `server/test/diagnostics.suite.ts` and `server/test/contract.suite.ts` (accepts the fields on a bridge-exposure record, refuses a malformed `exposure`). Take fixtures from `exposureCode`'s real output. Red-check against the weaker variant that dedupes by the old 4-tuple.
- [ ] 7.5 Run `npm run launcher:test`, `npm run server:test`, `npm run checks:test -- --only disclosure,consent-coverage,store-listing`, then `npm run gate`, under the RSS watchdog.
