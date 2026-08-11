# Research digest: every ill-behaved wait in the launcher (census excerpt)

<!-- Compiled verbatim from the waiting-state census (recon-sweep, this cycle): server-API waits A1-A6, silent waits B1-B7, non-network waits D2-D5. -->

## Server-API waits with defects

- **A1 — clarify**: `LauncherRoot.tsx:482` `clarifyPrompt(clientOptions, from.text)` (`generation-client.ts:176-199` → `POST /v1/clarify`, unary). Pending UI: `ComposeStep.tsx` `busy=true` (`LauncherRoot.tsx:479/:491`), button label `COPY.flowBusy`. Errors: 502 → clarify-skip, silently proceeds to plan (`prompt-flow.ts:150-156` `isClarifySkip`); other → `FailureScreen` (`:487`). **No `AbortController`**; hardware-back on `ComposeStep` (`ComposeStep.tsx:48-52`) calls `onBack()`→`goHome()` without cancelling.
- **B1 (bug, highest severity) — navigation hijack**: `LauncherRoot.tsx:477-497` `onComposeContinue`: the post-await `setBusy(false)` + `setScreen(clarifyStep(...))`/`await openPlan(from)` are **unguarded by a current-screen check** (unlike A2's guard). Back out to Home while clarify is in flight → when the response resolves it forcibly navigates the user back into the flow from Home.
- **A2/B2 — rewrite**: `LauncherRoot.tsx:462-466` `rewritePrompt` (`generation-client.ts:204-234` → `POST /v1/rewrite`, unary). Pending UI: navigates immediately to `PlanScreen` `loading:true` (`prompt-flow.ts:198-210`), `PlanStep.tsx` row skeletons. Response application is screen-guarded (`s.kind === 'plan'`, `LauncherRoot.tsx:467`) so no hijack — but **no AbortController**: an abandoned call runs to completion server-side (token/usage burn), silently discarded.
- **A5/A6 — no transport timeouts**: initial `fetch()` for `/v1/generate` has no timeout (`generation-client.ts:271-300`) — hung connect leaves `BuildStep` stuck at step 1 indefinitely, reading as slow progress rather than network failure. `xhr-transport.ts:59-272`: an `xhr.ontimeout` handler exists (:267) but nothing ever sets `xhr.timeout`, so it can never fire. Generate (A3) itself is properly cancellable (AbortController + hardware back, `LauncherRoot.tsx:601-609`).

## Silent waits (no visual state at all)

- **B3 — open app**: `LauncherRoot.tsx:366-376` `onOpen` → `access.activeBundle(app)` (version-store read, `store-access.ts:155-166`). No busy state between tap and screen switch; slow snapshot read = tap appears dead.
- **B4 — fork/delete**: `LauncherRoot.tsx:378-386` `onFork`, `:392-400` `onDelete` — `await access.fork(...)`/`access.remove(...)` (isomorphic-git) with no loading state; only `refresh()` on success or `Alert.alert` on failure.
- **B5 — history first load**: `HistoryScreen.tsx:125-129` `load()` (`Promise.all([listVersions, activeId])`) — `snapshots` starts `[]`, so the screen momentarily renders as *empty history*, indistinguishable from truly-zero history.
- **B6 (bug) — double-submit**: `HistoryScreen.tsx:461-497` `ConfirmBody` → `confirmRestore` (`:176-182`, `access.rollback`) / `confirmCopy` (`:184-189`, `access.fork`): confirm buttons (`:492-496`) have no disabled/busy state — repeated taps queue multiple git operations.
- **B7 — WebView boot**: `useMiniAppHost.ts:135-175` `bind`/deliver — realm bind + bundle delivery + first paint has no loading UI in `MiniAppView.tsx` (zero hits for loading/spinner/ActivityIndicator); blank WebView chrome until the iframe paints. `paintMs` is tracked in `HostState` (`useMiniAppHost.ts:44`) but plumbed only to `DevProbeScreen`.
- **D5 — restore-diff pop-in**: `HistoryScreen.tsx:151-164` `fieldsLeavingViewOnRestore(...)` — async diff while the confirm sheet is open, `cancelled` guard present but no loading indicator; the reassurance line pops in when ready.

## Healthy reference points (don't regress)

- **A3 — generate** is the model citizen: real `AbortController`, hardware-back cancels (`onCancelGeneration`, `LauncherRoot.tsx:601-609`), "Leave it running" detaches deliberately (`:592-596`).
- **D1 — first-run seeding** (`LauncherRoot.tsx:353-364`, `seedFirstRun` before `setReady(true)`) renders `HomeGridSkeleton` (`:614-625`) — the one correctly-skeletoned wait; skeletons remain correct for true content loads.
- Cancel semantics are spec-bound: prompt-flow requires "No app SHALL be installed or updated from a cancelled generation".

## Risks / unknowns

- `MiniAppView.tsx` was not read in full; how `HostState.lastError`/`launchFailed` surface in the product path (vs `DevProbeScreen`) is unverified — worth confirming during design of the B7 fix (`webview-error.ts` adjacent).
- `HomeScreen.tsx`/`app-tile.tsx` long-press menu internals (which action triggers `onFork`/`onDelete`) were inferred, not read.
- The `launcher-ghost-tiles` change (in flight) touches `LauncherRoot.tsx` (`onBuildIt`, `deliverResult`, cancel paths) — this change touches `onComposeContinue`/`openPlan`/`onOpen`/`onFork`/`onDelete` plus `HistoryScreen`/`MiniAppView`/transports. Overlap in `LauncherRoot.tsx` is real; sequencing after ghost-tiles lands avoids merge friction.
