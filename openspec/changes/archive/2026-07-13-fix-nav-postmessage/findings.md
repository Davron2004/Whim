# Findings — fix-nav-postmessage (mechanical lane)

Source: interactive session 2026-07-13 — SonarCloud finding on `src/sdk/navigation.tsx` plus a
transport-symmetry gap surfaced during the investigation. Research context:
`openspec/changes/fix-navigation-message-origin/research.md` (whim-harness folder, research only).

## Finding NAV-1 (single finding, one worker — both fixes are in the same file src/sdk/navigation.tsx and must not be split across parallel workers)

Context: SonarCloud flagged the `postMessage(..., '*')` in src/sdk/navigation.tsx (rule S2819,
finding AZ9ciqsaZpP-TVNR4hrv). Investigation (see
openspec/changes/fix-navigation-message-origin/research.md) concluded it is a context-specific
false positive: the sender is an opaque-origin sandboxed srcdoc iframe (sandbox="allow-scripts",
no allow-same-origin), the receiving outer runtime page is loaded via RN WebView source={{html}}
with no baseUrl so it has no expressible origin, and any non-'*' targetOrigin silently drops the
nav-depth frame. Auth is receiver-side: ev.source === iframe.contentWindow in build/assemble.mjs
plus host back-policy. Precedent: src/runtime/web/syscall.js:47 already carries
`// NOSONAR - sandboxed srcdoc iframe posts to an opaque parent channel.` for the identical
transport.

Fix 1 (non-behavioral, comment only): on the `'*'` targetOrigin line inside the depth-emission
effect in src/sdk/navigation.tsx (currently line 116), add a NOSONAR suppression mirroring the
syscall.js precedent, e.g.:

    '*', // NOSONAR - opaque sandboxed srcdoc iframe: the parent's origin is unrepresentable as a
    targetOrigin, and any non-'*' value silently drops the frame. Auth is receiver-side
    (ev.source + back-policy); the depth hint is unauthenticated by design (sdk-navigation spec).

Keep the runtime bytes' behavior identical. No test for this part — it is a comment (per repo
test-classification policy, a source-grep test here would be bloatware).

Fix 2 (behavioral, red-checkable): the `__whimNavBack` message listener in the same file (the
`onMessage` handler in NavRoot's first useEffect) accepts messages without verifying the sender,
unlike src/runtime/web/loader.js:212 and syscall.js which gate on `ev.source === window.parent`.
Add the same guard: ignore any message event whose `source` is not `window.parent`. This requires
extending the NavMessageEvent/NavigationWindow structural types in the file to carry `source` and
expose `parent` for identity comparison — keep the existing pattern of structural typing via
navigationWindow(), and note the comparison must be against the same `parent` object the
depth-emission effect posts to. Red-check: a test in src/sdk/test/navigation.acceptance.tsx
(extend the existing suite, run via `npm run sdk:test`) that dispatches a `__whimNavBack:true`
message whose `source` is NOT the parent window and asserts the nav stack does NOT pop (fails
before the guard, passes after), plus keep/verify the existing positive case (message with
source === parent still pops).

Constraints: do not touch build/assemble.mjs, the CSP, sandbox attributes, or any protected
harness file. After the SDK edit, regenerate build artifacts if the gate requires it (src/sdk is
a build input — `npm run build` regenerates src/runtime/generated/*; never edit generated files
by hand).
