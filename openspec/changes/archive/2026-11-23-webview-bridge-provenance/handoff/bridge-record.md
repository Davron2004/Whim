# Contract: bridge-record (chain-1 → chain-2, chain-3)

Interface only. Source of truth: `src/runtime/web/{neutralize,loader,probes}.js`,
`src/runtime/test/bridge-provenance.desktop.mjs`.

## 1. The frozen record (neutralize.js)

Computed as neutralize.js's first act, before any other runtime script runs in the mini-app frame.

```js
// deep-frozen
{
  android: { present: boolean, removed: boolean }, // window.ReactNativeWebView, own or on window's prototype chain
  ios:     { present: boolean, removed: boolean }, // any window.webkit.messageHandlers (via any `webkit` on the chain), every entry
}
```

- `present`: a non-nullish value was reachable when the runtime started.
- `removed`: `present` AND, after removal, no holder on the chain yields a non-nullish value.
  `false` whenever `present` is `false`. The alarm condition is `present && !removed`.
- Removal: `ReactNativeWebView` is deleted from every holder on the chain, then shadowed with a
  writable, configurable own `undefined` (the loader writes its stub over it), then assigned. iOS
  (chain-8): `window.webkit` itself is deleted and shadowed (non-writable, non-configurable
  `undefined`), since WebKit does not enumerate handlers; if a `messageHandlers` stays reachable,
  `ReactNativeWebView` and `ReactNativeHistoryShim` are stripped from it by name and `removed` is false.
- The record never enters `window.__WHIM_NEUTRALIZE_REPORT__`.

## 2. Capture (loader.js)

- neutralize defines `window.__WHIM_BRIDGE_RECORD__` (non-enumerable, non-writable, configurable).
- At load, alongside its other captured references and before any app code runs, the loader reads
  the own descriptor. It accepts the value only if the descriptor is non-writable and configurable
  and the value is a frozen object. Otherwise the record is `null`. The loader then deletes the
  global, so app code finds nothing there, and anything it later writes under that name is ignored.
- The loader keeps its transport stub's identity in its closure:
  `const transportStub = { postMessage(s) → parent.postMessage(String(s), '*') }`.
  It installs the stub with a guarded `window.ReactNativeWebView = transportStub`. A non-writable
  native property makes the assignment fail without aborting the loader, so the verdict still
  posts, with `contained: false`.
- It calls the captured probe function as `trustedRunProbes({ stub: transportStub })`.

## 3. Verdict field

The `probes` payload (loader → outer page → RN, relayed verbatim) gains:

```js
bridge: { android: { present, removed }, ios: { present, removed } } | null  // plain copy of the captured record
```

The loader adds it next to `generation`, after `plainCopy` of the probe result. It is a side field
like `t7`: it is not counted in `total`, `passed`, `failed` or `contained`. `null` means neutralize's
record was missing or invalid. The outer page's diagnostics line and `document.title` are unchanged.

## 4. The three counted `reach` probes (probes.js)

`__whimRunProbes(trusted)` with `trusted = { stub }`. The probes only read: they never delete or
replace the stub. Exact `name` strings, all with `category: 'reach'`:

| name | passes iff |
|---|---|
| `frame bridge is the loader stub` | `trusted.stub` was provided, and every holder of `ReactNativeWebView` on window's chain (depth 0 and up) yields `trusted.stub` or nothing |
| `no native bridge on the window prototype chain` | no prototype of window (depth ≥ 1) yields a non-nullish `ReactNativeWebView` |
| `webkit.messageHandlers unreachable` | no `webkit` on the chain yields a non-nullish `messageHandlers` (expectUnreachable) |

Probe total: 49 → **52**. An app that replaces its own `window.ReactNativeWebView` with another
object fails the first probe. That is fail-closed.

## 5. Desktop suite harness (`src/runtime/test/bridge-provenance.desktop.mjs`)

Run: `npm run -s runtime:provenance-verify` (needs `npm run build`; it runs in gate-full as
`bridge-provenance`). It is a runner script, not a module. Chain-2 adds cases in the same file and
reuses:

- `RUNTIME_HTML` is the shipped page, written to a temp dir as `RUNTIME_PAGE`, which is removed at exit.
- `installFrameStubs(frameBridge)` is the init script for every frame. In the **top frame** it
  defines `window.__rnPosts` (non-enumerable array of raw strings) and a recording
  `window.ReactNativeWebView`. In **sub-frames** it installs stand-ins with
  `nativeBridge: true` that post into the frame-local `window.__nativePosts`:
  - `frameBridge.android` ∈ `'own' | 'own-locked' | 'inherited' | 'inherited-locked'`
    ("inherited" = on `Object.getPrototypeOf(window)`; "locked" = non-configurable, non-writable)
  - `frameBridge.ios` ∈ `'handler' | 'handler-locked' | 'locked' | 'shim' | 'shim-locked'` (both library
    handlers, non-enumerable like WebKit's, or `ReactNativeHistoryShim` alone; "locked"/"shim-locked" pin `webkit` too)
  - `null` installs nothing.
- `openRuntimePage(browser, frameBridge) → { page, pageErrors }` (navigated, `load` reached).
- `deliverApp(page, source) → verdict | null` calls `__whimControl.reinject({reset:true,
  bundle:'provenance-check', bundleSource, generation:2})` and polls up to 15 s for a `probes` frame.
- `relayedFrames(page) → object[]` is every top-frame post, `JSON.parse`d. Unparsable posts are
  skipped. **Chain-2 owns this function**: once posts are enveloped (`W1.<hex>.<JSON>`), it must
  strip or verify the envelope here.
- `verdictOf(page)` returns the last relayed `kind:'probes'` payload. `realmFrame(page)` is the
  mini-app frame.
- `bundleSource(tsx) → string` compiles a mini-app with build.mjs's app options.
- `until(ready, timeoutMs)` is a bounded poll that returns a boolean.
- `CASES[]` entries are `{ name, frameBridge, source?, want: { contained, probes, bridge }, uncover?, forged? }`.
  The loop checks: `want` deep-equals the observed verdict, `total` equals the counted probe entries,
  no page errors, the forged rewrite took effect (`forged`), and the realm uncover attempt (`uncover`).
  It exits 1 on any failure.
