# Plan — fix-nav-postmessage

- [x] NAV-1 — NOSONAR on nav-depth `'*'` targetOrigin + `event.source` guard on `__whimNavBack` listener (merged f3a39d6, regate-pass)

## DONE spec — NAV-1

### Severity
low — the missing `event.source` guard is a transport-symmetry/defense-in-depth gap, not an
exploitable escalation: the only other realm occupant that could post to the iframe window is the
bundle itself, which can already pop the stack via `nav.back()`; Fix 1 is a comment.

### Testability class
- Fix 1 (NOSONAR comment on the `'*'` targetOrigin): **structural-no-test** — comment-only, zero
  behavior change, no test per repo test-classification policy.
- Fix 2 (source guard in the `__whimNavBack` listener): **behavioral** — red-checkable via a
  negative message-event test.

### Fix sketch

Reconciliation (HEAD = 7dbb5d0): both defects exist. `src/sdk/navigation.tsx:116` is a bare
`'*',` with no NOSONAR; the `onMessage` handler (lines 81–99) starts with
`typeof event.data !== 'string'` and performs no `event.source` check.

**Fix 1 — comment only, at `src/sdk/navigation.tsx:116`** (inside the depth-emission effect,
second `React.useEffect`). Mirror `src/runtime/web/syscall.js:47`
(`// NOSONAR - sandboxed srcdoc iframe posts to an opaque parent channel.`), adapted:

    '*', // NOSONAR - opaque sandboxed srcdoc iframe: the parent's origin is unrepresentable as a
    // targetOrigin and any non-'*' value silently drops the frame; auth is receiver-side (ev.source).

Runtime bytes and behavior identical; only a comment is added.

**Fix 2 — sender guard in `onMessage`.**
1. Extend `NavMessageEvent` to carry the sender: `source?: unknown`. `unknown` is right: identity
   comparison only; TS permits `===` between `unknown` and an object type, no cast needed.
2. No change to `NavigationWindow` required — `parent` is already exposed; the guard compares
   identity against the SAME `navigationWindow().parent` object the depth effect posts to. Do NOT
   add methods to `parent`.
3. Guard as the FIRST line of `onMessage` (mirrors `src/runtime/web/loader.js:212`):
   `if (event.source !== navigationWindow().parent) return;` with a brief comment citing the
   loader.js/syscall.js host-channel-only precedent.

Production safety: the only real sender of `__whimNavBack` is `build/assemble.mjs:166` (`navBack`,
outer page → iframe); inside the iframe that event's `source` IS `window.parent`. The guard cannot
break production. Nothing else dispatches `__whimNavBack` into the iframe.

CRITICAL test-compat: existing fakes in `src/sdk/test/navigation.acceptance.tsx` dispatch
`listener({ data: ... })` with NO `source` (lines ~107–164) and `MessageListener` (line 7) is
`(event: { data: unknown }) => void`. With the guard, `undefined !== testWindow.parent` would fail
the existing positive assertions. The fix MUST, in the same edit:
- Widen `MessageListener` to `(event: { data: unknown; source?: unknown }) => void`.
- Add `source: testWindow.parent` to every dispatch meant to be accepted: the positive pops
  (~109, ~135), the at-root no-op (~162), and the malformed-frame batch (~119–128) so those keep
  testing frame-shape rejection rather than being masked by the source guard.

Build/generated files: `src/sdk` is a build input, but `src/runtime/generated/` and
`build/generated/` are gitignored and uncommitted — regeneration is the gate's concern; no
generated files in the allowlist. Never edit generated files by hand.

### Test
- File: `src/sdk/test/navigation.acceptance.tsx` (extend in place). Command: `npm run sdk:test`.
- Negative: at depth ≥ 1, dispatch `{ data: JSON.stringify({ __whimNavBack: true }), source: <not
  the parent> }` (e.g. `testWindow` or `{}`; optionally also a no-`source` dispatch) → stack must
  NOT pop (rendered text unchanged, no new depth frame).
- Positive cases updated to carry `source: testWindow.parent` must still pop.
- Expected red-without-fix: at HEAD the handler ignores `source`, so the wrong-source dispatch
  POPS the stack and the negative assertion FAILS; passes only with the guard.

### File allowlist
```
src/sdk/navigation.tsx
src/sdk/test/navigation.acceptance.tsx
```

### EVIDENCE
```
## src/sdk/navigation.tsx
        generation: runtimeWindow.__whimGeneration,
      }),
      '*',
    );

## src/sdk/navigation.tsx
    const onMessage = (event: NavMessageEvent): void => {
      if (typeof event.data !== 'string') return;
```
