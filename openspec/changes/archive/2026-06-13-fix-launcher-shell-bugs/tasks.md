## 1. Host delivery timing (B1, CRITICAL)

- [x] 1.1 In `src/host/launcher/MiniAppView.tsx`, move the `deliverBySource` call out of the no-dep mount `useEffect` and invoke it from the WebView's `onLoadEnd` so injection runs after the host page has loaded
- [x] 1.2 Confirm `reinject({bundleSource})` lands before the iframe fires `ready`, preserving the nonce handshake and `generation` ordering in `useMiniAppHost.ts` / `deliver.ts` (no signature changes)
- [x] 1.3 Add a regression assertion to the launcher delivery verification that the selected source actually renders (the delivered `appName`/bytes come from the host source, not the baked `initial` default)
- [x] 1.4 Run `npm run launcher:test` AND `npm run build && npm run launcher:deliver-verify` (the gate does not cover these), then `./scripts/gate.sh`

## 2. Generated-output fixes (B2, B3, B4, B5)

- [x] 2.1 `fixtures/tip-splitter.app.tsx`: Reset restores Bill 100 / Tip 20% / People 4 (B2)
- [x] 2.2 `build/build.mjs`: pass `showDiagnostics: false` to the `buildOuterHtml` call (B3 & B4)
- [x] 2.3 `src/sdk/index.tsx`: reset the `NumberInput` native appearance (`outline: none`, suppress the spin-button) so no stray focus dot leaks (B5)
- [x] 2.4 Run `npm run build` to regenerate `src/runtime/generated/*` and `build/generated/*` (never hand-edit generated files)
- [x] 2.5 Run `npm run invariants` to confirm the containment suite is still green, then `./scripts/gate.sh`

## 3. Launcher UI fixes (B6, B7, B8, B9)

- [x] 3.1 `src/host/launcher/copy.ts`: remove the "Coming soon." sentence from `createBody` (B8)
- [x] 3.2 `src/host/launcher/HomeScreen.tsx`: bound each card's touch target to its visual area so a tap in the gap between cards launches nothing (B6)
- [x] 3.3 `src/host/launcher/HomeScreen.tsx`: give the area below the grid an honest layout/empty treatment instead of ~75% dead space (B7)
- [x] 3.4 `App.tsx`: wrap the launcher root in `SafeAreaView edges={['top']}` from `react-native-safe-area-context`; `HomeScreen.tsx` stops importing `SafeAreaView` from `react-native` (B9)
- [x] 3.5 `src/host/launcher/MiniAppView.tsx`: apply the top safe-area inset to the mini-app shell (B9)
- [x] 3.6 Run `npm run launcher:test`, then `./scripts/gate.sh`
