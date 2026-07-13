# Tasks: sdk-navigation

## 1. SDK nav primitive

- [ ] 1.1 Add the module-scope nav emitter and the `nav` object (`navigate(screenName)`, `back()`) to `src/sdk/index.tsx` — additive barrel export, isolated from the `sdk-charts` export region (design D1/D2)
- [ ] 1.2 Implement the SDK-owned nav root component: `useState`-backed stack initialized to `[spec.initial]`, renders `spec.screens[top]`, subscribes to the emitter on mount (design D2)
- [ ] 1.3 Implement depth-hint emission: post `{__whimNavDepth:true, depth, generation: window.__whimGeneration}` via `parent.postMessage` on every stack-length change (design D3; shape verbatim from `NavDepthFrame`, type-only import if referenced)
- [ ] 1.4 Implement `__whimNavBack` consumption: in-realm `message` listener pops one entry; tolerate stray frames at depth 0 as a no-op (design D3)
- [ ] 1.5 Implement unknown-target handling: `navigate` to an undeclared screen is a no-op with a console warning naming the target and the declared screens (design D4)
- [ ] 1.6 Node acceptance tests for the nav module: stack semantics (push/pop/duplicate push/no-op back at 0), depth-hint emission on every change, navBack pop, unknown-target warn+no-op — red-check at least the depth-emission test (verify it fails against the pre-change SDK)

## 2. Runtime loader mount path

- [ ] 2.1 Change `window.__whimAfterBundle` in `src/runtime/web/loader.js` to mount the SDK nav root (`render(createElement(NavRoot, {spec}))`) instead of the fixed `spec.screens[spec.initial]`; keep the `mountedGen` guard and `delivery`/`paint` semantics untouched (design D2); minimal diff — no other loader changes
- [ ] 2.2 Update the loader nav-seam anchor comment (lines 43–54) to reflect that the SDK now emits/consumes the frames; keep the frame-shape documentation verbatim
- [ ] 2.3 `npm run build` to regenerate `src/runtime/generated/*` and `build/generated/*` (never hand-edit); confirm the source-map round-trip check passes
- [ ] 2.4 Run `npm run invariants` and `npm run bridge:invariants` against the fresh build — all probes green, zero modifications under `invariants/` or `build/`

## 3. Static-check shapes row

- [ ] 3.1 Add `{object: 'nav', method: 'navigate', argIndex: 0}` to `NAV_CALL_SHAPES` in `checks/contract.ts` (no row for `back` — design D4)
- [ ] 3.2 Update the checks acceptance suite: dangling-target and non-literal-target scenarios now exercised via the shipped row (keep or retire the test-injected row per what the suite's negative control needs); red-check the dangling-target case against the empty-table baseline

## 4. Specs, docs, and end-to-end verification

- [ ] 4.1 Add the `sdk-navigation` row to `docs/capabilities.md` pointing at the new spec; append the decision-log entry for nav landing (recovered #3 scope, `nav` object over hook, no params in v1)
- [ ] 4.2 Author a multi-screen fixture app (list → detail via `nav.navigate`, back via `nav.back`) under `fixtures/`, regenerate, and verify end-to-end in headless Chromium: navigate → depth-1 frame observed, navBack → initial screen renders (this fixture doubles as synthetic-run-harness test material)
- [ ] 4.3 Run `scripts/gate.sh`; resolve anything red
