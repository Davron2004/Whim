# Research digest: What would fixing the 2026-06-13 launcher/mini-app bugs (B1–B9) touch?

## Relevant files

- `src/host/launcher/MiniAppView.tsx` — mounts the WebView and fires `deliverBySource` in a no-dep `useEffect` (B1 root)
- `src/host/launcher/useMiniAppHost.ts` — `deliverBySource` → `bind` → `control(js)` → `injectJavaScript`; owns the realm loop, back-handler, syscall dispatch (B1)
- `src/host/launcher/deliver.ts` — `deliverBySourceJs()` builds the `__whimControl.reinject({bundleSource})` string (B1)
- `build/assemble.mjs` — `buildOuterHtml()` / `orchestrationScript()`: `showDiagnostics` default, `initial: 'tip-splitter'` fallback, iframe height `60vh` vs `100%` (B1, B3, B4)
- `build/build.mjs` — calls `buildOuterHtml({ showDiagnostics: true, initial: 'tip-splitter' })` and writes `src/runtime/generated/runtime-html.ts` (B3, B4 — must `npm run build` after change)
- `fixtures/tip-splitter.app.tsx` — Reset handler sets `setBill(0), setTipPct(20), setPeople(1)` instead of 100/20/4 (B2)
- `src/host/launcher/HomeScreen.tsx` — `SafeAreaView` from `react-native` (not safe-area-context); cell hit areas; grid empty space (B6, B7, B9)
- `src/host/launcher/copy.ts` — `createBody: '…Coming soon.'` (B8)
- `App.tsx` — `SafeAreaProvider` present; `<LauncherRoot />` is a bare child with no `SafeAreaView` wrapper (B9)
- `src/sdk/index.tsx` — `NumberInput` renders a native `<input type="number">`; no `outline`/`-webkit-appearance` reset, browser focus ring may produce the teal artifact (B5)

## Current behavior

**B1 (CRITICAL):** `MiniAppView.useEffect(fn, [])` fires on mount and immediately calls `deliverBySource`, which calls `control(js)` → `webRef.current?.injectJavaScript(...)`. Because the WebView has not loaded yet, `injectJavaScript` is silently dropped. When the outer page loads and the iframe fires `ready`, `pendingSource` is `null` (the `reinject` never landed), so the orchestrator falls through to `INITIAL` (`'tip-splitter'`) regardless of which card was tapped. Correct delivery requires `reinject({bundleSource})` to land before the iframe fires `ready`; there is no `onLoadEnd` callback wired in `MiniAppView`.

**B2:** In `fixtures/tip-splitter.app.tsx` the Reset `onPress` calls `setBill(0), setTipPct(20), setPeople(1)`. Intended defaults are 100/20/4 (matching the `useState` initializers). `setTipPct(20)` is correct; `setBill` and `setPeople` are wrong.

**B3 & B4:** `build/build.mjs` calls `buildOuterHtml` with explicit `showDiagnostics: true` — a deliberate dev choice never flipped to `false`. When true, `buildOuterHtml` emits the DELIVERY/PAINT/CONTAINMENT `<pre>` blocks and the status-bar `<div id="status">`, and sets the iframe height to `60vh`. The status overlay (B4) is the `#status` element. B3 and B4 share this one root.

**B5:** `NumberInput` renders a raw `<input type="number">`. On Android System WebView a focused number input shows a native focus ring / spin-button artifact; no `outline: none` / `-webkit-appearance: none` is applied. The teal dot is almost certainly that native indicator bleeding through.

**B6:** Cells lay out in a flex-wrap row with `gap: GAP`; each `cell` View has `width: TILE` and contains a `TouchableOpacity`. No `hitSlop`/`pointerEvents` appears in source. A gap tap at x≈525px routing to Tip Splitter is unexplained from static read — may be a hit area extending past visual bounds or a physical/logical pixel mismatch in the report.

**B7:** The ScrollView `contentContainerStyle` has no `minHeight`/`flexGrow`. With one row of cards the content is short while the `flex: 1` root fills the device, leaving ~75% empty. Cosmetic; no empty-state/scroll affordance.

**B8:** `COPY.createBody` in `copy.ts` contains the literal `'Coming soon.'`. `showCreate` calls `Alert.alert(COPY.createTitle, COPY.createBody, …)`; a one-line edit.

**B9:** `HomeScreen` imports `SafeAreaView` from `react-native` (not safe-area-context); on Android 15+ edge-to-edge it injects no top inset. `App.tsx` has `SafeAreaProvider` but passes no inset to children; `MiniAppView` has no safe-area handling (bare `View flex:1`).

## Constraints and invariants

- **Never touch** `src/runtime/web/neutralize.js`, `resolver.js`, `probes.js`, `loader.js`, or the CSP string in `build/assemble.mjs` — the three isolation legs (spike2-findings, decision #35). `npm run invariants` must stay green.
- **Never add** `'unsafe-eval'`, `blob:`, or `data:` to `script-src` (`LOCKED_CSP` in `build/assemble.mjs`).
- **Any change to `build/assemble.mjs` or `build/build.mjs` requires `npm run build`** to regenerate `src/runtime/generated/*` and `build/generated/*`. Never hand-edit generated files.
- The `initial: 'tip-splitter'` fallback only matters when no `deliverBySource` lands; changing it does not fix B1 alone.
- The `deliverBySource → control → injectJavaScript` path must preserve the realm nonce handshake and `generation` counter ordering (reinject sets GEN, recreates iframe, waits for `ready` before delivering).
- B9 `SafeAreaView` swap needs `SafeAreaProvider` as an ancestor — already present in `App.tsx`.
- `copy.ts` is guarded by `product-verbs.test.ts` (no git/mechanism vocabulary); removing "Coming soon." is safe — verify the test doesn't assert on it.

## Integration points

- **B1:** `MiniAppView.tsx` — add `onLoadEnd` on `<WebView>` that calls `deliverBySource` (move it out of `useEffect`), or store pending args in a ref and fire on WebView load. `deliverBySource` signature unchanged; only call-site timing changes.
- **B2:** `fixtures/tip-splitter.app.tsx` — `setBill(0)→setBill(100)`, `setPeople(1)→setPeople(4)`; then `npm run build`.
- **B3 & B4:** `build/build.mjs` — `showDiagnostics: true → false`; then `npm run build` (collapses iframe to 100%, removes `#status`).
- **B5:** `src/sdk/index.tsx` `NumberInput` style — add `outline:'none'` / `-webkit-appearance:'none'`; SDK change requires `npm run build`.
- **B6:** `HomeScreen.tsx` — verify/clip cell hit areas (`pointerEvents`, hitSlop); outer ScrollView has no `onPress`.
- **B7:** `HomeScreen.tsx` `styles.grid` — cosmetic; optional empty-state CTA.
- **B8:** `src/host/launcher/copy.ts` — edit `createBody`.
- **B9:** `HomeScreen.tsx` import source → `react-native-safe-area-context` with `edges={['top']}`, or wrap `<LauncherRoot />` in `App.tsx`. Note `MiniAppView` also renders behind the status bar.

## Suggested chain grouping (planner decides)

- **Build-output bugs (require `npm run build`):** B1, B2, B3/B4, B5 — batching avoids multiple build cycles, but B1 (host TS, no build) vs the fixture/SDK/build-config bugs differ in layer; planner may split B1 out.
- **Pure RN UI bugs (no build):** B6, B7, B8, B9 — touch only RN component files.

## Risks and unknowns

- **B1:** `onLoadEnd` should fire before the iframe `ready` postMessage so `reinject` lands first — I did NOT verify this ordering on Android System WebView in practice.
- **B5:** I did NOT confirm the exact DOM element; `::-webkit-inner-spin-button` is the likeliest culprit. Did not verify it persists after the B3/B4 layout change.
- **B6:** I did NOT find a `hitSlop`/`pressRetentionOffset`; the gap-tap routing is unexplained from static read — may be a coordinate-mapping artifact in the report.
- **B7:** No product decision found on home empty-state; did not read `docs/decisions.md` for one.
- **Invariant suite:** B3/B4 changes outer HTML; the suite generates pages from `runtime-artifacts.json` (parts+bundles), not RUNTIME_HTML, so it should be unaffected — NOT verified against the page-generation code.

## Open questions for the planner

1. **B1 fix:** `onLoadEnd`-driven `deliverBySource`, or a "pending delivery" pull in `useMiniAppHost` once the realm is ready?
2. **B9 scope:** fix in `HomeScreen.tsx` (component) or `App.tsx` (global wrapper)? `MiniAppView` also needs it.
3. **B8 product call:** hide the "+" card until the feature ships, or just change the copy? Not resolvable from code.
4. **`showDiagnostics: false` permanence:** unconditional, or a build-mode/env flag? It removes the on-screen probe JSON that decisions.md calls the source of truth (logcat truncates at 4 KB).
