# Dispatch log: sdk-design-system

## Pre-dispatch

- 2026-07-02: three researcher digests (SDK/runtime, launcher/persistence, openspec/constraints) condensed into research.md; proposal/design/tasks/chains/spec deltas written by the orchestrator; `openspec validate --all --strict` green on first run. Branch: `ui-design-system`.
- Owner waiver of the #44 corpus-need rule recorded in proposal.md; roadmap ledger note added for the launcher-theming scope.

## Chains

- chain-A (theme-core): COMPLETE — 3/3 tasks, DoD green (build/typecheck/lint). Gate.sh tripwire fired on the orchestrator's own uncommitted assemble.mjs edit (expected pinned-BASE behavior), cleared by commit 74ec0d7.
- chain-D (runtime-theme-delivery): COMPLETE — agent half 3/3 (loader global, deliverBySourceJs theme param + suite, useMiniAppHost threading); main-thread half: assemble.mjs pendingTheme → hostInit frame (74ec0d7), build.mjs style-gallery registration (9644ef2). Launcher suite 433 → 454 checks.
- chain-B (sdk-controls): COMPLETE — full gate.sh PASS. Deviation accepted: emitUiEvent extracted to src/sdk/events.ts (shared, not duplicated).
- chain-E (launcher-theme-state): COMPLETE — full gate.sh PASS; handoff/launcher-theme.md.
- chain-C (sdk-surfaces): COMPLETE — full gate.sh PASS. Deviations accepted: ProgressBar tone typed to the paintable ColorToken subset; Badge inherits Screen font.
- chain-F (launcher-ui): COMPLETE — full gate.sh PASS. Deviations accepted: corner-pill toggle clears the shape override (no 4th pill); dev-only probe screens lose shared StatusBar styling (cosmetic, flag-gated).
- chain-G (gallery-and-docs): 7.1 COMPLETE (fixture, every new export exercised); 6.5 + 7.2 dispatched after main-thread registration.

## Review

- Reviewer audit (full main...HEAD diff): no containment or trust-boundary issues; loader/assemble diffs confirmed exactly the additive D1/D8 forwarding; sanitize/caching semantics verified non-vacuously; preset tables verbatim; seams clean. Three minor findings, all fixed post-review: stale 4.4/7.3 checkboxes; sticky `pendingTheme` in assemble.mjs (now cleared on every reinject without a theme, matching D8); design D8 reworded to describe the actual structural host-side validity + iframe-side sanitize mechanism.
- gate-full.sh: FULL GATE PASSED (exit 0) — rerun again after the post-review assemble.mjs fix.

## Device review (emulator, Pixel 10 Pro XL AVD, release APK)

- Verified on-device: live preset switching (paper→neon) restyles shell + status bar; theme rides into the sandboxed gallery (fuchsia primaries, dark cards); slider drag (pointer capture) works in the real WebView; modal, list, badges, grid all render as designed; Tip Splitter regression-free under paper.
- Device-driven fixes (supplemental polish pass, gate.sh green): custom Slider (native track glared white on dark), custom Checkbox (native unchecked square clashed; radius follows theme shape, ✓ glyph carries semantics), Button width:'100%' removed (clipped in Rows; flex stretch keeps Stack behavior), Row wraps on overflow, Modal bottom padding clears the gesture-nav pill. design.md D6 updated to match.
- accent-color is no longer load-bearing anywhere (both native-control consumers replaced).
- Round 2 (user-reported, verified with held motionevents — invisible to tap-then-screenshot): Android WebView's -webkit-tap-highlight-color painted a holo-blue flash over the full border box of anything clickable (worst on Switch's full-width row). Suppressed via a shared TAP_RESET fragment on every interactive element; Button/Card/ListItem (no intrinsic state change) gained pressed feedback sized to the visual element (opacity dip / bg tint) via a shared usePressed() hook (src/sdk/press.ts). Long-press text selection on labels also suppressed (userSelect none at Screen root, re-enabled on text inputs). Native RN screens were never affected.

## Close-out

- decisions.md #45 appended; v1-roadmap Open deltas note added.
- Pending at time of writing: chain-G 6.5/7.2 result, reviewer audit of the full diff, gate-full.sh (Chromium invariants + knip + guard:metro + openspec validate).
- Known follow-ups for an attended session: on-device look-check of accent-color-styled native controls (Slider/Checkbox) in the Android System WebView; FloatingExit deliberately unthemed.
