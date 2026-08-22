## 1. Transport: cancellable clarify/rewrite + connect timeout

- [x] 1.1 Add an optional `AbortSignal` parameter to `clarifyPrompt` and `rewritePrompt`
  (`generation-client.ts`) and thread it through to their `fetchImpl` calls.
- [x] 1.2 Add a connect/first-event timeout (~15s) to `openFetchGenerateStream` (`fetch` path):
  race the initial request against a timer that aborts via the same `AbortController`, disarmed
  once the first chunk/event is observed.
- [x] 1.3 Arm `xhr.timeout` to the same ~15s value before `.send()` in `xhr-transport.ts`,
  disarmed (or effectively bypassed) once the first event is delivered, so a hung connect fires
  the existing `xhr.ontimeout` handler and a long-running active stream is never killed.
- [x] 1.4 Ensure a fired connect timeout on either transport is classified as `GenerationClientError{kind:'network'}` (or equivalent honest network-failure classification), not left indistinguishable from an in-progress stream.
- [x] 1.5 Run `npm run launcher:test`, adding/extending cases for: clarify/rewrite abort, and a
  connect-timeout case on each transport that doesn't fire once the first event has arrived.

## 2. LauncherRoot: clarify/rewrite cancellation and the B1 navigation-hijack fix

- [x] 2.1 Give `onComposeContinue`'s clarify call its own `AbortController`, tracked so the
  compose step's leave-handler (hardware back / `goHome`) can abort it, mirroring the
  `genRef`/`ctl` pattern `onBuildIt` already uses for generate.
- [x] 2.2 Guard every post-await `setScreen` write inside `onComposeContinue` (including
  `setBusy(false)`) with a current-screen check, mirroring `openPlan`'s existing
  `s.kind === 'plan'` guard — this is the B1 bug fix.
- [x] 2.3 Give `openPlan`'s rewrite call its own `AbortController`, tracked so leaving the plan
  screen aborts it (A2/B2); the existing `s.kind === 'plan'` guard on the response application
  stays in place.
- [x] 2.4 Wire the abort into whatever leave-handler(s) apply to the compose and plan steps
  (hardware back, `goHome`, `goBack`), consistent with how `onCancelGeneration` wires abort for
  the build step.

## 3. Open/fork/delete busy states (B3/B4)

- [x] 3.1 Add a per-tile busy/pressed state to the home grid (`HomeScreen.tsx`/`app-tile.tsx`)
  driven by `onOpen`'s in-flight status, cleared on screen switch or failure.
- [x] 3.2 Add a busy/disabled state to the Fork and Delete action-sheet rows (or their triggering
  controls) in `HomeScreen.tsx`, driven by `onFork`/`onDelete`'s in-flight status in
  `LauncherRoot.tsx`, disabling re-invocation for the same app until the operation settles.
- [x] 3.3 Verify (manually or via an existing acceptance path) that a failed fork/delete clears
  the busy state and still shows the existing `Alert.alert` failure path.

## 4. Mini-app boot state (B7)

- [x] 4.1 Derive a "has painted" boolean in `useMiniAppHost.ts`'s `HostState` from the existing
  `paintMs` field (non-null means first paint observed), without adding a new bridge message.
- [x] 4.2 Add a boot-state render branch in `MiniAppView.tsx`: rendered when bound but not yet
  painted and not `launchFailed`; branded and minimal, styled from design tokens per the existing
  "mini-app container styles its failure state from tokens" discipline in `app-launcher`.
- [x] 4.3 Confirm the existing `launchFailed` branch still takes precedence over the boot state
  when a launch fails before any paint.

## 5. History screen: loading state, confirm-sheet disabling, restore-diff pending (B5/B6/D5)

- [x] 5.1 Add an explicit `loading` boolean to `HistoryScreen.tsx`'s `load()` flow, true until the
  first `Promise.all([listVersions, activeId])` resolves; render row skeletons (reusing existing
  skeleton-geometry primitives) while `loading` is true instead of an empty list.
- [x] 5.2 Add a per-confirm in-flight boolean to `HistoryScreen.tsx`'s confirm state, set before
  `access.rollback`/`access.fork` in `confirmRestore`/`confirmCopy` and cleared after; disable the
  `ConfirmBody` Restore/Copy `TouchableOpacity`s while it's true.
- [x] 5.3 Add a pending visual state to the `fieldsLeavingViewOnRestore` line in `ConfirmBody`
  (e.g. a muted placeholder), shown while the existing `cancelled`-guarded effect is in flight,
  replaced by the reassurance line or nothing once it resolves.
- [x] 5.4 Run `npm run launcher:test`, adding/extending cases for the loading state and
  confirm-sheet double-submit guard.

## 6. Verification

- [ ] 6.1 Run `npm run lint`, `npm run launcher:test`, and `scripts/gate.sh` locally before merge.
- [ ] 6.2 Manually verify on-device (or via the offline release build) that: leaving compose
  while clarify is in flight no longer navigates the user back into the flow; leaving the plan
  screen stops the rewrite call; opening/forking/deleting an app shows a busy affordance; history
  shows a loading state on first open; the confirm sheet can't be double-submitted; a mini-app
  shows a boot state before paint.
