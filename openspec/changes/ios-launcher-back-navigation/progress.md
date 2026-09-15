# Progress ledger: ios-launcher-back-navigation

Staging branch: integration/store-launch (shared launch run)

- 01:30 plan merged (8de0a02). Orchestrator adjudication before dispatch:
  - D6 (consent review-off exit) overlaps store-launch-compliance fix chain fix-consent-retry (reviewer H1), in flight. chain-1 must BUILD ON that fix's mode→actions helper and not add a second one. Re-read ConsentScreen/consent-flow on the staging tip at dispatch.
  - Every code chain waits for fix-launcher-wiring and fix-consent-retry to merge (both edit launcher files these chains touch, including LauncherRoot.tsx).
  - Owner questions answered with the planner defaults (orb Back row: no; nav.back() rule: separate change; edge swipe: only with a native stack; done-step Android back → Home: yes; bottom inset on Android: yes; F9 reuses SHOW_DEV_LOG_OVERLAY: yes).
  - Process note: the planner committed with core.hooksPath=/dev/null (skipped only graphify's no-op post-commit hook). Don't repeat.
- 02:21 dispatched chain-1 BASE 8f28226. Both review fix chains merged. D6 adjudication: build on src/host/launcher/consent-screen-actions.ts (fix-consent-retry), do not add a second consent controls table.
- 02:35 chain-1 report: complete, GATE PASS (launcher 10179), class-A x3 (consentControls is a thin adapter over consent-screen-actions.ts per the D6 adjudication; the screen-exits consent row points at consent-flow.ts keys, which chain-3 should re-check against chain-2's final ConsentScreen; dropped an unused eslint-disable) · integrity OK · merged · regate-pass. chain-2 waits for fix-notice-window (both edit the flow step screens). chain-2 needs only useSystemBack(onClose) on ConsentScreen; it already renders from consentScreenActions.
- 02:39 knip after the notice-window merge reports use-system-back.ts unused and SCREEN_EXITS/FALLBACK_EXIT unused exports. TRANSITIONAL: chain-2 wires useSystemBack, chain-3's scanner consumes the table. gate-full stays red on knip until chain-3 merges. dispatched chain-2 BASE 784557e.
- 02:50 chain-2 report: complete, GATE PASS (launcher 2023/0), no deviations · integrity OK · merged · regate-pass. All 10 screens on useSystemBack; PlanStep handleBack via planBackAction; BuildStep single onBack (onLeaveRunning prop removed); DoneStep listener goes Home; ConsentScreen hook only; FlowHeader hitSlop 16. knip: use-system-back.ts now used; SCREEN_EXITS/FALLBACK_EXIT still unused until chain-3. Open for chain-3: consent SCREEN_EXITS row file/label (chain-1 pointed at consent-flow.ts; labels render from consentScreenActions).
- 02:50 dispatched chain-3 BASE 5bbbf3d
