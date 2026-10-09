## Why

React Native's `BackHandler` does nothing on iOS, and the launcher leans on it in ten places: nine screens and the mini-app host. Most of those screens already show a tappable control that does the same thing, but not all of them do, and nothing stops the next screen from shipping without one (research.md A "Visible controls", "Mismatch 1", "Mismatch 2"). On an iPhone today three screens can hold a user in place. The consent review screen with AI features off can only be left by turning them on. A screen that throws on every render shows `Try again` and nothing else. And the plan step's header `Back` silently throws away a row the user is editing, which the hardware back button on Android never does. An App Review tester who meets any of these writes it up, and the submission is due around 2026-09-19.

## What Changes

- **Every launcher screen other than Home shows a visible control that leaves it, on both platforms.** No new header component and no restyle: the controls the design already specifies stay (the flow header's `Back`, the Settings/History chevron, `Back to your apps`, `Leave it running`, `Not now`, the orb's `Home`). The change fills the three gaps above.
- **System back and the visible control run one handler.** A small `useSystemBack(handler)` hook (with an RN-free core) replaces the nine hand-written screen listeners. It registers once per mount and always calls the latest handler, which also removes the listener churn that caused the old build-screen bug. The plan step gets an edit-aware back shared by both paths. The done step starts answering Android back the way `Back to your apps` does.
- **Consent review can always be left without changing consent.** With AI features off, review mode shows `Not now` under `Turn on AI features`, reusing the existing string so no new consent copy appears.
- **The error screen gets `Back to your apps`** on every screen except Home, and system back does the same there.
- **Bottom controls clear the home indicator.** The shell frame applies the bottom safe-area inset to every screen except a running mini-app, whose orb and sheets inset themselves, and the developer probe, which has its own safe-area view.
- **A check keeps it that way.** An RN-free table declares each `Screen` kind's exit; indexing it by `screen.kind` makes a missing row a type error, and a launcher suite fails when a component registers back outside the hook, uses the hook without a declared row, doesn't bind its back handler to a pressable control, or lacks its declared control label.
- **Spec drift fixed.** `mini-app-back-navigation`'s "floating affordance" requirement still describes the retired draggable, auto-dimming button. It's rewritten to describe the orb, which is the one exit from a running mini-app that works on iOS.
- **An attended walk on an iPhone and the Android emulator** confirms every screen and sheet can be left without gestures.

Non-goals: an iOS edge-swipe gesture, a navigation library, any host-side way to pop a mini-app's own screen stack on iOS, restyling any screen, and the separate `launcher-polish-fixes` batch (the ⚙ glyph, tile labels and others).

## Capabilities

### New Capabilities
- `launcher-screen-exits`: every launcher screen except Home has a visible exit that matches system back; consent review can always be left unchanged; bottom controls clear the bottom system area; the declared exit table and the fast-gate check that enforces it.

### Modified Capabilities
- `mini-app-back-navigation`: "A floating affordance offers an always-available exit" now describes the orb (tapped, not draggable, never dimmed) and names it as the guaranteed exit where no system back exists.
- `host-observability`: "Every screen renders inside a recoverable error boundary" gains a way back to the home grid from the error screen.

## Impact

- `src/host/launcher/`: new `system-back.ts`, `use-system-back.ts`, `screen-exits.ts`. Edits to `ComposeStep.tsx`, `ClarifyStep.tsx`, `PlanStep.tsx`, `BuildStep.tsx`, `DoneStep.tsx`, `SettingsScreen.tsx`, `HistoryScreen.tsx`, `FailureScreen.tsx`, `ConsentScreen.tsx`, `AppLinkMissingScreen.tsx`, `flow-chrome.tsx`, `ScreenBoundary.tsx`, `ScreenErrorFallback.tsx`, `LauncherRoot.tsx`, `prompt-flow.ts`, `consent-flow.ts`, `copy.ts` (one key, `screenErrorBack`), `test/acceptance.ts`, one new suite, new cases in `prompt-flow-screens.suite.ts` and `consent-flow.suite.ts`, and re-pinned listener assertions in `failure-screen.suite.ts`, `app-link-ui.suite.ts` and `prompt-flow-screens.suite.ts`.
- No new dependency, no protected file, no native project change, no server or contract change.
- `docs/decisions.md` gains one entry.
- Sequencing: every chain touches `src/host/launcher/**`, so the change applies onto `integration/store-launch` only after `store-launch-compliance` chains 6 (merged) and 7 have merged.
