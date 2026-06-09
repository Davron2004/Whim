## 1. Disposable RN scaffold

- [x] 1.1 Init a throwaway React Native app (Android target) in a scratch dir — mark it clearly as spike code, not the v0.1 shell
- [x] 1.2 Add and link `react-native-webview`; render one full-screen WebView on a bare screen
- [x] 1.3 Confirm it boots on the Android emulator/device and the WebView loads a trivial inline HTML page
- [x] 1.4 Wire the host `onMessage` handler to log received strings (proves the host end of the transport)

## 2. Sandbox harness (H1: sandboxed iframe)

- [x] 2.1 In the WebView HTML, create a child `<iframe sandbox="allow-scripts">` (deliberately omit `allow-same-origin`)
- [x] 2.2 Implement forbidden-globals neutralization on the iframe context: remove/inert `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function`/`new Function`, `localStorage`, `indexedDB`, dynamic `import()`, `Worker`
- [x] 2.3 For any global the engine marks non-configurable (so `delete` fails), neutralize by shadowing within the bundle's execution scope (D3)
- [x] 2.4 Inject a fake one-function SDK exposing only `{ Button }` as the single reachable module/capability surface
- [x] 2.5 Verify the strip is surgical — React's render path still has the globals it needs (strip the dangerous set, not everything)

## 3. Make it run (D4 step 1 — sandbox-rendering)

- [x] 3.1 Hand-write a ~20-line bundle that imports `{ Button }` from the injected SDK and returns it as UI
- [x] 3.2 Render the bundle via React-to-DOM (R1) inside the iframe; confirm the button is visibly painted
- [x] 3.3 On tap, have the bundle post a string message via `window.ReactNativeWebView.postMessage`; confirm the host `onMessage` receives it (tap round-trips)
- [x] 3.4 Confirm nothing other than the injected SDK resolves as an import (no ambient module system, no host modules)
- [x] 3.5 Measure mount-to-first-paint on the Android target; record the number (rough ceiling ~150 ms)

## 4. Prove it's contained (D4 step 2 — sandbox-isolation)

- [x] 4.1 Write the forbidden-globals probe checklist as runnable assertions (one probe per forbidden entry: call it, assert it throws or is provably inert)
- [x] 4.2 Run the probe checklist from inside the bundle context; require zero exceptions (every entry throws/inert)
- [x] 4.3 Probe host/native reach: read `window.parent`, `window.top`, `window.frameElement` — assert no usable host/native handle is obtained
- [x] 4.4 Probe prototype-chain escape: walk `({}).constructor.constructor`, `Object`/`Array`/`Function` prototypes — assert no path resolves to a host function, the RN bridge, or a live native capability
- [x] 4.5 Inject one deliberate escape attempt and confirm the probes catch it (the checklist must fail loudly when containment is broken)

## 5. Fallback handling (only if Section 4 fails)

- [x] 5.1 ~~If H1 leaks…stand up the H2 (SES / `lockdown()`) variant~~ — **N/A: H1 passed (26/26 probes, `contained:true`). No fallback needed.**
- [x] 5.2 ~~Only if H2 also fails, note H3 (QuickJS/WASM) is implicated~~ — **N/A: H1 passed; H2/H3 not reached.**

## 6. Record the lesson, then delete the code

- [x] 6.1 Write the artifact into `docs/decisions.md`: which isolation primitive won, the exact neutralization technique that worked on the RN engine, the escape vectors probed, and the measured perf number — **decisions.md #31**
- [x] 6.2 Add a `DEVLOG.md` capture entry (create the file if absent) with the same lesson plus any dead ends / "I was wrong about X" — **created `DEVLOG.md`**
- [x] 6.3 ~~If H1 was rejected, add a `[REVERSED]`-style note against Decision #11~~ — **N/A: H1 confirmed. #11 is refined ("free" costs a CSP + cross-origin iframe + surgical strip), not reversed — see decisions #31.**
- [x] 6.4 Preserve the probe checklist as the seed of the §16.2 isolation invariant / Spike 6 CI suite (`invariants/sandbox-isolation/`); delete the rest of the throwaway spike code
