# chain-7 dispatch block: realm-runtime-and-sdk (tasks 7.1–7.5)

Read: `specs/sandbox-rendering/spec.md` (whole), `specs/app-launcher/spec.md` §"The host tells the realm how much
of the bottom the orb covers" and §"A post-paint render failure shows the failure screen", `design.md` §D3 (the
loader paragraph only), §D4, §D5, and `research.md` §"Constraints and invariants" (trusted frames, realm reset =
recreate, #11/#13).

Decisions made for the implementer:
1. **Focus (7.1).** In `loader.js`, on `focusin` of an editable element (input, textarea, contenteditable),
   scroll it into view (`block: 'nearest'`). When the viewport resizes while one has focus (`visualViewport`
   resize, falling back to window resize), scroll it again after layout settles (one rAF). Loader-owned
   listeners only: no new global the bundle can reach, no CSP change.
2. **Render failures (7.2).** Report render errors that escape the app from loader-owned code that generated code
   can't reach or disable: React 19's `createRoot(..., { onUncaughtError })` or a runtime root boundary,
   whichever fits how `loader.js` mounts today. Each one posts the existing nonce-authenticated error frame with
   `where: 'render'`, once per realm. A boundary inside the app that catches its own error keeps working. On the
   host, `isFatalErrorWhere` gains `'render'` and only trusted frames count, so a `render` frame reaches the
   existing FailureScreen and realm recreate. A pre-paint render error must produce exactly one failure path,
   never two screens or a double report. Tests: trusted `render` → FailureScreen; untrusted → ignored.
3. **Inset (7.3).** A pure host function (in a non-RN sibling, Node-tested) computes `chromeInsetBottom = ORB_SIZE
   + the orb's bottom margin + bottom safe-area inset`, rounds it and clamps it to 0–200 (non-finite → 0). It's
   sent in the theme payload on every mount. `loader.js` sanitizes again and never trusts the host value blindly.
4. **SDK (7.4).** `Screen` adds the inset to its scrollable content's bottom padding. The value stays inside SDK
   internals: no public hook, token or theme accessor may expose it (check what `useTheme`-style APIs return, and
   filter it out). Test with and without an inset in `sdk:test`, and pin that the public theme surface doesn't
   include it.
5. **7.5.** `npm run build`, then `npm run invariants` and `npm run bridge:invariants`. Try them in your
   worktree. If Chromium or module resolution fails there for environment reasons, record ENV and the
   orchestrator runs them from the main tree after merge. `invariants/` is owner-authored: never edit it. An
   invariant that fails because of your change is a class-B stop. Never hand-edit `src/runtime/generated/*`.

Gate: `./scripts/gate.sh` to FAST GATE PASSED. Red-check the inset clamp and the trusted-only rule against a
weaker variant each, naming the failing tests. End with HARNESS FEEDBACK (docs/harness-feedback/README.md).
