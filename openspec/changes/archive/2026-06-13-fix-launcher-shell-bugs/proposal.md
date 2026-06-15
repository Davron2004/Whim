## Why

An exploratory ADB session on the release APK (`docs/bugs-2026-06-13.md`) surfaced nine defects in the launcher shell and mini-app view, including a CRITICAL routing bug (tapping any card opens Tip Splitter) and two dev-only surfaces (diagnostics panel, containment status bar) that must not ship. These break the core "tap a card → run that app" promise and make the build unpresentable.

## What Changes

- **B1 (CRITICAL):** The tapped app actually launches. `MiniAppView` delivers the selected bundle after the WebView is ready (via `onLoadEnd`) so `reinject({bundleSource})` lands before the iframe fires `ready` — instead of being silently dropped and falling through to the baked `initial: 'tip-splitter'` default.
- **B2:** Tip Splitter's Reset restores the real defaults (Bill 100 / Tip 20% / People 4), not 0 / 20 / 1.
- **B3 & B4:** Production builds hide the developer diagnostics panel and the `CONTAINED … probes` status bar — `showDiagnostics: false`. (Decision: unconditional `false` for the shipping build; on-device probe JSON stays reachable via logcat.)
- **B5:** The SDK `NumberInput` renders without a stray focus artifact (the teal dot) — reset the native outline / number-input appearance.
- **B6:** Taps register only within a card's visual bounds; a tap in the gap between cards does nothing.
- **B7:** The home screen no longer reads as broken with few apps — the grid area is given a deliberate layout/empty treatment instead of ~75% dead space.
- **B8:** The "+" card modal drops the **"Coming soon."** sentence. (Decision: keep the card as the create entry point; change copy only.)
- **B9:** App content respects the Android status-bar inset in edge-to-edge mode, on both the home screen and inside mini-apps — via a global `react-native-safe-area-context` top-edge wrapper in `App.tsx` plus `MiniAppView`.

Non-breaking. No new dependencies (`react-native-safe-area-context` is already present).

## Capabilities

### New Capabilities
- (none) — corrected behaviors attach to existing capabilities as ADDED requirement deltas.

### Modified Capabilities
- `app-launcher`: corrected app routing (B1), card-bounded touch targets (B6), honest home-screen layout (B7), no unshipped copy (B8), production diagnostics hidden (B3/B4), and status-bar-safe insets across the shell (B9). NOTE: this capability's base spec is not yet in `openspec/specs/` (the `launcher-shell` change is merged-but-un-archived), so deltas here are authored as **ADDED** requirements pinning the corrected behavior; base reconciliation happens when `launcher-shell` is archived.
- `sandbox-rendering`: the SDK `NumberInput` renders cleanly with no stray focus/spin-button artifact (B5).

## Impact

- **Code:** `src/host/launcher/{MiniAppView.tsx, HomeScreen.tsx, copy.ts}`, `App.tsx`, `src/sdk/index.tsx`, `fixtures/tip-splitter.app.tsx`, `build/build.mjs`. Anything under `build/` or `src/sdk/` requires `npm run build` to regenerate `src/runtime/generated/*` and `build/generated/*`.
- **Off-limits:** `src/runtime/web/{neutralize,resolver,probes,loader}.js` and the locked CSP in `build/assemble.mjs` — the sandbox-isolation legs (decision #35). The `npm run invariants` suite must stay green; no fix here should need to touch containment.
- **B2** is a fix to the Tip Splitter demo fixture (example content), carried as a task rather than a capability requirement.
