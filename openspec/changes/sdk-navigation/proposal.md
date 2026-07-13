# Proposal: sdk-navigation

## Why

Multi-screen navigation was promised in the v1 roadmap (change #1's contract notes: "Navigation does not exist yet — built in #3 (`useNavigation`/`useRoute`)") but #3 shipped without it — the scope silently fell through the crack between #1's promise and #3's delivery, and it is not in the post-v1 backlog. The cost is concrete: roughly 3–5 of the 11 Tier-0 corpus apps are inherently multi-screen (workout log with history views, recipe box list+detail, packing templates), `AppSpec.screens` entries beyond `initial` are dead code no runtime path can ever reach, and the synthetic run harness (#10, proposed alongside this change) cannot do real screen-reachability traversal without it. The host half is already built and waiting: #5 shipped the complete nav seam (`NavDepthFrame`/`NavBackFrame`, `back-policy.ts` guaranteed-exit reducer, `assemble.mjs` relay) with depth hard-wired to 0.

## What Changes

- New sandbox-internal navigation primitive in `vc-sdk`: a stable `nav` object with `nav.navigate(screenName)` (push) and `nav.back()` (pop). **No params-passing in v1** — targets are string literals only; cross-screen state stays app-managed (module scope or storage), exactly as today.
- The runtime loader's mount path (`src/runtime/web/loader.js`) becomes nav-stack-aware: instead of rendering `spec.screens[spec.initial]` as a fixed one-shot, it mounts a nav-aware root that renders the top of the stack (initial screen at depth 0).
- The SDK emits `{__whimNavDepth:true, depth, generation}` on every stack change and consumes the host's `{__whimNavBack:true}` frame by popping one screen — filling in the sandbox half of the seam #5 anchored (loader.js anchor comment, lines 43–54).
- Android system back now pops instead of exiting when depth > 0 — no host code changes; `back-policy.ts` already implements this against the seam.
- The static-check screen-graph shapes table (`NAV_CALL_SHAPES` in `checks/contract.ts`) gains its first shipped row (`{object:'nav', method:'navigate', argIndex:0}`), so a dangling nav target (`nav.navigate('nonexistent')`) becomes a static error before any run. `nav.back()` takes no target and needs no row.
- Runtime behavior for an unknown target that survives static checking (non-literal path): no-op plus an SDK console warning — never a crash.
- `docs/capabilities.md` gains an `sdk-navigation` row pointing at the new spec.

## Capabilities

### New Capabilities
- `sdk-navigation`: the mini-app navigation surface — `nav.navigate`/`nav.back` semantics, stack model, depth-hint emission, `__whimNavBack` consumption, unknown-target behavior, and the containment posture (pure in-realm React state; no new authority beyond `parent.postMessage`).

### Modified Capabilities
- `static-checks`: the screen-graph requirement's shipped shapes table goes from empty to containing the `nav.navigate` row; the "Dangling nav target" scenario is now exercised by a shipped row rather than only a test-injected one. (The table mechanism itself is unchanged — this is the data update the spec explicitly anticipated.)

No delta for `mini-app-back-navigation`: its requirements ("depth reports are untrusted hints", guaranteed exit regardless of app cooperation) were written against this exact future and do not change. No delta for `sdk-design-system`: nav is a new capability, not a component-kit change.

## Impact

- **Code**: `src/sdk/index.tsx` (new `nav` export + nav-root internals), `src/runtime/web/loader.js` (nav-aware mount), `checks/contract.ts` (`NAV_CALL_SHAPES` row). `src/runtime/generated/*` and `build/generated/*` regenerate via `npm run build` (never hand-edited). No changes to `src/host/bridge/contract.ts` (frame types exist), `back-policy.ts`, `useMiniAppHost.ts`, or `build/assemble.mjs` (relay exists; `build/*` is agent-protected anyway).
- **Invariants**: the loader is part of the containment surface — `npm run build` + `npm run invariants` must stay green; the change adds no new frame kinds, touches no CSP, no global strip, no nonce path. Nav frames remain deliberately non-nonce-authenticated (settled design: depth is a hint, authority lives host-side).
- **Tests**: checks acceptance suite (shipped-row dangling-target case), a new SDK/runtime acceptance for stack semantics + depth emission + navBack consumption, existing launcher back-policy suite unchanged and must stay green.
- **Downstream**: `synthetic-run-harness` (proposed alongside) declares a dependency on this change for screen-reachability traversal; generation prompts/corpus apps can start using `nav.navigate` once this lands.
