# Research digest: can navigation depth use a specific `postMessage` target origin under Whim's opaque-origin iframe contract?

## Relevant files

- `docs/capabilities.md` — capability map; navigation points to the archived `sdk-navigation` delta and system-back behavior to `mini-app-back-navigation`.
- `docs/decisions.md` (§35, §37) and `docs/spike2-findings.md` — settled containment model and the constraint that the loader/SDK has no capability stronger than one-way `parent.postMessage`.
- `openspec/specs/sandbox-isolation/spec.md` — the bundle cannot obtain a usable parent document/native handle.
- `openspec/specs/mini-app-back-navigation/spec.md` — navigation depth is an untrusted hint, never exit authority.
- `openspec/changes/sdk-navigation/specs/sdk-navigation/spec.md` and `design.md` — the nav frame’s exact shape and its intentional use of the existing transport.
- `src/sdk/navigation.tsx` — `NavRoot` emits `__whimNavDepth` at every stack-depth change; line 110 uses `parent.postMessage(..., '*')`.
- `src/runtime/web/loader.js` — documents the nav seam and uses the same parent transport for loader frames.
- `src/runtime/web/syscall.js` — equivalent iframe-to-parent transport, already annotated `NOSONAR` because the sandboxed srcdoc channel is opaque.
- `build/assemble.mjs` — creates `iframe sandbox="allow-scripts"` with `srcdoc`, source-verifies `__whimNavDepth` against that exact iframe window, then relays a host-stamped generation.
- `src/host/launcher/MiniAppView.tsx` — loads the outer runtime with `WebView source={{ html: host.runtimeHtml }}` and declares no stable/base URL origin.
- `src/sdk/test/navigation.acceptance.tsx` — current SDK contract test; its fake `postMessage` captures only the message, not the target origin.

## Current behavior

`NavRoot` serializes `{ __whimNavDepth: true, depth, generation }` and posts it to its direct
parent. The outer runtime accepts it only when `event.source` is its current iframe’s
`contentWindow`; it ignores the bundle-provided generation and stamps its own generation before
the RN host consumes the hint. The back policy can always exit, so a forged/deep report has no
authority beyond mini-app back UX.

The receiver of this call is the *outer runtime page*, not the sandboxed iframe. A specific
`targetOrigin` therefore must be that outer page’s serialized origin. The iframe is deliberately
opaque (`sandbox="allow-scripts"` without `allow-same-origin`) and cannot read the parent’s
location/origin. Its own `location.origin` is not a safe substitute: it describes the child’s
opaque origin, not the receiver. The outer runtime is supplied as inline WebView HTML with no
configured stable URL/base origin, so this repository does not establish a concrete origin string
that the child can safely target. The outer page itself uses `'*'` for every parent↔iframe frame.

## Constraints and invariants

- Keep the three containment legs unchanged: opaque sandbox, locked CSP (no widening), and the
  window-level strip (#35/#37; `docs/spike2-findings.md`).
- Do not expose a parent document/native handle or a capability stronger than `parent.postMessage`.
- `event.source === iframe.contentWindow` is the authority check for this iframe→outer-page
  message; origin is not the authority signal in the opaque-origin design.
- Nav depth is deliberately unauthenticated data. It must remain a hint and the host-owned
  guaranteed-exit policy must remain decisive.
- Do not replace `'*'` with `location.origin`, `'null'`, or a guessed URL: none identifies the
  receiver under this contract and an incorrect target silently drops navigation-depth reports.

## Integration points

- The finding is isolated to `src/sdk/navigation.tsx`’s depth-emission effect.
- `build/assemble.mjs` is the receiver/source-verifier; changing it or `MiniAppView` to establish
  a stable outer origin would be a separate runtime/WebView-origin design change, not an SDK-only
  remediation.
- The closest established finding disposition is the explanatory `NOSONAR` on the equivalent
  `src/runtime/web/syscall.js` transport.

## Risks and unknowns

- I did not verify the Android System WebView’s effective origin for `source={{html}}` on-device.
  There is no configured origin in the repository; if the outer document is opaque/synthetic,
  wildcard is the only interoperable target-origin form for that receiver. If it is non-opaque,
  an exact value still cannot be derived by the child without a new host-to-child configuration
  contract.
- Supplying a host-selected origin through the init frame would disclose only a string, but it
  would create a new cross-layer origin contract shared with untrusted bundle code. It must not be
  added merely to placate the analyzer, and cannot be considered safe until the outer origin is
  made stable and verified on the device.

## Open questions for the planner

- Recommended disposition: treat SonarCloud AZ9ciqsaZpP-TVNR4hrv as a context-specific false
  positive / accepted finding and document the opaque-srcdoc transport rationale (consistent with
  the existing syscall `NOSONAR`), rather than claim a specific origin that is unavailable.
- If a code change is nevertheless required, first run an Android probe that records the outer
  and iframe origins and proves a candidate exact target delivers nav-depth across realm reset.
  Extend `src/sdk/test/navigation.acceptance.tsx` to capture/assert the second `postMessage`
  argument only after that contract exists; retain outer-page source verification and the
  guaranteed-exit/back-policy acceptance coverage.
