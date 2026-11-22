## Context

The device runs a mini-app inside a sandboxed, opaque-origin iframe in an outer runtime page, and that outer page in turn is loaded by a react-native-webview WebView. Inside the WebView, #86 made the iframe → outer page hop sound: a nonce goes out once, travels only through paths captured before app code runs, and every relayed frame is checked against its source. The outer page → RN hop has no authentication at all. RN parses whatever arrives on `ReactNativeWebView` and trusts a `trusted: true` field that any sender can write (research.md Part A, Current behavior + census: every RN consumer UNSAFE).

Whether a frame other than the outer page can post on that bridge depends on the platform:

- **Android, current WebView:** react-native-webview uses `addWebMessageListener` with allowed origins `"*"` and throws away `isMainFrame`. Whether `"*"` matches an opaque-origin subframe is unverified.
- **Android, old WebView:** without `WEB_MESSAGE_LISTENER` it falls back to `addJavascriptInterface`, which Android documents as exposed to every frame.
- **iOS:** the `ReactNativeWebView` wrapper script is main-frame only, but the underlying `webkit.messageHandlers.ReactNativeWebView` handler is registered in the page world, and its receiver never reads `frameInfo.isMainFrame` (research.md Part A, Current behavior).

There are two candidate senders:

- **The mini-app frame itself.** If the platform injects a bridge there, `loader.js:107` overwrites it without recording that it existed. iOS `webkit` is never touched (research.md Part B, census).
- **A `data:` document the mini-app frame navigates itself to.** Neutralization does not run in that document, the CSP's `frame-src 'none'` does not govern self-navigation, and the native network refusal does not see `data:`.

Constraints carried in (research.md, both Constraints sections):

- Never widen the CSP.
- Realm reset = recreate the iframe.
- `invariants/` is owner-only, and `build/` is control plane (`CONFIG_SET`).
- synthrun must keep booting the unmodified production page.
- `sandbox-rendering` names `ReactNativeWebView.postMessage` as the bundle's transport.
- No `node_modules` patch mechanism exists, and installs run with `--ignore-scripts`.

## Goals / Non-Goals

**Goals:**
- RN acts only on messages proven to come from the outer page's realm, on every platform and both Android bridge paths, regardless of whether a subframe can see the bridge.
- A counted, hard probe for the strongest claim the runtime can actually enforce: app code in the mini-app frame cannot reach a native bridge object.
- A standing measurement, per device, of what a navigated frame can reach. This is the reproduction the security doc calls for, kept running afterwards.
- A native second layer wherever the platform reports frame identity.

**Non-Goals:**
- **Making the probes run before the bundle, or on the failure path (#273).** That is the verdict doc's "What stays out of reach" owner decision. This change neither depends on it nor blocks it.
- **Refusing subframe navigation natively on Android.** The security doc rejects it: Android does not reliably report sub-frame navigations. iOS does refuse them (D9).
- **A new consent screen or a consent version bump for exposure telemetry.** It rides the existing error-details consent (D8).
- **Changing `invariants/`.** Stub hosts deliver no token, so the page stays compatible with them. If the new probes conflict with `bridge/runner.mjs`, that is escalated to the owner, not edited.
- **Upstreaming the react-native-webview fix.** It is outward-facing. This change drafts the issue text and the owner files it.

## Decisions

### D1. A per-page-load token, delivered by main-frame injection after load

RN mints 128 bits from the same secure random source the device id uses. The token is minted at `onLoadStart` and delivered at `onLoadEnd` with `injectJavaScript("window.__whimControl({kind:'auth',token:…})")`. Every page load (reload, content-process termination, remount) gets a new one, and RN keeps only the current load's. Injection runs in the main frame on both platforms: Android `evaluateJavascript`, iOS `evaluateJavaScript:` (research.md Part A).

The outer page accepts `auth` once per page load and keeps the token in its orchestration closure. The outer realm never runs app code, and a subframe cannot reach it: the iframe is opaque-origin, and a navigated `data:` document is a new opaque realm.

**Alternatives considered:**
- *`injectedJavaScriptBeforeContentLoaded`.* On Android it is `evaluateJavascript` from `onPageStarted`, not a document-start script, so it races the page's inline script. Its `ForMainFrameOnly` flag is never read. It is reliable on neither platform (research.md Part A).
- *A token baked into `RUNTIME_HTML`.* The HTML is a build-time constant shared by every WebView and by synthrun, so the token would be neither secret nor per-load.
- *A token per launch (realm reset).* The outer realm outlives iframe resets and never holds app code, so rotating per launch adds churn and no security.
- *Leaning on the iframe nonce.* That nonce lives in the attacker's realm by design. The token deliberately lives where app code never runs.

### D2. Envelope `W1.<32 hex>.<JSON>`, checked before parsing

The outer page prefixes every post with the envelope. RN's shared verifier `acceptRuntimeMessage(raw, currentToken)`:

1. checks the fixed-length prefix with a constant-time compare;
2. only then hands the JSON body to the existing branch logic;
3. otherwise counts a drop and returns.

The `W1` tag versions the envelope. The `trusted` field stays, because it carries the outer page's nonce verdict. The token proves who is speaking; `trusted` says whether the frame came from the loader.

**Alternatives considered:**
- *Token as a JSON field.* This would parse attacker-controlled JSON before authenticating, the opposite of the capability-bridge spec's "refuse before `JSON.parse`" precedent (research.md Part A, Constraints).
- *An HMAC per message.* A sender who cannot read the token cannot forge either, and the transport is local. The HMAC adds cost with no attacker it stops.

### D3. The page works without a token; RN never does

Until the token arrives, the outer page posts exactly as today. That keeps synthrun, the owner's invariants and the desktop suites working with no edits (research.md Part A, Open question 2). On device RN drops those unsigned posts.

What the page would post before the token:
- Host-log lines from page load. These go into a bounded buffer (64 lines, then a count) that is flushed, signed, on `auth`.
- Nothing else. Delivery, paint, probes and syscalls all follow an RN-initiated delivery, which RN sends only after it has delivered the token.

`WARM_PROBE_JS` stops posting by itself. It calls `__whimControl({kind:'warm'})`, and the page answers through its signed path (research.md Part A, Risks).

**Alternatives considered:**
- *Buffer everything until a token.* This would break every stub host forever.
- *Make the stub hosts deliver tokens.* This would need owner edits to `invariants/` and buys nothing: the property under test is RN-side and is proven by the host suite (D7).

### D4. In-frame bridge: neutralize removes it, the loader records it, hard probes check it

At the top of `neutralize.js`, before anything else runs:
1. Record `present` for `window.ReactNativeWebView` (own or inherited) and for `window.webkit?.messageHandlers?.ReactNativeWebView`.
2. Remove them with the existing delete-or-shadow technique, which covers non-configurable globals.
3. Record `removed`.

The record goes into a frozen object that the loader captures at load, before app code runs, alongside its other captured references. It never travels through `__WHIM_NEUTRALIZE_REPORT__`, which app code can write (research.md Part B, Constraints). The loader then installs its stub as today.

New counted `reach` probes in `probes.js`:
- "frame bridge is the loader stub": the own and inherited `ReactNativeWebView` resolves to the captured stub;
- "no native bridge on the window prototype chain";
- "`webkit.messageHandlers.ReactNativeWebView` unreachable".

The verdict gains a `bridge` side field built from the captured record, like `t7` and not counted. `total` grows by three. README/docs "49" becomes 52.

Hard because: if app code can reach a native bridge, it can post to RN directly. The token makes that post harmless, but the sandbox-isolation SHALL ("no reachable path … to the native message bridge") would be false, and a probe that quietly passed would hide it. A hard fail on device affects only the dev probe screen (research.md Part B, Current behavior). Under synthrun there is no native bridge: Chromium has no `webkit`, and the harness transport is top-frame only, so the probes pass there. The one owner-run desktop harness that defines `ReactNativeWebView` in every frame (`bridge/runner.mjs`) defines a plain configurable property. Neutralize removes it and the probe passes; task 1.4 proves this before merge.

**Alternatives considered:**
- *Warning-only in-frame probe.* Rejected: it would leave the spec's SHALL unmeasured.
- *Make the stub non-configurable.* Rejected: app code replacing its own stub only fools itself (the outer page source-checks). The property that matters is that no native object is reachable, and that is what the probes check.

### D5. Navigated-frame exposure probe, run by the outer page, device only, diagnostic

On `auth`, the outer page runs the probe once:
1. It creates a hidden iframe with exactly the mini-app frame's `sandbox="allow-scripts"` and `LOCKED_CSP` srcdoc.
2. A tiny script in that frame navigates the frame to a `data:` document.
3. The `data:` document reports `typeof` for both bridge objects to the outer page through `parent.postMessage`, under a non-`__whimHarness` key. The outer page source-checks it against that probe frame and keeps it out of the forgery tally (research.md Part B, Risks).
4. If a bridge is visible, the document also posts the fixed canary `WHIM-EXPOSURE-CANARY-1` straight to it.
5. The outer page removes the frame and sends RN a signed `bridge-exposure` report with exactly one outcome: `navigated` (with `visible`), `refused` or `timedOut`. A 3-second time limit applies.

**Telling `refused` from `timedOut`.** The srcdoc script posts `navigating` before it sets `location`, then posts `still-here` about 500 ms later. Only a real navigation destroys that realm, so a `still-here` means the platform refused the navigation (expected on iOS under D9). The report also carries `webview`, the engine and major version the outer page reads from its own user agent (`chrome-<n>` or `webkit`).

RN recognizes the canary by exact string equality before the token check, records `canaryReachedNative` for that page load, and drops it. Recognizing a constant string reads no attacker data, and a forged canary can only claim something that is then actually true.

It is device-only because it starts on `auth`, and only RN delivers a token: under synthrun and Playwright every frame sees the harness shim, so the result would be meaningless there. It is diagnostic because neither the page nor the app can change what the platform injects into a navigated document. Once the token is enforced, exposure is harmless, and failing containment for it would fail every app on old Android WebViews for something the user cannot fix.

The result is recorded per page load. It goes to the host's diagnostics log channel, onto the dev probe screen, into the diagnostics upload (D8), and to the pool: the slot router handles `bridge-exposure` before the waiting-slot drop (research.md Part B, Integration points).

**Alternative considered:** *Probing from inside the mini-app frame.* Rejected: navigating the frame destroys the probe's own realm, and the CSP forbids a nested frame (probe 4b already confirms that).

### D6. Native second layer through the #74 seams, no patching

**Android:** a `RNCWebView` subclass, built by the existing `NetworkDeniedWebViewManager`, overrides the protected `createRNCWebViewBridge`. On the listener path it registers the same listener but returns early when `isMainFrame` is false. On the fallback path it changes nothing, since there is no frame identity.

A debug-only `BuildConfig` switch, `WHIM_FORCE_JS_INTERFACE_BRIDGE`, forces the fallback, so the fallback case can be reproduced on an emulator. A static check, beside `native-network-deny.suite.ts`, asserts:
- the override exists;
- `MainApplication` still replaces exactly one `RNCWebViewPackage`;
- the switch is unreachable from release build types.

**iOS:** extend the existing swizzle seam with a swizzle of `userContentController:didReceiveScriptMessage:` that returns early for `!message.frameInfo.isMainFrame` when the handler name is `ReactNativeWebView`. The same static suite covers it.

If a subclass cannot reach the bridge factory, because the newarch manager's impl is `private final` (research.md Part A, Integration points), the implementer reports back rather than improvising. The fallback is vendoring the one class through the Gradle source set, which is a design change for the owner.

**Alternative considered:** *patch-package.* Rejected: installs here skip install scripts, so the patch would silently not apply in worktrees and in the primary tree.

### D8. Exposure telemetry rides the existing error-details consent (owner decision 2026-11-22)

The owner wants the real share of phones whose navigated frames can reach the bridge, and wants any consent for it to sit with the existing consent screens, worded so people are inclined to accept.

- **No new consent and no version bump.** Error details is already part of the main AI-data grant: default on, disclosed on the first-run sheet and the consent screen, with its own "Send error details" switch in Settings. A `bridge-exposure` record contains no typed text, saved data or free text, its purpose (`operate`) already names security, and its holders, keep period and default are unchanged. So `diffManifests` reports no widening, `AI_CONSENT_VERSION` stays 2, and no tester is asked again.
- **Only the wording changes, and it gets warmer.** Every error-details sentence today says "when something goes wrong", which a per-page-load check doesn't fit. The copy is reworded (en and fr) on the consent screen, the first-run sheet, the Settings hint, the manifest row description and the privacy page. The new wording says error details also include *automatic safety checks of how your phone runs apps*, framed as protecting the user, still technical only, never what they typed or saved. Description text isn't compared by `diffManifests`, so this isn't a widening. Store answers (Apple `OTHER_DIAGNOSTIC_DATA`, Play `diagnostics`) already cover it.
- **Shape.** One `info`-level record, `message: 'bridge-exposure'`, two new allowlisted fields, `exposure` (closed grammar, spec `device-diagnostics`) and `webview` (`chrome-<n>` | `webkit`). It is enqueued already projected through `enqueueDiagnostic`, deduplicated by `(message, exposure, webview)` so a changed result within a session is its own record, and gated by `diagnostics-target.ts` exactly like error records. The contract `DiagnosticRecord` is shared, so the server route accepts the fields with no route change, and each record becomes a log line as before.

**Alternative considered:** *Encoding the result into existing fields (`kind`, `where`).* Rejected: the dedupe key would merge distinct results, and overloading field meanings makes the server logs lie.

### D9. iOS refuses non-main-frame navigations except `about:srcdoc`/`about:blank` (owner decision 2026-11-22)

The owner asked to block `data:` sub-frame navigation on iOS unless something breaks. Today nothing does: the content rule list blocks only `^https?:`/`^wss?:`, and react-native-webview's policy delegate allows everything under `originWhitelist ['*']`.

- **Where.** A swizzle of RNCWebViewImpl's `webView:decidePolicyForNavigationAction:decisionHandler:`, a sibling of D6's script-message swizzle: when `navigationAction.targetFrame` exists and is not the main frame and the URL is not `about:srcdoc`/`about:blank`, it calls `decisionHandler(WKNavigationActionPolicyCancel)` and returns; otherwise it calls the original.
- **Why an allowlist, not just `data:`.** `blob:` and `javascript:` documents are the same attack (a realm neutralization never ran in), so closing only `data:` would leave the hole open by one scheme. **If the device run shows the allowlist breaks anything, narrow it to `data:` + `blob:`** and record why.
- **Not a content rule.** An unqualified `^data:` rule would also block `img-src data:` images, it is unverified for `data:` documents, and the static check pins exactly two rules.
- **Checked statically** in `webview-main-frame.suite.ts`: the swizzle exists and is installed once, it checks `targetFrame.isMainFrame`, the allowlist holds exactly `about:srcdoc` and `about:blank`, with red-checks for a removed frame check and a widened allowlist.
- **Proven on device** (task 5.3): the mini-app frame paints, `data:` images render, `bridge-reach`'s self-navigation is refused, and the exposure probe reports `refused`.

### D7. Tests

- **Host suite** (new, beside `mini-app-host-ui.suite.tsx`):
  - every kind, token-less → dropped with zero state change;
  - wrong token → dropped;
  - the previous page load's token after a reload → dropped;
  - the canary is recorded and dropped;
  - all four consumers go through the verifier.

  It is red-checked against the plausible weaker variant (token checked only on `trusted` kinds, so paint/probes/error), not just against a deleted check. The existing suites switch to a `native-host.tsx` helper that reads the token from the mock's recorded `auth` injection, so their fixtures come from the real producer.
- **Desktop (Chromium) suite for the page:**
  - `auth` is accepted once;
  - every post after `auth` is signed;
  - load-time log lines are buffered and flushed in order, with the overflow counted;
  - no exposure probe runs without `auth`;
  - the probe frame is removed;
  - an exposure-shaped post from the mini-app iframe is ignored;
  - the token never appears in anything sent to the iframe.
- **Desktop probe suite:** a page whose frames get a configurable `ReactNativeWebView` and `webkit.messageHandlers` stub before load. Neutralize removes them, the three probes pass, and `bridge` reports present/removed. A sabotaged variant (non-configurable, non-writable) must make `contained: false`.
- **On device:** the `bridge-reach` adversarial fixture, run under the dev probe screen on the four cases in tasks group 5.

## Risks / Trade-offs

- **[iOS `webkit` cannot be removed from the frame]** → the hard probe fails on iOS, but only on the dev probe screen. That is the truthful result. The decision of what to do next (a spec delta, or a native measure such as a content-world handler) goes to the owner with the reproduction evidence. The token still makes the reachable handler harmless.
- **[The fallback-path object is non-configurable or comes back]** → same handling: the probe fails, the evidence is recorded, and the owner decides.
- **[Main-frame injection assumption]** Android `evaluateJavascript` is main-frame on every version the app supports, which is documented but unverified on device. → The on-device run checks that the token appears in no subframe: the `bridge-reach` fixture's `data:` document looks for `__whimControl` and for any token-shaped string it can reach.
- **[A lost token after a renderer crash]** RN mints and delivers again on the next `onLoadEnd`. Messages in between are dropped and counted, so the drop counter is visible on the dev screen.
- **[The probe count changes]** No test pins 49 (research.md Part B). The README and the security docs are updated in the same chain.
- **[The exposure probe's cost]** One extra tiny frame per WebView page load, not per launch, removed after at most 3 s.
- **[`build/assemble.mjs` is control plane]** Its chain is HUMAN-BOOTSTRAP: the assemble edits are reviewed and committed into the chain's base before it gates.

## Migration Plan

Pre-release, so there are no legacy builds to keep compatible (owner rule). Ship order follows the chains:
1. in-frame probes;
2. page side (signing, the exposure probe);
3. RN enforcement and native layer;
4. device verification.

Because the page posts unsigned until it has a token and RN starts enforcing only in chain 3, every intermediate state works. Rollback means reverting chain 3, which restores token-blind RN; the page side is harmless without it.

## Open Questions

1. ~~Exposure telemetry~~: resolved by the owner, 2026-11-22: upload it, under the existing consent (D8).
2. ~~iOS subframe navigation~~: resolved by the owner, 2026-11-22: refuse it (D9), unless the device run shows something breaks.
3. **If the in-frame probe fails on a real platform** (notably if iOS `webkit.messageHandlers` cannot be removed from the frame), the owner decides after seeing the evidence (2026-11-22: "let's just see and decide after"), which fix: a spec delta or a native measure? This is an owner decision fed by task group 5's evidence.
