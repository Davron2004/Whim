# Sandbox-isolation invariant

The forbidden-globals + escape **probe checklist** from Spike 1
(`spike-sandbox-runtime`), now run against the real build. It is the spec **§16.2
network/native-isolation invariant** — what §28 calls the most important
never-regress assertion in the codebase. The Spike-1 and Spike-2 sources it grew
from were removed in 2026-09 and are in git history.

## What it asserts

A mini-app bundle running in the contained context **cannot**:

- reach the network — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `RTCPeerConnection`, `navigator.sendBeacon` all throw;
- execute code from strings — `eval`, `new Function`, and the
  `({}).constructor.constructor('…')` prototype-walk all throw, and dynamic
  `import()` rejects;
- touch ambient persistence/threading — `localStorage`, `sessionStorage`,
  `indexedDB`, `Worker` throw;
- reach the host or native layer — `window.parent`/`window.top` `.document`,
  `.location`, and `.ReactNativeWebView` (the real bridge) are all `SecurityError`;
  `window.frameElement` is `null`;
- resolve any module but the injected SDK — `require('react'|'fs'|…)` throws; no
  ambient `module`/`exports`/`process`.

A **negative control** plants a working leak and asserts the checklist flags it —
so the suite fails loudly when containment is actually broken.

## How containment is achieved (the Spike 1 finding)

1. A sandboxed `<iframe sandbox="allow-scripts">` **without `allow-same-origin`**
   → opaque origin; cross-origin blocks all host/native reach.
2. A CSP `script-src` **without `'unsafe-eval'`** → kills `eval`/`Function` AND the
   constructor-walk codegen path (the one thing global-stripping can't close).
   Plus `default-src 'none'`/`connect-src 'none'` as network defense-in-depth.
3. **Surgical** neutralization of the named value-globals (delete-then-redefine to
   throwing stubs), and lexical shadowing in the bundle scope for any
   non-configurable global. `Function`/`eval` are NOT value-replaced — that would
   break the React render path; CSP handles them.

> **D3 caveat:** the verdict only counts on the **real target engine** (Android
> System WebView via react-native-webview), not desktop Chrome. Desktop Chromium is a fast
> pre-check only.

## Retained v0.1 suite — `run-against-build.mjs` (the §16.2 blocking gate)

`webview-sandbox-runtime` **productionized** the Spike-1 sources into the real runtime
(`src/runtime/web/{neutralize,resolver,probes,loader}.js` + the `vc-sdk` SDK + the esbuild
build step). `run-against-build.mjs` is the promoted, never-regress suite: it assembles
scenario pages from **this build's** runtime + bundles (via `build/assemble.mjs` +
`src/runtime/generated/runtime-artifacts.json`) and runs them under headless Chromium.

```
npm run build        # esbuild → runtime HTML + bundles + artifacts
npm run invariants   # exit 0 = held, 1 = regression
```

What it asserts against the retained build:
- **b-tip** (channel b): tip splitter CONTAINED (every probe) + rendered + a tap round-trips
  to the host (sandbox-rendering) + paint measured.
- **a-tip** (channel a): the pre-baked parser-inserted fallback is CONTAINED + renders.
- **b-evil** (F4): a malicious bundle forges its verdict + spoofs control frames; the host
  REJECTS the unauthenticated frames (per-realm nonce, constraint #4) and the **trusted-vantage**
  verdict (closure-captured probes, constraint #3) still shows CONTAINED.
- **A1**: a self-posted `__whimDeliver`/`__whimHostInit` is ignored (`ev.source` guard), while a
  real host re-injection still advances the generation.
- **reset re-injection** (constraint #5 seam): re-creating the iframe gives gen-2 a clean realm
  (`anyPoison=false`, read from the trusted probes line).
- **INV-TIMER**: a gen-1 SDK `interval` never ticks after a realm reset, with a no-reset control.
- **c-blob**: a `blob:` `<script src>` stays REFUSED under the locked CSP (never widen script-src).
- **broken-CSP negative control**: a deliberately weakened CSP (`'unsafe-eval'` added) is
  FLAGGED red — proving the suite is not vacuously green (task 8.3).

CI: `.github/workflows/invariants.yml` runs `build` + `invariants` as a **blocking gate**
(the Spike-6 seed). Desktop is the fast filter; the authoritative pass is on-device (§8).
Invariants are authored by the runtime owners, never by a feature-implementing agent (§16.4).
