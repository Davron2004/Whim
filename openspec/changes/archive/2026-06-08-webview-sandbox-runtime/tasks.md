## 1. RN shell bootstrap (first retained app + build env)

- [x] 1.1 Initialize the retained React Native app at the repo root (Android target, RN 0.85 / Hermes / new arch, React 19) — this is the v0.1 shell, not a throwaway scaffold; add `package.json`, `android/`, and app entry
- [x] 1.2 Pin the build environment per the captured DEVLOG gotchas: node **22** (explicit PATH prefix), Gradle JDK **21** (`org.gradle.java.home`, SDKMAN Temurin, no sudo), `reactNativeArchitectures=arm64-v8a` only
- [x] 1.3 Add and link `react-native-webview` (13.16+); render one full-screen WebView on a bare host screen
- [x] 1.4 Confirm the app boots on the Android emulator via an **offline release bundle** (`--mode release`, debug-signed, `debuggable true`) — Metro/NAT is dead, `adb reverse` doesn't rescue it
- [x] 1.5 Wire the host `onMessage` handler and confirm a trivial inline page can post a string the host logs to logcat (`ReactNativeJS`) — the host end of the transport

## 2. The contained container (#35 recipe)

- [x] 2.1 Serve the WebView document with the locked #35 CSP: `script-src 'unsafe-inline'` **without** `'unsafe-eval'`, `default-src 'none'`, `connect-src 'none'`, `img-src data:`, `frame-src/child-src/worker-src 'none'`, `base-uri/form-action 'none'`
- [x] 2.2 Create the cross-origin `<iframe sandbox="allow-scripts">` — deliberately omit `allow-same-origin` (and popups/forms/top-navigation)
- [x] 2.3 Productionize `neutralizeForbiddenGlobals()` from `invariants/sandbox-isolation/reference/neutralize.js` to run **first** inside the iframe: window-level `delete`-then-`defineProperty({configurable:false})` value-strip of `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`RTCPeerConnection`/`localStorage`/`sessionStorage`/`indexedDB`/`caches`/`Worker`/`SharedWorker`/`navigator.sendBeacon`
- [x] 2.4 Confirm the strip is **window-level, not lexical/closure** (constraint #1) and that `eval`/`Function` are NOT value-replaced (CSP handles them; value-replacing breaks React's `instanceof Function`)
- [x] 2.5 Keep lexical shadowing in the bundle execution scope as belt-and-suspenders for any global the engine marks non-configurable (sandbox-isolation: non-configurable globals handled)
- [x] 2.6 Verify the strip is surgical — the React render path and injected SDK retain the globals they need (sandbox-isolation: the allowed runtime survives stripping)

## 3. SDK slice, emit format, and the local build step

- [x] 3.1 Implement `defineApp({ name, initial, screens, capabilities })` returning a plain AppSpec descriptor (the host decides when/where to mount; the agent describes, the host renders)
- [x] 3.2 Implement the thin UI slice the tip splitter needs: `Screen`, `Stack`, `Text`, `Heading`, `NumberInput`, `Slider`/`SegmentedControl`, `Button` — components accept **tokens, not values** (color/spacing/radius/text-size/weight per §5.2/§5.3)
- [x] 3.3 Implement `useState` (in-memory state, web-side, no bridge)
- [x] 3.4 Hand-write the `fixtures/tip-splitter.app.tsx` bundle: imports only from `vc-sdk`, `export default defineApp({…})`, `capabilities: []` (zero syscalls)
- [x] 3.5 Build the local esbuild step (the server stand-in): classic JSX `React.createElement`, `format:'iife'`, with `vc-sdk`/`react`/`react-dom` marked external → one IIFE string
- [x] 3.6 Emit a source map with `sourcesContent` and verify a thrown error maps back to the **original** TS line (D4 of #37; gates the future §8.1 repair loop)

## 4. Delivery + module resolution (channel b / H1b)

- [x] 4.1 Inject `react`/`react-dom` once as a single shared host instance, and `vc-sdk` as a host-injected global — the resolvable surface is **exactly** `{vc-sdk, react, react-dom}` (constraint: one shared React instance)
- [x] 4.2 Implement the H1b resolver shim so the bundle's externalized `require("vc-sdk"|"react"|"react-dom")` resolve to the injected globals and **every other specifier throws** (sandbox-rendering: SDK is the only import surface)
- [x] 4.3 Implement the trusted loader (channel b): receive the bundle source over the host→web string transport and insert it as a DOM-created inline `<script>` (`script.textContent = src; head.appendChild(script)`) — **not** eval, not a module
- [x] 4.4 Confirm the loader/SDK hold **no capability stronger than `parent.postMessage`** on `window` or in any window-reachable closure (constraint #2)
- [x] 4.5 Wire channel (a) (inline `<script>` baked into `srcdoc`) as a characterized fallback behind a flag; confirm `blob:`/`data:` stays **refused** (never widen `script-src`)

## 5. Render path + transport (sandbox-rendering)

- [x] 5.1 Mount the delivered bundle's AppSpec via React-to-DOM inside the iframe; confirm the tip-splitter UI is visibly painted (the bundle does not know it is in an iframe/WebView)
- [x] 5.2 Round-trip a user event: a tap posts a string via `window.ReactNativeWebView.postMessage`; the RN host `onMessage` receives it (sandbox-rendering: a tap reaches the host) — _desktop-verified through the page relay; reconfirmed on-device in §8.1_
- [x] 5.3 Confirm the transport is string-only JSON, one pipe each way (the contract that later carries the syscall RPC envelope unchanged)
- [x] 5.4 Measure mount-to-first-paint on the Android target; record the number (~150 ms ceiling) into `docs/decisions.md` / `DEVLOG.md` — ≈119 ms cold / ≈32 ms warm-realm (under the ceiling); recorded in both

## 6. Trusted-vantage verdict, control-message auth, realm-reset seam

- [x] 6.1 Treat all iframe→host messages as untrusted data — authenticate/ignore bundle-origin control frames; do not trust a message by its `kind` tag (constraint #4)
- [x] 6.2 Compute the containment verdict from a trusted vantage the bundle cannot overwrite (and/or verify escapes out-of-band) — never from the bundle's self-report (constraint #3)
- [x] 6.3 Build the realm-reset seam for re-injection (constraint #5): re-create the iframe, or re-strip + re-freeze globals + `Object.prototype` per generation — even though the hot-reload UX is Spike 8, the seam must exist and prevent gen-1 pollution persisting into gen-2

## 7. Promote the never-regress isolation suite (§16.2)

- [x] 7.1 Promote `invariants/sandbox-isolation/` (probe checklist) + `spike2-bundle-contract/` (adversarial T1–T7 + F4) into the retained suite that runs against **this** build's runtime
- [x] 7.2 Wire the suite as a blocking CI gate (Spike-6 seed) — it blocks everything if red; invariants are authored here, never by a feature-implementing agent (§16.4)
- [x] 7.3 Run the desktop filter: headless Chromium (Playwright enforces CSP + iframe sandbox) — fast first pass, all invariants green (not the acceptance)

## 8. On-device acceptance + spec verification

- [x] 8.1 Run the authoritative on-device pass on the Android target: tip splitter renders + the tap round-trips + the full probe JSON renders on-screen `contained:true` (logcat truncates ~4 KB) — CONTAINED 42/42 on Android System WebView (Chromium 133)
- [x] 8.2 Confirm sandbox-isolation scenarios on-device: network/dynamic-codegen/persistence-threading primitives throw or are inert; `parent`/`top`/`frameElement` yield no host/native handle; prototype-walk reaches nothing — all 42 probes pass on-device
- [x] 8.3 Inject one deliberate escape attempt and confirm the suite flags it (the negative control fails loudly when containment is broken) — on-device: `evil` bundle's forged verdict + spoof frames REJECTED (nonce auth), attacks contained; desktop: broken-CSP page flagged red
- [x] 8.4 Confirm all sandbox-rendering + sandbox-isolation spec scenarios pass; record the perf number and any deviations in `DEVLOG.md` — done; perf + the JSX-runtime bug recorded
