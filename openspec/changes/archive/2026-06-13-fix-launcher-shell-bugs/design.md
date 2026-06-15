## Context

Nine defects from `docs/bugs-2026-06-13.md`, terrain-mapped in `research.md`. They split cleanly by layer: a delivery-timing bug in the host (B1), generated-output bugs that require `npm run build` (B2 fixture, B3/B4 build config, B5 SDK), and pure React-Native UI bugs (B6, B7, B8, B9). The sandbox-isolation legs and locked CSP are off-limits (decision #35); `research.md` confirms no fix needs to touch them.

## Goals / Non-Goals

- **Goals:** the tapped app launches (B1); no dev-only surfaces ship (B3/B4); content is status-bar-safe (B9); reset/copy/input/touch/layout defects (B2, B5, B6, B7, B8) corrected with the smallest diff each.
- **Non-Goals:** no redesign of the launcher; no change to the delivery protocol's nonce handshake or generation counter; no new empty-state *feature* for B7 beyond removing the "looks broken" impression; no build-mode/env flag system for diagnostics (unconditional `false`).

## Decisions

- **B1 — deliver on `onLoadEnd`, not on mount.** `MiniAppView` moves the `deliverBySource` call out of the no-dep `useEffect` and into the WebView's `onLoadEnd` callback, so `injectJavaScript` runs after the host page exists and `reinject({bundleSource})` lands before the iframe fires `ready`. Rejected: a "pending delivery" pull inside `useMiniAppHost` — more moving parts for the same ordering guarantee. `deliverBySource`'s signature is unchanged. (Risk flagged in research: `onLoadEnd`-before-`ready` ordering is not yet verified on-device — see Risks.)
- **B3/B4 — `showDiagnostics: false` in `build/build.mjs`.** Single explicit argument flip; `npm run build` regenerates `runtime-html.ts` (iframe collapses to full height, `#status` and the diagnostics `<pre>` blocks drop out). Unconditional, per the proposal decision.
- **B9 — global top-edge wrapper.** Wrap the launcher root in `App.tsx` with `SafeAreaView edges={['top']}` from `react-native-safe-area-context` (provider already present), and apply the same inset inside `MiniAppView` (which today is a bare `View`). `HomeScreen` stops importing `SafeAreaView` from `react-native`.
- **B5 — style reset in the SDK.** Add `outline:'none'` + `-webkit-appearance:'none'` (and suppress the inner spin button) to `NumberInput`'s rendered input. SDK change → `npm run build`.
- **B6 — clip the hit area.** Constrain the card's touchable to its visual bounds (remove any implicit hit expansion; ensure the gap container is `pointerEvents="box-none"` / not itself pressable).
- **B2 — fixture defaults.** `setBill(0)→100`, `setPeople(1)→4` in `fixtures/tip-splitter.app.tsx`; `npm run build` rebakes the bundle.
- **B7/B8 — RN-only.** Minimal layout/empty treatment for the grid; remove "Coming soon." from `copy.ts`.

## Risks / Trade-offs

- **B1 ordering not yet on-device-verified** → the regression test asserts the corrected `appName`/channel-(b) generation; if `onLoadEnd` proves to fire after `ready` on real Android System WebView, fall back to the pending-delivery-pull approach (class-B stop).
- **Generated-file churn** → every `build/`, `src/sdk/`, and `fixtures/` edit must be followed by `npm run build`; forgetting it leaves generated output stale. The gate's build step catches this. → Mitigation: group all build-triggering edits so the rebuild runs once per chain.
- **`showDiagnostics: false` removes the on-screen probe JSON** (decisions.md calls it the source of truth vs. 4 KB logcat truncation). Trade-off accepted for the shipping build; dev builds can flip it back by hand.
- **B6/B7 are partly unconfirmed from static read** (research: no `hitSlop` found; gap-tap routing unexplained) → implementer must confirm the actual cause before coding, and stop class-B if the cause isn't in the named files.

## Migration Plan

No data/schema migration. Ship in `dev/v1`. Rollback = revert the change; no persisted state is affected.

## Open Questions

- B1: is `onLoadEnd` reliably before the iframe `ready` postMessage on-device? (Verified by the B1 regression assertion + an on-device smoke check, not at proposal time.)
- B7: is a true empty-state CTA wanted later, or is "not visibly broken" sufficient for now? (Treated as sufficient here.)
