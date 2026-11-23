# Research digest: What would authenticating the outer page → RN hop, and probing native-bridge exposure from the mini-app frame, touch?

Two `researcher` digests (opus/high, 2026-11-21), dispatched in parallel and pasted verbatim: Part A covers the outer
page → RN message path (the token fix), Part B the in-frame and navigated-frame exposure probes. Problem statement:
`docs/security/2026-11-19-verdict-channel.md` §"Device: a frame posting straight to the native bridge"; decision #86.

## Part A — the outer page → RN hop

### Relevant files
- `build/assemble.mjs` — outer page orchestration script: every poster to RN (`toRN` :145, `rnLog` :152, `relaySyscall` :150, `rejectForgery` :162, relay branches :170-193).
- `src/host/launcher/useMiniAppHost.ts` — the single RN parser `onMessage` :318-389 (shared by MiniAppView + DevProbeScreen); `control()` :243 is the RN→page path via `injectJavaScript`.
- `src/host/launcher/MiniAppView.tsx` — product WebView pool (:262-282), per-slot router `onSlotMessage` :229.
- `src/host/launcher/webview-pool.ts:55-57` — `WARM_PROBE_JS`/`WARM_ANSWER`, a second RN-injected poster in waiting slots.
- `src/host/launcher/DevProbeScreen.tsx:62-72` (dev entry), `src/host/NetworkDenyProbeScreen.tsx:188-248` (`RUN_NETDENY_PROBE`) — the other two WebViews; `BridgeProbeScreen` mounts none.
- `src/host/launcher/boot-state.ts:100` (`paintAccepted`), `src/host/bridge/dispatcher.ts:69-115` (`handle`, generation fence).
- `node_modules/react-native-webview` (14.0.1): android/.../RNCWebView.java, RNCWebViewClient.java, RNCWebViewManagerImpl.kt; apple/RNCWebViewImpl.m.
- `android/app/src/main/java/com/whim/webview/NetworkDeniedWebViewManager.kt`, `ios/Whim/WhimWebViewNetworkDeny.m` — existing native hooks into the library (#74).

### Current behavior
- Outer page → RN kinds (all via `window.ReactNativeWebView.postMessage(JSON.stringify(obj))`, no per-WebView secret): `{__whimHostLog,line}` (`rnLog`; can fire during `makeIframe` at page load, before RN has sent anything); `syscall` (`trusted:false`, raw payload, :150); `ui-event` (:171); `nav-depth` (GEN-stamped, :176); `rejected-forgery` (:162); `delivery`, `paint` (GEN), `error`, `probes` (all `trusted:true`, :187-192); catch-all `{kind:m.kind,trusted:true}` :193 (loader only emits error/paint/probes/ready/delivery, so unreached today). RN's `WARM_PROBE_JS` posts `{__whimWarm}` from injected JS outside the orchestration closure.
- RN parse (useMiniAppHost.ts:318): `JSON.parse`, then `__whimHostLog`→`log.debug` :333; `syscall`→`dispatcher.handle`→injected sysret :336; `nav-depth`→BackPolicy :350; `ui-event`→`lastTap` :359; `paint`→`paintAccepted` (requires `trusted===true` + bound generation) :362; `probes` (`trusted===true`) → verdict state :365; `rejected-forgery`→counter :377; `delivery`→deadline restart :380; `error` (`trusted===true`) → crash screen/error record :383/:103. The only "authentication" RN does is the `trusted` boolean, which the outer page sets but any poster can write. RN never sees `nativeEvent.url` or frame identity.
- WebViews: three, all `source={{html: RUNTIME_HTML}}`, `originWhitelist ['*']`, no `injectedJavaScript*` props: MiniAppView (product, runs mini-app code), DevProbeScreen (fixture bundles), NetworkDenyProbeScreen (canary bundles). All RN→page traffic after load is `injectJavaScript` → Android `evaluateJavascript` (Kt:341), iOS `evaluateJavaScript:` (m:1537), both main frame. I did not verify on device.
- Android bridge: `createRNCWebViewBridge` (java:250-273) registers `addWebMessageListener("ReactNativeWebView", Set.of("*"))` when `WEB_MESSAGE_LISTENER` is supported; listener (:255-256) receives `isMainFrame` and drops it, forwarding `sourceOrigin` only; else `addJavascriptInterface` fallback (:269), whose `postMessage` (:446-449) has no frame info and reports `mWebView.getUrl()`. `injectedJavaScript*ForMainFrameOnly` is stored (java:66-67, Kt:502/507) but **never read**; both injected scripts run via `evaluateJavascript` from `onPageStarted` (Client:83) / `onPageFinished` (Client:60), i.e. main frame only regardless. No `DOCUMENT_START_SCRIPT`/`addDocumentStartJavaScript` anywhere in the package, so "before content loaded" races the page's inline script.
- iOS bridge: handler `ReactNativeWebView` via `addScriptMessageHandler:name:` (m:1850, :1941), no content world; wrapper script `forMainFrameOnly:YES` (m:1803); injected scripts honor ForMainFrameOnly flags (default YES, m:180-182, :1728, :1768). Receiver (m:798-803) reads `message.body` + `frameInfo.request.URL`, never `frameInfo.isMainFrame`.
- Syscalls: outer page source-checks (`ev.source===iframe.contentWindow`, :179) and relays the raw payload; dispatcher fence compares marshaller-stamped `frame.gen` to `realm.generation` (dispatcher.ts:87/115) — a small host counter (useMiniAppHost.ts:270), so it orders but does not authenticate. The gate grants only the app's own manifest capabilities.

### Constraints and invariants
- #37 constraint #4 (only nonce-authenticated frames trusted); #86 (iframe nonce once, only through captured-before-app-code paths); #41 (in-frame syscall authority `ev.source===window.parent`, dispatcher generation-fenced).
- #74: leg 4 is a library subclass (Android) / WKWebView swizzle (iOS); checks/test/release/native-network-deny.suite.ts checks it statically; MainApplication.kt:29 requires exactly one replaced `RNCWebViewPackage`.
- sandbox-rendering:22 names `ReactNativeWebView.postMessage → onMessage` as the transport; sandbox-rendering:88 forbids a new frame kind or bundle-visible field for `paint` (an outer-realm field is not bundle-visible).
- `invariants/` is owner-authored; its stub transports consume `toRN` (verdict-channel.mjs:132, bridge/runner.mjs:112), as do synthrun/observe.ts:426 and deliver-by-source.desktop.mjs:261/452/511.
- synthetic-run spec (:85-89) already requires provenance attributable to the main frame *and* `trusted`, server-side; capability-bridge spec :102-114 requires a main-frame refusal before `JSON.parse` for Playwright bindings. No spec states any requirement on authenticating the device's outer page → RN hop (grepped sandbox-isolation, sandbox-rendering, capability-bridge, app-launcher, host-observability, mini-app-back-navigation, synthetic-run).

### Integration points
- Outer page: `toRN`/`rnLog` (assemble.mjs:145/152); `window.__whimControl` (:195), already driven by RN injection.
- RN: head of `onMessage` (useMiniAppHost.ts:318-331, before any branch); `onSlotMessage` (MiniAppView.tsx:229); `handleMessage` (NetworkDenyProbeScreen.tsx:188).
- Android native: `RNCWebView.createRNCWebViewBridge` is `protected` (java:250); `RNCWebViewManagerImpl.createRNCWebViewInstance` (Kt:62)/`createViewInstance(context, webView)` (Kt:71) exist; newarch manager's `mRNCWebViewManagerImpl` is `private final` (newarch RNCWebViewManager.java:41) — I did not verify whether a subclass can reach the two-arg path. iOS: the existing WKWebView swizzle seam (WhimWebViewNetworkDeny.m:20-28).
- Patching node_modules: no patch-package, no `patches/`, no `postinstall` in package.json; scripts/worktree.sh:252 runs `npm ci --ignore-scripts` (else clones the primary tree's node_modules); .github/workflows/invariants.yml:32/66 plain `npm ci`.

### Pattern census
Test: does this consumer refuse a message that did not come from the outer page's own realm?
- useMiniAppHost.ts:318 `onMessage` (product + DevProbe) | UNSAFE | no provenance input at all; every branch (log, syscall, nav-depth, ui-event, rejected-forgery, delivery) acts on content alone
- boot-state.ts:100 `paintAccepted` | UNSAFE | checks `trusted===true` (sender-written) + guessable generation
- useMiniAppHost.ts:103 `handleErrorFrame` | UNSAFE | `trusted===true`, sender-written
- useMiniAppHost.ts:367 `probes` | UNSAFE | `trusted===true`, sender-written
- MiniAppView.tsx:229 `onSlotMessage` → `WARM_ANSWER` | UNSAFE | string compare only; waiting slots appear never to hold app code (`dropLaunchSlot`, webview-pool.ts:102) — not verified exhaustively
- NetworkDenyProbeScreen.tsx:188 | UNSAFE | no check; displays a label only (probe-only)
- RNCWebView.java:255 (listener) | UNSAFE | drops `isMainFrame`
- RNCWebView.java:446 (fallback) | UNSAFE | no frame identity exists
- RNCWebViewImpl.m:798 (iOS) | NOT-CHECKED | never reads `isMainFrame`; whether a subframe can reach `webkit.messageHandlers` unverified
- synthrun/capability.ts (server analogue) | NOT-CHECKED by me | security doc says it refuses non-main-frame sources; I did not read it

### Risks and unknowns
- Timing: `rnLog` can post at page load (assemble.mjs:144/210), before RN could hand over a token; Android "before content loaded" injection is not document-start; `WARM_PROBE_JS` posts from outside the closure.
- Tests that feed token-less frames straight through `onMessage` (src/host/launcher/test/native-host.tsx mock records injected scripts): mini-app-host-ui.suite.tsx:284/310, changing-in-use-ui.suite.tsx:74, app-crashed-ui.suite.tsx:323, app-morph-ui.suite.tsx:177/265, launcher-stress-ui.suite.tsx:204, mini-app-delivery.suite.tsx:86; boot-state.suite.ts:94/158 unit-tests `trusted:false`. bridge:test (src/host/bridge/test/acceptance.ts) is dispatcher-level, not the frame parser. A "token-less message of every kind is dropped" test would sit naturally beside mini-app-host-ui.suite.tsx.
- Impact of a forged direct-to-RN frame (from code): release an opening early (paint); raise the crash screen + error record (error; diagnostics upload not traced); forge the dev verdict (probes); inject attacker strings into logs (`__whimHostLog`); dispatch syscalls under the app's own manifest (whether colliding dedup ids could feed a genuine request a forged result — not verified).
- Whether Android `"*"` matches opaque-origin subframes, and whether iOS exposes the handler to subframes: unverified; the doc's step-1 on-device reproduction is outstanding.

### Open questions for the planner
1. Is a message posted before the token arrives (`rnLog` at load) dropped or buffered?
2. Do the stub hosts (owner-authored invariants, synthrun, desktop suite) get the token, or does the page stay token-agnostic when none is delivered?
3. Native layer: a patch (no mechanism exists; worktrees run `--ignore-scripts`) or a subclass/swizzle like #74?
4. Is iOS (`frameInfo.isMainFrame`) in scope for the second layer?
5. Is the `WARM_ANSWER`/NetworkDeny path in scope for the token drop?

## Part B — bridge-exposure probes

### Relevant files
- `src/runtime/web/neutralize.js` — first in the iframe; strips network/storage/worker globals, publishes `window.__WHIM_NEUTRALIZE_REPORT__`; never touches `ReactNativeWebView` or `webkit`.
- `src/runtime/web/loader.js` — captures trusted refs at load (L38-55); plainly assigns the transport stub `window.ReactNativeWebView = {postMessage→PARENT}` at L107; runs probes after paint (L278-296).
- `src/runtime/web/probes.js` — `__whimRunProbes()`, the verdict oracle.
- `build/assemble.mjs` — `buildSrcdoc` (script order, CSP) and `buildOuterHtml` (`makeIframe`, handshake, relay to RN, diagnostics line); `build/build.mjs` builds RUNTIME_HTML from it (L333-341, `showDiagnostics:false, autostart:false`).
- `src/host/launcher/useMiniAppHost.ts:365-376` (`probes` case), `MiniAppView.tsx` (pool, `onSlotMessage`), `webview-pool.ts:55` (`WARM_PROBE_JS`), `DevProbeScreen.tsx` + `dev-probe-fixtures.ts`.
- `synthrun/observe.ts` — `installRelayShim` L415-435, `recordProbesOutcome` L263-306; `server/src/generation/stages/run.ts`, `server/src/generation/machine.ts:257` (`UNVERIFIED_RUN_REASON`).
- `invariants/sandbox-isolation/run-against-build.mjs`, `verdict-channel.mjs`, `bridge/runner.mjs` — owner-authored (#28).
- `src/host/NetworkDenyProbeScreen.tsx` + `scripts/netdeny/variants.ts` — existing on-device self-navigation reproduction harness (`RUN_NETDENY_PROBE`).

### Current behavior
- Srcdoc order (assemble.mjs:81): neutralize → reactInject → resolver → sdkInject → probes → syscall → loader (+ channel (a) baked-bundle definer); each an inline `<script>` under `LOCKED_CSP` (L19-29: `default-src 'none'; script-src 'unsafe-inline'; … frame-src 'none'; child-src 'none'`).
- Iframe: `makeIframe()` (L160) removes the old iframe, mints a CSPRNG nonce, resets `helloAnswered`, creates `<iframe sandbox="allow-scripts">` with srcdoc; called once at outer-script start and on every `reinject({reset:true})` (realm reset, spike2 §5). The outer page has no CSP of its own.
- Outer page today runs no probe of its own — only handshake, auth, delivery, relay, diagnostics; its listener sends any `__whimHarness` frame not from the current iframe (or pre-handshake) to `rejectForgery` → `rejected-forgery` to RN; unknown non-harness messages are dropped.
- probes.js: `expectThrow` / `expectUnreachable` (null/undefined or throw = pass) / `expectResolves` push `{category,name,ok,detail}`. Categories: network, codegen, ambient, escape, reach, module, pentest-T1/T3/T5/T6, pentest-T7-info, negative-control. `contained` excludes `EXCLUDED={negative-control, pentest-T7-info}` (L298). Verdict = `{neutralizeReport, probes, total, passed, failed, failures, negativeControlCaughtBreach, deliveryLeakCaught, contained, t7}` (+ `generation` added by loader).
- Non-fatal precedents: T7-info excluded from `contained`; T6 spoof always records `ok:true` as a "CONSTRAINT" note; `t7` is a side field the outer page and host read. No warning tier exists.
- Reach probes cover only `window.parent/top.ReactNativeWebView` (L104-105). Nothing covers the frame's own `window.ReactNativeWebView` (masked by the loader stub) or `webkit.messageHandlers`.
- Probes run after the bundle: `afterBundle` → double rAF → paint → `trustedRunProbes()` (loader L278-295). No probes if the module has no default export (L261-263), the mount throws, or the app never paints. Probes see the realm's live built-ins (verdict-channel doc, "What stays out of reach").
- Verdict consumers: outer page (L192) sets `document.title='WHIM:CONTAINED|LEAK'` + diagnostics line `contained=… negCtl=… deliveryLeakCaught=…`, relays payload verbatim. RN host stores `contained` + `probesFrac` (passed/total), feeding DevProbeScreen only. MiniAppView `onMessage` reads only `e.nativeEvent.data` (no origin/main-frame info). A waiting pool WebView's messages are dropped unless exactly `WARM_ANSWER` (MiniAppView L229-233). synthrun reads only boolean `payload.contained` (monotone, fail-closed); missing verdict → `containment_unobserved` → server "We couldn't verify this app ran safely" (machine.ts:257, generation-pipeline spec ~L307).
- Probe total: no test hardcodes 49. verdict-channel.mjs:156 requires `0<total<999`; run-against-build.mjs regex-parses the outer diagnostics line (`contained=`, `negCtl=`, `deliveryLeakCaught=`, `anyPoison=`, `N/M probes`). "49" appears only in README.md:42,94 and docs/security/* notes.

### Constraints and invariants
- Never widen the CSP; never value-replace `Function`/`eval` (#35/#37/#74). Realm reset = recreate the iframe (spike2 §5).
- Nonce-only trust; nonce once per iframe; everything trusted captured before app code (#86, tightening #37 #4).
- `__WHIM_NEUTRALIZE_REPORT__` is a writable window global probes.js reads live (L303) — app code can rewrite it; a presence record stored there is forgeable unless the loader captures it.
- sandbox-isolation spec: "The contained context cannot reach the host or native layer" (no reachable path to "the native message bridge" — a SHALL, in tension with a warning-only exposure probe); "Forbidden globals are unavailable to the bundle" scenario "The probe checklist runs as pass/fail assertions" ("zero exceptions").
- synthetic-run spec: "The candidate boots in the unmodified production runtime page"; "Observation is trusted-vantage only" (rejected forgeries counted); "Host observation channels are unreachable from the candidate realm"; unobserved-phase requirements (L438, L449).
- sandbox-rendering spec "User events round-trip from the bundle to the RN host" names `window.ReactNativeWebView.postMessage`; the loader stub must keep satisfying it (src/sdk/events.ts:16, fixtures call the stub).
- `invariants/` owner-only: any change to the diagnostics-line format or to what a "genuine verdict" means touches owner files.

### Integration points
- In-realm probe: presence record at the top of neutralize.js (before L25's IIFE body ends); the loader would need to capture it before app code (as with `trustedRunProbes` at L92); reported via the verdict (new probe category in/out of `EXCLUDED`, or a side field like `t7`). The "cannot recover the native object" check attaches to the stub assignment at loader L107.
- Outer probe: `orchestrationScript` (assemble.mjs) next to `makeIframe`; its report path must avoid the `rejectForgery` branch (L170, L185) and reach RN via the main-frame `toRN`. Pool WebViews load before any launch, so a page-load report is dropped unless MiniAppStage/webview-pool handle it.
- Display: diagnostics line (assemble L192), `probes` case in useMiniAppHost, DevProbeScreen, synthrun `recordProbesOutcome`.
- On-device fixture: fixtures/adversarial/ (registered in build.mjs `APPS` L233-250 + `DEV_PROBE_FIXTURES`) or a variant in the NetworkDenyProbeScreen/scripts/netdeny pattern. Maestro flows exist only in scripts/release/upgrade-check/*.yaml and demo/android/flows/ — no containment flow.

### Pattern census
Test: is the native bridge's presence in the mini-app frame either impossible or detected?
- src/runtime/web/loader.js:107 | NOT-CHECKED | overwrites the frame's `ReactNativeWebView` without recording whether a native object was there; plain assignment under `'use strict'` would throw (aborting the loader → no verdict) if a native property were non-writable — unverified
- src/runtime/web/neutralize.js (whole file) | NOT-CHECKED | never reads `ReactNativeWebView` or `webkit`
- src/runtime/web/probes.js:104-105 | NOT-CHECKED | parent/top reach only (cross-origin `SecurityError` = pass); frame's own property and `webkit.messageHandlers` not probed
- build/assemble.mjs:145,152 | SAFE (main-frame use) | `toRN`/`rnLog` read the bridge in the outer page, the intended consumer; detect nothing about subframes
- src/host/launcher/MiniAppView.tsx:267 → useMiniAppHost.ts:318 | UNSAFE | reads only `nativeEvent.data`; cannot tell a subframe sender from the outer page
- src/host/launcher/DevProbeScreen.tsx:67, src/host/NetworkDenyProbeScreen.tsx | UNSAFE | same `onMessage` shape
- src/host/launcher/webview-pool.ts:55 | SAFE | RN-injected main-frame script, reads only `__whimControl`
- src/sdk/events.ts:16-17 | NOT-CHECKED | SDK posts via whatever `globalThis.ReactNativeWebView` is; relies on the loader stub having replaced any native object
- synthrun/observe.ts:424-426 | SAFE | transport defined top-frame only + main-frame provenance guard (synthrun/capability.ts per the doc); server-side, impossible by construction
- synthrun/test/acceptance.ts:684-708 | SAFE | asserts the sandbox realm holds the loader stub and frames through it are rejected (desktop only)
- synthrun/test/acceptance.ts:427,465, synthrun/test/resilience.ts:76 | SAFE | test shims via the top-frame transport
- invariants/sandbox-isolation/verdict-channel.mjs:125,132 | SAFE | top-guarded shim + main-frame binding guard
- invariants/sandbox-isolation/bridge/runner.mjs:112 | UNSAFE (for this property) | `addInitScript` defines `ReactNativeWebView` in every frame, sandbox realm included, before neutralize runs — a presence probe would read "present" here; :183's `SUSPECT` regex walks only the SDK facade
- src/host/launcher/test/deliver-by-source.desktop.mjs:256,447, src/sdk/test/motion.desktop.mjs:201 | SAFE | top-guarded; :511 `page.evaluate` main frame only
- fixtures/adversarial/evil.app.tsx:56, timer-ticker.app.tsx:37 | NOT-CHECKED | assume the stub; evil labels any value "loader stub"
- checks/contract.ts:245-282 | NOT-CHECKED | static passes name neither `ReactNativeWebView`, `webkit` nor `location`; a bare `location.href='data:…'` passes them (other passes not verified)

### Risks and unknowns
- No on-device behavior verified: whether Android `"*"` matches opaque origins; whether the `addJavascriptInterface` fallback object can be deleted, is re-injected, or is recoverable after the stub; whether iOS `webkit.messageHandlers` reaches subframes.
- I did not verify whether a `data:` document in the sandboxed frame inherits the srcdoc CSP/sandbox flags, or whether #74's iOS rule list / Android refusal blocks `data:` (the doc says Android does not).
- In synthrun/invariants the throwaway frame's `data:` document sees the harness shim, not RN, so desktop results say nothing about a device; the Playwright binding sits in every frame. Whether `installRelayShim` runs in a navigated `data:` document is unverified.
- An outer-probe frame posting `__whimHarness`-shaped messages would add to synthrun's `rejectedForgeries` and the host's tally.
- #273 (not accessed): probes depend on paint, so a pre-delivery/failure-path probe touches loader `afterBundle`, synthrun's unobserved phases (observe.ts:349 `LOADER_PHASES`), run.ts:73-104 (repairable never-mounted), and the owner decision flagged in the verdict-channel doc.
- An in-realm hard probe would make `contained=false` under bridge/runner.mjs as written (owner-only file).

### Open questions for the planner
1. Does a warning-only exposure result satisfy the sandbox-isolation SHALL "no reachable path to … the native message bridge", or does the spec need a delta?
2. Presence record in the counted probe list (moves the "49" total in README/docs) or a side field like `t7`, given invariants parse the outer diagnostics line?
3. On a product page the pool drops a waiting WebView's messages — where is a once-per-WebView outer-probe result recorded/shown?
4. Who makes owner edits to invariants/sandbox-isolation/bridge/runner.mjs (ungated shim) and any diagnostics-line format change?
