# Research digest: what would adding a v1 SDK navigation primitive touch?

## Relevant files
- `docs/capabilities.md` — capability index; no `sdk-navigation` (or any nav) row exists yet — this change would add one, pointing at a new spec.
- `src/sdk/index.tsx` — `defineApp`/`AppSpec`, `ScreenComponent`, existing hooks (`interval`), the SDK barrel and its two hard contracts (tokens-not-values, one-way transport only).
- `src/sdk/events.ts` — `emitUiEvent`, the one-way `postMessage` transport shape nav-depth hints would reuse.
- `src/runtime/web/loader.js` — mount path (`spec.screens[spec.initial]`), the nav-seam anchor comment (quoted below), the transport stub.
- `src/host/bridge/contract.ts` — `classifyFrame`, `NavDepthFrame`/`NavBackFrame` types (as-built, verbatim below), `navBackFrame()`.
- `src/host/launcher/back-policy.ts` + `test/back-policy.spec.md` — the pure guaranteed-exit reducer already built against this seam.
- `src/host/launcher/useMiniAppHost.ts` — host-side `nav-depth` consumption, system-back wiring (`BackHandler`), `window.__whimControl.navBack()` call site.
- `build/assemble.mjs` — outer-page relay: source-verifies `__whimNavDepth`, stamps `generation`, defines `__whimControl.navBack`.
- `checks/contract.ts` (`NavCallShape`, `NAV_CALL_SHAPES`) + `checks/passes/screens.ts` — the screen-graph pass and its empty shapes table.
- `checks/test/acceptance.ts` (line ~365) — proves the shapes-table mechanism today via a test-injected row.
- `openspec/specs/mini-app-back-navigation/spec.md`, `sdk-design-system/spec.md`, `static-checks/spec.md` — governing specs (read in full).
- `docs/decisions.md` #11, #13, #35, #37, #43b — cited invariants.
- `docs/spike2-findings.md` — the 5 carry-forward constraints.

## Current behavior
`AppSpec.screens` is `Record<string, ScreenComponent>`; `defineApp` is a pure identity function returning the spec — it mounts nothing. The loader (`window.__whimAfterBundle`) mounts exactly `spec.screens[spec.initial]` once per generation (`mountedGen` guard), via `whimRoot.render(React.createElement(spec.screens[spec.initial]))` — there is no re-render/screen-switch machinery today; whichever screen name `initial` points to is the only one ever mounted. The SDK's only stateful hooks are `useState`/`useEffect`/`useRef` (raw React re-exports) and `interval` (a hook wrapping `setInterval`); no navigation hook or context exists. The one-way transport (`emitUiEvent`, and the loader's `window.ReactNativeWebView.postMessage` stub) is the sole channel out of the iframe — `NavDepthFrame`/`NavBackFrame` are designed to ride the same pipe but nothing emits/listens for them inside the sandbox yet.

The host half (#5, `launcher-shell`) is fully built and wired: `useMiniAppHost.ts` listens for `kind:'nav-depth'` frames (relayed/stamped by `assemble.mjs`), feeds `BackPolicy.navDepth(depth, generation)`, and on Android system back calls `policy.current.backPress()` — `forward` posts `window.__whimControl.navBack()` into the iframe and arms a 400ms unhandled-press timer (`UNHANDLED_PRESS_WINDOW_MS`), `exit` tears the realm down. Since no SDK emits `__whimNavDepth`, depth is always 0, so every back press exits immediately (loader.js comment, quoted below, confirms this is intentional and adds no runtime behavior yet).

Static checks: `screenGraphPass` (`checks/passes/screens.ts`) always checks `initial in screens`; it additionally walks `object.method(stringLiteralArg)` call shapes matching rows in `NAV_CALL_SHAPES: readonly NavCallShape[]` (ships `[]` today — table-driven, proven only by a test-injected row in `acceptance.ts`).

## Constraints and invariants
- Loader nav-seam anchor comment, `src/runtime/web/loader.js` lines 43-54 (quoted in full — verbatim, load-bearing): the SDK emits `{__whimNavDepth:true, depth:<n>, generation: window.__whimGeneration}` on every depth change; host posts `{__whimNavBack:true}` into the realm on system back when depth>0; "No SDK nav exists yet, so nothing emits/consumes these in this change; depth is always 0 and back exits at the root. This block is the contract anchor only — it adds NO runtime behavior, keeping the iframe loader byte-stable for containment."
- `NavDepthFrame`/`NavBackFrame` (verbatim, `src/host/bridge/contract.ts`):
```
export interface NavDepthFrame {
  __whimNavDepth: true;
  depth: number;
  generation: number;
}
export interface NavBackFrame {
  __whimNavBack: true;
}
```
Both classify as `control` family in `classifyFrame` — NOT nonce-authenticated (spike2 F4: legitimate sender is the untrusted bundle itself, so no honest-sender property exists; authority lives entirely in host `back-policy.ts`).
- Depth reports are hints, never authority (mini-app-back-navigation spec, req "Navigation-depth reports are untrusted hints") — host MUST ignore stale-generation reports and MUST guarantee exit regardless of app cooperation (guaranteed-exit invariant, already implemented in `back-policy.ts`).
- Containment three legs (spike2 §security model, #35/#37): never widen CSP, never value-replace `Function`/`eval`, window-level strip stays non-configurable. A nav primitive is pure in-iframe React state — must not touch any of these legs or the transport (constraint #2: SDK holds no capability stronger than `parent.postMessage`).
- Only nonce-authenticated frames are trusted; nav-depth/nav-back are deliberately NOT nonce-authenticated by design (unlike `__whimHarness` control frames) — this is settled, not a gap to fix.
- Realm reset = recreate iframe, never re-inject (spike2 #5/T7) — any nav-stack state the SDK holds must be structurally torn down by iframe recreation, not by SDK-level cleanup logic (mirrors `interval`'s "no registry needed" pattern, decision #43/D2).
- SDK invariants: backend-agnostic — mini-apps see no DOM concept, only `screens`/components (#11); tokens not values (#13) — a nav primitive must not leak router internals as values; type-only re-exports cross the SDK↔engine seam (storage/bridge types are `import type` only) — any nav-related type shared with the host bridge (e.g. reusing `NavDepthFrame`) must stay type-only in the SDK-facing surface, mirroring the existing storage/cues pattern.
- Screen-graph static check: `initial` must name a declared `screens` key (already enforced); a future nav call's target must be a string literal naming a declared screen — non-literal targets are rejected outright (same conservative policy as computed global access, static-checks spec).
- `NavCallShape` row shape (verbatim, `checks/contract.ts`):
```
export interface NavCallShape {
  object: string;
  method: string;
  argIndex: number; // zero-based index of the target-screen argument
}
```

## Integration points
- `src/sdk/index.tsx` — new exports (e.g. a `navigate`/`goBack` pair or nav hook) would sit alongside `interval`/`useState` in the "State" or a new "Navigation" section; would need internal stack state (likely `useState`/`useRef`-backed, mount-scoped) and a listener for inbound `__whimNavBack` frames (the SDK-side counterpart the loader comment describes as not-yet-existing).
- `src/runtime/web/loader.js` — `window.__whimAfterBundle`'s single `whimRoot.render(...spec.screens[spec.initial])` call is the mount point that would need to become nav-stack-aware (current screen selection instead of a fixed `initial`); the message listener (`window.addEventListener('message', ...)`) is where an inbound `__whimNavBack` frame would need a handler routed to the SDK's nav state.
- `src/host/bridge/contract.ts` — `NavDepthFrame`/`NavBackFrame` types and `classifyFrame` already exist and need no change; `navBackFrame()` helper already exists host-side.
- `src/host/launcher/useMiniAppHost.ts` / `back-policy.ts` — already consume `nav-depth` and emit `navBack()`; no changes expected here per scope (host half is #5, already built).
- `checks/contract.ts` (`NAV_CALL_SHAPES`) and `checks/passes/screens.ts` — new rows (e.g. `{object:'nav', method:'navigate', argIndex:0}`, possibly a `goBack` row with no target arg) are a pure data-table addition; the pass logic is already generic over the table.
- `openspec/specs/` — no existing `sdk-navigation` spec; capability would need a new row in `docs/capabilities.md` and a new spec file, OR a delta added under `sdk-design-system` if the planner treats nav as part of that capability's surface (undecided — see below). `static-checks/spec.md`'s screen-graph requirement text already documents the future-table-update path, so a delta there is a data/row addition, not a requirement rewrite, unless the requirement wording needs updating to reflect a non-empty table.

## Risks and unknowns
- I did not verify `src/sdk/controls.tsx` or `src/sdk/surfaces.tsx` in detail — only confirmed via `index.tsx`'s re-export list that they exist and share the same barrel/event-emission pattern; a nav primitive likely doesn't touch them but I did not read their internals.
- I did not verify whether any in-flight `openspec/changes/*` proposal (other than `sdk-charts`) already stakes out SDK export budget/naming for navigation — worth a `Glob` of `openspec/changes/` if the planner needs it; I only checked `capabilities.md` and did not enumerate active changes.
- The exact shape a v1 `navigate(screenName)` call would take through `NAV_CALL_SHAPES` (e.g. one row vs. two for `navigate`/`goBack`, and whether `goBack` even needs a row since it takes no string-literal target) is undecided from code — the table only models calls with a literal target argument.
- I did not trace whether `window.__whimGeneration` (used in the loader's nav-depth payload per the anchor comment) is actually read anywhere besides the comment's prescription — the comment says the SDK "posts... generation: window.__whimGeneration" but since no SDK nav exists, this is unverified against a real implementation, only against the anchor's stated intent.

## Open questions for the planner
- Should the new capability get its own spec (`openspec/specs/sdk-navigation/spec.md` + a capabilities.md row) or land as a delta inside `sdk-design-system` (which already owns `Screen`/component-kit rendering)? Not decided in code or docs.
- Does `goBack()` need a `NAV_CALL_SHAPES` row at all, given the table only resolves string-literal *targets* and `goBack` has none?

## Reviewer-remediation digest (2026-07-13)

- The shipped screen-graph pass treated `NavCallShape.object` as a textual identifier. Valid
  `vc-sdk` aliases and namespace imports bypassed target validation, while unrelated local `nav`
  bindings false-positived. The existing lexical `resolvesToImport` helper is sufficient to bind
  direct, aliased, and namespace forms without widening checker infrastructure.
- `NavRoot` and `NavRootProps` were re-exported by the public SDK barrel, and the injector exposes
  that entire barrel through the object returned by exact `require('vc-sdk')`. This contradicted
  D2's loader-only claim and let a mini-app interfere with the singleton nav listener.
- The minimal gateable repair is two-stage: first extract navigation into an internal source module
  while retaining temporary compatibility re-exports; then apply one atomic HUMAN-BOOTSTRAP patch
  that imports the root directly in the injector, publishes it through a temporary frozen internal
  bootstrap property, has the loader capture and delete that property before delivery, and removes
  the public barrel exports. No SDK subpath becomes a runtime import.
- Closure assertions must prove `require('vc-sdk')` lacks the root, the bootstrap property is absent
  before bundle execution, production navBack still yields depth 0→1→0, and containment/full gates
  remain green. The append-only desktop-verification correction follows a passing remediation review.
## Reviewer-remediation follow-up: durable closure

- Shared binding resolution must predeclare each lexical scope before classifying reads; a one-pass declaration-order map misclassifies later-declared/hoisted `var` shadows. Direct, aliased, and namespace spellings each need a later-declaration regression while existing genuine-import positives remain green.
- The existing SDK acceptance/typecheck lane can make `NavRootProps` non-export durable with a used `@ts-expect-error` type reference. The existing production desktop-delivery verifier can inspect the built iframe for public/root-bootstrap absence and construct test-local missing, invalid, and undeletable bootstrap variants from generated runtime parts; no protected gate/build/invariant edit is required.
