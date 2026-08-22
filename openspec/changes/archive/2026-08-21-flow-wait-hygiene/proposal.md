## Why

The waiting-state census (`research.md`) found nine defects in how the launcher's non-generation
waits behave: one navigation-hijack bug (B1), one double-submit bug (B6), five silent waits with
no visual state at all (B3-B5, B7, D5), and two server calls that keep running (burning tokens)
or read as a hang instead of a failure after the user has already left (A2/B2, A5/A6). Generation
itself (A3) already meets the bar — real cancellation, screen-guarded state application, honest
failure. This change brings every other wait in the launcher up to that same bar.

## What Changes

- **Compose → clarify (A1/B1)**: `clarifyPrompt` gets a real `AbortController`; leaving the
  Compose step (hardware back / `goHome`) aborts it. The post-await state application in
  `onComposeContinue` is guarded by a current-screen check, mirroring the existing
  `s.kind === 'plan'` guard `openPlan` already uses — fixes the navigation-hijack bug where a
  late clarify response forces the user back into the flow from Home.
- **Plan → rewrite (A2/B2)**: `rewritePrompt` gets an `AbortController`; leaving the plan screen
  aborts the in-flight rewrite so an abandoned call stops burning server-side tokens instead of
  running to completion and being silently discarded.
- **Generate-stream transport timeout (A5/A6)**: a connect/first-event timeout (~15s) on opening
  the `/v1/generate` stream, applied on both the `fetch` path and the XHR path (`xhr.timeout`,
  whose `ontimeout` handler already exists but is never armed). A timed-out open is classified and
  surfaced as a network failure, never left looking like slow progress. No overall stream-duration
  timeout — long streams remain legitimate.
- **Open app (B3)**: tapping an app tile shows an immediate pressed/busy affordance that persists
  until the screen switches, so a slow snapshot read doesn't read as a dead tap.
- **Fork / delete (B4)**: both show a busy state on the triggering action and disable
  re-triggering while the git operation runs.
- **History first load (B5)**: the history screen renders a loading state (skeleton — this is a
  true content load, unlike the generic-spinner cases this change explicitly avoids) instead of
  rendering as fake-empty history before the first snapshot list resolves.
- **Restore/copy double-submit (B6)**: the confirm sheet's Restore and Copy buttons disable while
  their operation is in flight, so repeated taps can't queue multiple git operations.
- **Mini-app boot state (B7)**: `MiniAppView` shows a branded, minimal boot state from bind until
  first paint or launch failure, using the existing `HostState` signals; launch failure already
  surfaces visibly and stays that way.
- **Restore-diff pop-in (D5)**: the confirm sheet shows a subtle pending state for the
  fields-leaving-view reassurance line while it's computed, instead of the line popping in.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `prompt-flow`: clarify and rewrite gain cancellable requests and screen-guarded state
  application (extending the existing generate-only cancellation requirement to the whole flow);
  the generate-stream open gains a connect/first-event timeout surfaced as a network failure.
- `app-launcher`: open/fork/delete gain busy/disabled affordances while their underlying
  version-store or git operation is in flight; the mini-app container gains a boot state between
  bind and first paint.
- `version-history`: the history screen's first load gains a loading state; the confirm sheet's
  Restore/Copy actions disable while in flight; the restore-diff reassurance line gains a pending
  state instead of popping in unannounced.

## Impact

- `src/host/launcher/LauncherRoot.tsx`: `onComposeContinue`, `openPlan`, `onOpen`, `onFork`,
  `onDelete` gain abort/busy/guard handling.
- `src/host/launcher/generation-client.ts`, `xhr-transport.ts`: `clarifyPrompt`/`rewritePrompt`
  accept an `AbortSignal`; the generate-stream open gets a connect timeout on both transports.
- `src/host/launcher/ComposeStep.tsx`, `PlanStep.tsx`, `HomeScreen.tsx`/`app-tile.tsx`: busy/disabled
  visual states for their respective triggering actions.
- `src/host/launcher/HistoryScreen.tsx`: first-load skeleton, confirm-sheet button disabling, and
  the restore-diff pending state.
- `src/host/launcher/MiniAppView.tsx`, `useMiniAppHost.ts`: a boot-state render branch driven by
  existing `HostState` signals.

**Dependency**: this change touches `LauncherRoot.tsx` (`onOpen`, `onFork`, `onDelete`,
`onComposeContinue`, `openPlan`) in the same file and neighborhood as the in-flight
`launcher-ghost-tiles` change (which edits `onBuildIt`, `deliverResult`, and the cancel paths).
This change SHALL be sequenced to apply after `launcher-ghost-tiles` lands, to avoid merge
friction on a shared file.

**Non-goals** (out of scope, tracked elsewhere): build-screen activity signals/journal (separate
change `generation-observability`); server connectivity probing (separate change
`server-connectivity`); ghost tiles (in flight as `launcher-ghost-tiles`).
