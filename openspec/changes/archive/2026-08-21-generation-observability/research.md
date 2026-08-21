# Research digest: what would derived activity signals + a persisted run journal touch?

<!-- Compiled verbatim from the waiting-state census (recon-sweep) and the launcher build-state digest (researcher), both this cycle. -->

## Build-screen wait today

- `BuildStep.tsx` is the full-screen build progress UI, driven by `prompt-flow.ts`'s pure helpers: `buildStepStatuses`, `activeBuildStepIndex`, `buildProgressFraction`, `currentActionSentence`, `BUILD_STEPS` (4 named steps: reading/writing/checking/installing — prompt-flow.ts:293-349). It renders **only** from `stage` events — never `token`/`diagnostic` internals (spec-enforced today).
- The stream: `LauncherRoot.tsx:525` `for await (const event of generateApp(clientOptions, request, controller.signal))`, `generation-client.ts:391-425` → `POST /v1/generate` SSE. Event types on the wire: `stage`, `token`, `diagnostic`, terminal `result`/`failure` (exactly one terminal event per stream — generation-contract spec).
- The initial `fetch()` for `/v1/generate` has no timeout (`generation-client.ts:271-300`); a hung connect leaves `BuildStep` at `stage:null` — step 1 "Reading" — indefinitely, indistinguishable from slow progress. Same no-timeout property in `xhr-transport.ts:59-272` (an `xhr.ontimeout` handler exists at :267 but nothing sets `xhr.timeout`).
- Post-stream delivery renders as `delivering:true` → last step "Installing" (`prompt-flow.ts:396-401` `withDelivering`).
- "Leave it running" (`BuildStep.tsx:87-95` → `LauncherRoot.tsx:592-596`) detaches (`ctl.detached = true`) without cancelling; delivery then completes silently in the background shell instance.
- Failure paths: stream ends w/o terminal event → generic failure (`LauncherRoot.tsx:537-556`); terminal `failure` → `FailureScreen` with diagnostics (`:557-575`); thrown → `FailureScreen` (`:582-587`). `FailureScreen` carries `reason`, `diagnostics`, `observedRepairAttempts`, `hasWorkingVersion`.

## Persistence substrate (in flight)

- The `launcher-ghost-tiles` change (currently being applied) introduces `PendingBuildStore` on the shared MMKV `KVBackend` (keys `pending:<id>`, `pending:order`), record `{ id, prompt, workingTitle, state: 'building'|'failed'|'interrupted', createdAt, updatedAt, failure?, editingAppId? }`, single-writer lifecycle (created at generation start, deleted after successful delivery, `setFailed` on terminal failure/stream error, launch-time demotion `building`→`interrupted`). See openspec/changes/launcher-ghost-tiles/{design.md,specs/pending-builds/spec.md}.
- Ghost interactions (same change): tap failed/interrupted ghost → failure screen hydrated from the persisted failure payload; tap building ghost → reattach to build screen.
- `AppIndex`/`InstalledApp` records must never exist without a bundle (store-is-source-of-truth, decision #43b/D1) — the pending record is the sanctioned pre-existence surface.

## Stream consumption constraints

- The event stream is consumed only inside the one `LauncherShell` async-generator loop driving `onBuildIt`; there is no independent event bus. Any journal write must happen in that loop (single writer, matching the pending-store discipline).
- Token events carry generated-output text; the prompt-flow spec deliberately forbids rendering raw token/diagnostic internals in product UI. Derived aggregates (counts, rates, timestamps) are not raw internals.
- RN 0.85 fetch has no streaming body; SSE arrives via XHR incremental reads (`xhr-transport.ts`) — event arrival cadence is already observable client-side.

## Non-network waits adjacent to the build

- Delivery/install (`deliverResult` → `store-access.ts` install/update/fork, isomorphic-git) is a real wait rendered as the "Installing" step; its duration is currently unmeasured.
- `paintMs` (WebView first-paint) is tracked in `HostState` (`useMiniAppHost.ts:44`) but plumbed only to `DevProbeScreen`, not the product path.

## Risks / unknowns

- Journal write frequency vs MMKV: token events can arrive at high cadence; per-token persistence would thrash the KV store — aggregation cadence is a design decision.
- `HistoryScreen`/version-history (decision #48 prompts-as-history) was not re-checked for overlap with a run timeline surface; the run journal is per-attempt, history is per-installed-version — distinct but adjacent vocabularies.
- Server-side stage vocabulary (`'plan'|'generate'|'check'|'run'|'repair'`) vs client BUILD_STEPS (4 steps) mapping lives in `prompt-flow.ts:293-349`; a journal should record the wire stages, not the display mapping.
