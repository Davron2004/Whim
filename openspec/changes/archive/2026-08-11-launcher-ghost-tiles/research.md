# Research digest: what would ghost tiles for in-flight/failed generations touch?

<!-- Researcher subagent digest, pasted verbatim. -->

## 1. Launcher list source of truth

- `src/host/launcher/app-index.ts` — `AppIndex` (MMKV-backed `KVBackend`, keys `app:<id>`/`order`/`seed:version`) is the launcher's sync in-memory/persisted list. `InstalledApp` (lines 26-49) is the record type: `id, name, example?, createdAt, record: AppRecord, storeId?, lineageId, forkedFrom?, storageGroupId?`. `list()` (line 101) reads the `order` array and drops dangling ids.
- `src/host/launcher/LauncherRoot.tsx:277-283,344` — `LauncherShell` holds `apps: InstalledApp[]` React state, refreshed via `refresh = () => setApps(index.list())` (line 344) after every mutating action (open/fork/delete/deliver).
- `src/host/launcher/HomeScreen.tsx:60,98-120` — renders the grid by mapping `apps` (prop) directly, one `<AppTile>` per entry, keyed by `app.id`.
- `src/host/launcher/app-tile.tsx` — `AppTile` (`AppTileProps`, lines 42-65): takes `name`, optional `manifest: Pick<AppManifest,'tileColor'>`, `size?: 'done'`, `width?`. Renders a ghost-letterform monogram tile from `name`/`manifest`, no `id` shown, no built-in "loading"/"disabled" visual state today.

There is currently **no concept of a non-installed / pending entry** in `AppIndex` or `apps` state — the grid only ever shows records that already survived `AppIndex.put`.

## 2. Generation lifecycle

State machine lives in `src/host/launcher/prompt-flow.ts` (pure, no I/O) and is orchestrated in `LauncherRoot.tsx`'s `LauncherShell`. Steps: `compose → clarify → plan → build → done`, each a variant of `FlowScreen` (`ComposeScreen | ClarifyScreen | PlanScreen | BuildScreen | DoneScreen`, prompt-flow.ts:108) held as **React component state** (`screen: Screen`, LauncherRoot.tsx:321) — none of it is persisted.

- No app id/draft id is allocated up front. `freshAppId()` (LauncherRoot.tsx:134-137) is only called inside `deliverResult` (line 260), i.e. **after** the terminal `result` event arrives — id allocation is a *success-only* side effect.
- `BuildScreen` (prompt-flow.ts:87-99) carries `stage: Stage | null` (`'plan'|'generate'|'check'|'run'|'repair'`) and `delivering: boolean`; both are transient render-only state, never written anywhere persistent.
- Observable states today, all in-memory-only: compose (idle text entry), clarify (Q&A), plan (rewrite preview, `loading` bool), build (`stage`, `delivering`), done (delivered `InstalledApp`), failure (`FailureScreen`, a sibling `Screen` variant carrying `reason`, `diagnostics`, `observedRepairAttempts`, `hasWorkingVersion`, `editing?: InstalledApp`).
- `onBuildIt` (LauncherRoot.tsx:500-588) is the only place a generation request is sent; it drives `generateApp(...)` (an async generator streaming `GenerationEvent`s, from `generation-client.ts`), and only on a `result` terminal event calls `deliverResult` → `access.install`/`access.update`/`access.fork`+`update` (store-access.ts:110-152) which is the first moment an `AppIndex` record (and version-store snapshot) exists.

## 3. Failure + death

- On a `failure` terminal event or a stream-error (no terminal event) or a thrown error mid-`onBuildIt`, `LauncherRoot.tsx` just calls `setScreen({kind:'failure', ...})` (lines 546-587) and logs via `logGenFailureShown`/`log.error` (CHANNELS.gen) — **no `AppIndex` write, no version-store write**, so nothing is installed/updated (matches prompt-flow spec's "Failure is shown honestly" + generation-contract's single-terminal-event guarantee).
- If the RN process is killed mid-generation, there is **zero persisted trace**: the abort controller (`genRef.current`, LauncherRoot.tsx:342) lives only in a `useRef`; `AppIndex`/version-store are untouched until `deliverResult` succeeds. On relaunch the user sees exactly the pre-generation grid, no ghost, no failure marker, no way to know an attempt happened. This is the literal gap the ghost-tile feature would close.
- Explicit user cancel (`onCancelGeneration`, line 601) aborts the fetch and returns to compose — same "nothing installed" outcome, spec-mandated (prompt-flow "Leaving generation cancels... No app SHALL be installed or updated from a cancelled generation").
- `onLeaveRunning` ("Leave it running", line 592) detaches (`ctl.detached = true`) and navigates home while the stream keeps running in the background component instance; delivery still happens silently via the same `deliverResult` call once the stream completes (line 578-581) — this is the one case today where a generation continues after the user leaves the screen, and currently the grid gives no visual indicator that anything is in flight.

## 4. Naming

- A display name is available as soon as the user types a prompt (`ComposeScreen.text`) but that is not a "name" — the SDK/wire name only exists once the model emits it. The actual app `name` first appears in the terminal `result` event's `WireAppRecord.name` (`mapWireRecord`, LauncherRoot.tsx:148-156), consumed inside `deliverResult`. There is no earlier name candidate in the current pipeline (no client-side title guess from the prompt) — the clarify/plan/rewrite responses (`RewriteResponse`) carry `rewrittenPrompt`/`plan` text but no name field that reaches the screen state.
- For a ghost tile with no name yet, the nearest available text is the user's raw prompt (`ComposeScreen.text` / `BuildScreen.text`) or the rewritten prompt (`BuildScreen.rewritten`) — not a real app name.

## 5. Existing progress/status UI

- `BuildStep.tsx` (src/host/launcher/BuildStep.tsx) is the full-screen build progress UI, driven by `prompt-flow.ts`'s pure helpers: `buildStepStatuses`, `activeBuildStepIndex`, `buildProgressFraction`, `currentActionSentence`, `BUILD_STEPS` (4 named steps: reading/writing/checking/installing — see prompt-flow.ts:293-349). It renders only from `stage` events (`GenerationEvent` type `'stage'`) — never `token`/`diagnostic` internals (spec-enforced).
- The event stream itself: `generateApp(clientOptions, request, signal)` in `generation-client.ts` yields `GenerationEvent` (type from `@whim/contract`, generation-contract spec) over SSE via `xhr-transport.ts`. Types seen: `stage`, `token`, `diagnostic`, and terminal `result`/`failure` (exactly one terminal event per stream, per generation-contract spec).
- This event stream is currently **only consumed inside the full-screen `BuildStep`**, scoped to the one `LauncherShell` component instance driving `onBuildIt`. There is no separate subscribable event bus a *background* ghost tile on the home grid could listen to independently — the stream lives inside a single async generator loop tied to one `screen==='build'` lifecycle. A ghost tile subscribing to live progress (vs. just showing a static "building…" state) would need new plumbing (e.g. lifting stream state out of the per-screen closure into `LauncherShell`-level state that persists across `goHome`/`onLeaveRunning`).
- `flow-skeletons.tsx` has `HomeGridSkeleton` (used only for the initial app-list load, not per-tile).

## 6. Fork/id invariants (decision #43b / #52 territory)

- Two-id model (decision #43b D2, still current): `InstalledApp.id` is the **launcher id**; for original installs it equals the version-store `appId`; forks get a fresh launcher `id` but keep `storeId` pointing at the original's repo + their own `lineageId`. `storeIdOf(entry)` = `entry.storeId ?? entry.id` (used throughout store-access.ts).
- `engineAppId(entry)` (store-access.ts:93-95, per #52 supersedes #43b D8) = `entry.storageGroupId ?? entry.id` — the runtime/storage-engine appId, distinct again from both launcher id and store id.
- `freshAppId()` (LauncherRoot.tsx:134-137) is a cheap timestamp+random string, non-cryptographic, used only as a local index key — no server-side allocation, no collision-checked reservation. Nothing today prevents allocating one **before** a bundle exists; the current code just chooses not to (id + `AppIndex.put` are always paired with a version-store `snapshot` write in `install()`, store-access.ts:110-131 — "store first, index second, D1: the store is the source of truth"). Any ghost-record design that writes an `AppIndex`/`InstalledApp`-shaped entry with no bundle would be a first for this codebase and would need care not to violate `install()`'s "store is source of truth" ordering or the app-launcher spec's "Installed apps are persistent host-held records" requirement (which implies a record always has a working manifest/bundle reference).

## Risks / unknowns

- Not verified whether `HistoryScreen`/`version-history` surfaces have any per-run failure trail (decision #48 "prompts-as-history") that could be reused as the "failed builds visible" persistence layer instead of a new mechanism — worth checking `history-logic.ts`/`HistoryScreen.tsx` before designing.
- Not checked whether the stream can be resumed/reattached after backgrounding (`generation-client.ts` / `xhr-transport.ts` internals) — relevant only if a ghost tile later needs live progress after `onLeaveRunning` (out of scope here).
- Not confirmed whether `AppIndex` serialization has version guards beyond the try/catch in `AppIndex.get` — a new optional field or parallel keyspace is likely additive and safe, but unverified.
