# Dispatch log: fix-launcher-shell-bugs

Dispatcher: Opus. Implementers: Sonnet, one chain at a time. Done = `./scripts/gate.sh` exit 0 (now includes `launcher:test` + `launcher:deliver-verify`).

## Pre-dispatch
- Baseline gate was RED on a clean tree (pre-existing from the un-archived launcher-shell merge): 7 stale `no-unused-disable` lint directives + `src/host/launcher/index.ts` unregistered in knip. Fixed: lint auto-fixed (dispatcher); `knip.json` entry added (human). Baseline now GATE PASSED before any chain ran.

## Chains
| chain | tasks | status |
|---|---|---|
| chain-1 host-delivery (B1) | 1.1–1.4 | ✅ complete, GATE PASS |
| chain-2 generated-output (B2,B3,B4,B5) | 2.1–2.5 | ✅ complete, GATE PASS (1×A) |
| chain-3 launcher-ui (B6,B7,B8,B9) | 3.1–3.6 | ✅ complete, GATE PASS (1×A) |

### chain-1 — complete (GATE PASS, no deviations)
- B1 fix: `MiniAppView` `useEffect([])` → WebView `onLoadEnd` callback; `deliverBySource` fires after the host page loads, so `reinject({bundleSource})` (which calls `makeIframe()` → fresh iframe lifecycle) lands before the iframe's `ready` postMessage.
- Regression: deliver-by-source desktop verification now injects `water-counter` by source against a baked map defaulting to `tip-splitter`, asserts Water Counter renders (not the default). 3 Chromium scenarios green.
- Files: MiniAppView.tsx, test/deliver-by-source.desktop.mjs. No signature changes to useMiniAppHost/deliver.

### chain-2 — complete (GATE PASS)
- B2: tip-splitter Reset → setBill(100)/setPeople(4) (setTipPct(20) was already right).
- B3/B4: `build/build.mjs` → `showDiagnostics: false`; diagnostics panel + `#status` overlay gone, iframe full-height.
- B5: NumberInput style reset — `outline:none` + `WebkitAppearance:none`.
- DEVIATION [A]: also added `MozAppearance:'textfield'` to cover Gecko spin-button. Within spec; no sandbox/CSP widening. (1st class-A; not yet a tripwire candidate.)
- Regenerated src/runtime/generated/* + build/generated/* via `npm run build`; invariants stayed green.

### chain-3 — complete (GATE PASS)
- B8: "Coming soon." removed from copy.ts (product-verbs test green).
- B6: `.cell` `alignSelf:'flex-start'` stops row-height stretch pushing the touch area past the visual card bounds.
- B7: `.grid` `flexGrow:1`/`alignContent:'flex-start'` — no dead-space stretch.
- B9: `App.tsx` wraps LauncherRoot in `SafeAreaView edges={['top']}` (context); `HomeScreen` drops bare RN SafeAreaView; `MiniAppView` adds `useSafeAreaInsets().top` padding (preserving chain-1's onLoadEnd).
- DEVIATION [A]: inline style → `StyleSheet.create` in App.tsx to satisfy `react-native/no-inline-styles`. (2nd class-A, different pattern from chain-2's — NOT a repeated pattern, no tripwire candidate.)

## Close-out
- Full-tree `./scripts/gate.sh`: GATE PASSED. Code diff: 10 files, +67/−29.
- Reviewer verdict: **findings** (no report-mismatch, no high-severity). Resolution:
  - `openspec/config.yaml` (`schema: spec-driven → whim-harness`) flagged as undisclosed — it is the DISPATCHER/PROPOSER's schema-default flip (the harness fix that closed the 3-of-6 gap), not implementer drift. Recorded here for honesty.
  - Whitespace-only residue in test/acceptance.ts + test/harness.ts (from the baseline `eslint --fix`) — CLEANED (directive lines fully deleted); gate re-run green.
  - DevProbeScreen possible double-top-inset — dev-only; RN `SafeAreaView` applies no Android top inset, so it does not manifest on the Android-first target. DEFERRED low finding, not fixed (out of bug-report scope).
- Spec conformance: conforms across B1–B9. CAVEAT (carried from research + reviewer): the B1 desktop Chromium test proves the channel-(b) by-source delivery path, but cannot reproduce the original RN-native `injectJavaScript`-before-load timing race — **B1 still needs an on-device smoke check** (tap Water Counter on the emulator, confirm it renders Water Counter + diagnostics gone).
- Nothing committed; all changes are in the working tree for the user's review.
