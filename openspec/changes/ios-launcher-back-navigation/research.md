# Research digest: what does giving every BackHandler-only launcher screen a visible exit on iOS touch, and what must not break?

<!-- Section A is the researcher digest (staging bf10ee8), condensed only where it restated file
roles. Section B is the planner's spot-check after fast-forwarding to 117a88f (compliance chain-6
merged): line numbers below are at 117a88f, and B corrects A where chain-6 changed the terrain. -->

## Relevant files
- `src/host/launcher/LauncherRoot.tsx` — `Screen` union (:120-165), `renderScreenContent` switch (:1550-1727), root `SafeAreaView edges={['top']}` (:1752) around `ScreenBoundary` (:1754)
- `src/host/launcher/useMiniAppHost.ts` — the only driver of `back-policy.ts` (:352-373); `exit()` (:337-341)
- `src/host/launcher/{ComposeStep,ClarifyStep,PlanStep,BuildStep,DoneStep}.tsx` — the five flow steps
- `src/host/launcher/flow-chrome.tsx` — shared `FlowHeader` (Back link, :27-44), `PrimaryAction`
- `src/host/launcher/{SettingsScreen,HistoryScreen,ConsentScreen,FailureScreen,AppLinkMissingScreen}.tsx`
- `src/host/launcher/{SheetModal,RunDetailsSheet,ReportSheet,AppLinkSheet}.tsx` — sheets
- `src/host/launcher/{Orb.tsx,orb-actions.ts}` — the in-app tapped menu; `DevProbeScreen.tsx` — dev-only
- `src/host/launcher/{ScreenBoundary,ScreenErrorFallback}.tsx` — the recoverable error screen
- `src/host/launcher/{prompt-flow,consent-flow,link-routing}.ts` — RN-free decision modules
- `src/host/launcher/test/run.mjs` + `test/acceptance.ts` — Node runner; hand-kept suite list
- `openspec/specs/mini-app-back-navigation/spec.md`, `host-observability/spec.md`, `prompt-flow/spec.md`, `app-launcher/spec.md`

## Current behavior (A)
- **Hardware back listeners.** `BackHandler.addEventListener('hardwareBackPress', …)` is registered in: `ConsentScreen.tsx:51`, `FailureScreen.tsx:137`, `ComposeStep.tsx:60`, `PlanStep.tsx:99`, `HistoryScreen.tsx:159`, `SettingsScreen.tsx:91`, `ClarifyStep.tsx:63`, `BuildStep.tsx:94`, `useMiniAppHost.ts:368` (plus `AppLinkMissingScreen.tsx:23`, see B). RN's `BackHandler` has no iOS implementation, so all are no-ops there. `DoneStep.tsx` registers none. `SheetModal.tsx` and `RunDetailsSheet.tsx` register none; they close by scrim, `onRequestClose` (Android back on a visible `Modal`) or a visible Close. `SheetModal.tsx:11-15` already states the iOS rule: every caller must give the sheet its own visible close.
- **Visible controls that already match the listener.** Compose/clarify/plan: `FlowHeader`'s `Back` (`COPY.backLabel`) receives the same `onBack` (`ComposeStep.tsx:71`, `ClarifyStep.tsx:72`, `PlanStep.tsx:127`). Settings/History: a 42×42 chevron button with `accessibilityLabel={COPY.backLabel}` calling the same `onBack` (`SettingsScreen.tsx:131-139`, `HistoryScreen.tsx:247-255`). Failure: `Back to your apps` (`COPY.failureBack`) calls the same `onBack` (`FailureScreen.tsx:229-235`). Build: `Leave it running` (`COPY.buildLeaveRunning`, `BuildStep.tsx:148-154`) calls `onLeaveRunning`, which `onBuildBack` (`LauncherRoot.tsx:1362-1368`) defers to when the details sheet is closed; with the sheet open, `RunDetailsSheet` shows Close.
- **Mismatch 1: consent review with consent off** (`ConsentScreen.tsx:120-128`). Only `Turn AI features on` (→ `onAgree`) renders; nothing visible maps to `onClose`. On iOS the only way off this screen is to grant consent.
- **Mismatch 2: plan row editing** (`PlanStep.tsx:98-108` vs `:127`). The listener cancels an open row edit before calling `onBack`; `FlowHeader`'s `Back` gets the raw `onBack`, so tapping it mid-edit discards the draft and leaves the step.
- **Running mini-app.** The orb's `Home` row (`orb-actions.ts:38`, `⌂`) → `Orb.tsx:85` `onExit()` → `host.exit` (`MiniAppView.tsx:178`) → `useMiniAppHost.exit()` (:337-341) → `goHome`. No `BackHandler` or `BackPolicy` on that path, so full exit works on iOS today. `DevProbeScreen.tsx:42-44` has its own visible `‹ Home` calling `host.exit`.
- **What does not work on iOS: popping one level inside a mini-app.** `back-policy.ts`'s `forward` (→ `window.__whimControl.navBack()`) is triggered only from the listener at `useMiniAppHost.ts:355-373`. There is no other caller of `policy.current.backPress()`. An app at depth > 0 can be left only by its own `nav.back()` control or by the orb's full exit.

## Constraints and invariants (A)
- `mini-app-back-navigation` "The user can always exit — no app can trap the back button" is the governing guarantee.
- The same spec's "A floating affordance offers an always-available exit" is **stale**: it specifies drag-repositioning and idle auto-dim, which describe the retired `FloatingExit`. `Orb.tsx:1-20` says it replaces FloatingExit and is not draggable; `test/orb-menu.suite.ts:128-129` asserts no `PanResponder`/drag code exists. No change has amended the requirement.
- `back-policy.ts` is pure; compliance chain-5's `overlayOpen → close-overlay` already models "a host sheet takes back first". Any new trigger must go through the same `BackEvent`/`BackAction` union (`back-policy.ts:20-32`).
- `test/product-verbs.suite.ts:14-18` forbids mechanism vocabulary in every `COPY` value.
- No `react-navigation`, `react-native-screens` or `react-native-gesture-handler` in `package.json`. The only `Platform.OS` branch in the launcher is `SheetModal.tsx:65`.
- `run.mjs:9-27` bundles suites with only the pure-JS git deps external; `react-native` can't be bundled, so `.tsx` screens can't be imported. Precedents for checking them: `fs.readFileSync` source assertions (`observability-ui.suite.ts:43-45`, `product-verbs.suite.ts`, `app-link-ui.suite.ts`), and `react-test-renderer` on RN-free components (`ScreenBoundary`).
- Safe area: only the top edge is applied at the root (`LauncherRoot.tsx:1752`). Bottom-anchored floating pieces read `useSafeAreaInsets().bottom` themselves (`Orb.tsx:57,95`, `RunDetailsSheet.tsx:62`, `SheetModal.tsx:47`). In-flow bottom buttons (flow `PrimaryAction` `marginBottom: 24`, `BuildStep` leave, `FailureScreen` actions, `ConsentScreen` actions) add no bottom inset.

## Integration points (A)
- Each screen's `onBack`/`onClose` prop is already the single decision point (`goBack` :904, `onLeaveFailure` :1439, `onConsentAskDecline` :813, `onConsentReviewClose` :838, `onBuildBack` :1362).
- `FlowHeader` is deliberately dumb; plan's edit-aware back belongs in `PlanStep`, not `flow-chrome.tsx`.
- `prompt-flow.ts#buildBackAction` (:371) is the precedent for a pure back decision beside a step.

## B. Planner spot-check at 117a88f
- **Compliance chain-6 merged.** `Screen` gained `{ kind: 'link-missing' }` (`LauncherRoot.tsx:128`), rendered as `<AppLinkMissingScreen onBackToApps={goHome} />` (:1609). `AppLinkMissingScreen.tsx:23` registers hardware back → `onBackToApps`; its visible `Back to your apps` (`COPY.appLinkMissingBack`, :37-41) calls the same prop. `app-link-ui.suite.ts:114` pins the literal listener. `link-routing.ts#linkExitFor` (:49-63) is a kind-keyed RN-free table of each screen's safe exit for links (not the same as back: flow steps go Home for a link, one step back for back).
- **Full `Screen` kind list (13):** `home`, `app`, `dev`, `settings`, `history`, `link-missing`, `consent` (ask/review), `compose`, `clarify`, `plan`, `build`, `done`, `failure` (`LauncherRoot.tsx:120-165`, `prompt-flow.ts:145`).
- **Error fallback trap.** `ScreenErrorFallback.tsx:16-32` renders only `Try again` (`resetErrorBoundary`). A screen that throws on every render leaves no way out on iOS; on Android its own listener never registered (render threw before effects), so back backgrounds the app. The spec promises recovery "by navigating away and back" (`host-observability` spec :11-16), which the fallback gives no way to do.
- **Done step.** No listener: Android back on `done` backgrounds the app, while the visible `Back to your apps` (`DoneStep.tsx:48-52`) goes Home.
- **Source pins that read listeners:** `failure-screen.suite.ts:98`, `app-link-ui.suite.ts:114`, `prompt-flow-screens.suite.ts:557,570`, `prompt-flow-wiring.suite.ts:458-479`.
- **Listener churn.** Compose/clarify/plan get `onBack={() => goBack(from)}`, a new function each render, and their effects depend on `[onBack]`, so the listener re-registers on every shell render. `LauncherRoot.tsx:1346-1350` documents the bug this caused on the build screen (the newest listener ran first).
- **Generation guidance.** Neither `server/src/generation/prompts/` nor `checks/passes/screens.ts` requires a pushed mini-app screen to render a `nav.back()` control; `docs/sdk-reference.md:276-310` only shows one in its example.
- **Consent copy tripwire.** `public-generation-server` chain-15 fails any edit that adds or changes a `consent…` string in `copy.ts` without `deploy/site/privacy.html` quoting it (`public-generation-server/chains.md:44-47`).
- **tsconfig** extends `@react-native/typescript-config` (strict), so indexing `Record<K, V>` with a wider literal union is a type error.
- **Details sheet.** `RunDetailsSheet`'s scrim is absolute on all four edges (`RunDetailsSheet.tsx:118-126`) and is a sibling of `BuildStep`, so `Leave it running` can't be tapped while the sheet is open.
- Not verified: the rendered overlap of bottom buttons with the iPhone home indicator or an Android 15 navigation bar.
