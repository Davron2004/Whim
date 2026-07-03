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

## Close-out

- decisions.md #45 appended; v1-roadmap Open deltas note added.
- Pending at time of writing: chain-G 6.5/7.2 result, reviewer audit of the full diff, gate-full.sh (Chromium invariants + knip + guard:metro + openspec validate).
- Known follow-ups for an attended session: on-device look-check of accent-color-styled native controls (Slider/Checkbox) in the Android System WebView; FloatingExit deliberately unthemed.
