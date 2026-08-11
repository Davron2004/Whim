## Context

Nothing about a generation is persisted until the terminal `result` event: the launcher id is allocated inside `deliverResult` only (research.md §2), failure/death leave no trace (§3), and "Leave it running" continues the stream invisibly in the shell closure (§3). The grid renders exclusively from `AppIndex.list()` (§1), and `install()` enforces "store first, index second — the store is the source of truth" (#43b/D1, §6). Any ghost mechanism therefore must not manufacture `InstalledApp` records without bundles.

## Goals / Non-Goals

**Goals:**
- Every generation attempt has a persisted, visible lifecycle on the grid: building → (installed | failed | interrupted), surviving process death.
- The ghost is the doorway back into a running build ("Leave it running" reattach) and into a failure's details.
- Ghost identity is stable from the first moment: up-front launcher id, prompt-derived working title, deterministic hash-derived tile color.

**Non-Goals:**
- Live per-tile progress (stage text/fractions) — BuildStep remains the sole progress surface.
- Resuming an interrupted stream after process death.
- Mascot/animations, generated icons, a browsable history of completed builds.

## Decisions

1. **Separate `PendingBuildStore` keyspace, not `AppIndex` records.** Keys `pending:<launcherId>` + a `pending:order` array on the same MMKV `KVBackend`. Alternative — an `InstalledApp` with a `status` field — rejected: it would put bundle-less records behind `AppIndex.list()` and violate the app-launcher invariant that installed apps are real, launchable records (#43b/D1, research.md §6). The grid composes `pending.list()` + `index.list()` at render time; ghosts sort before installed apps (newest first) so an in-flight build is immediately visible.
2. **Record shape (additive-only discipline):** `{ id, prompt, workingTitle, state: 'building'|'failed'|'interrupted', createdAt, updatedAt, failure?: { reason, diagnostics? }, editingAppId? }`. `workingTitle` = first ~28 chars of the prompt, word-boundary truncated, computed once at creation (pure helper in `prompt-flow.ts`).
3. **Id allocation moves to generation start.** `freshAppId()` is called in `onBuildIt` (new installs only), stored in the pending record, and passed into `deliverResult`, which uses it instead of allocating its own. Fork/edit flows keep their existing id semantics untouched — `editingAppId` marks a rebuild, which spawns no ghost and instead flags the installed tile as building (in-memory derivation from the pending store: a record with `editingAppId` greys that tile).
4. **Lifecycle transitions are single-writer.** Only the `LauncherShell` instance driving `onBuildIt` writes transitions: create(`building`) at request start → delete on delivered/cancel → set(`failed`, failure payload) on terminal failure/stream error. At app launch, any record still `building` is demoted to `interrupted` before first render (the process that owned the stream is gone — a `building` record can never be truthful across a cold start). Alternative — heartbeat timestamps to detect staleness at runtime — rejected as complexity without a second writer to defend against.
5. **Store-is-source-of-truth ordering preserved verbatim.** `deliverResult` still runs `access.install`/`update` (store first, index second) unchanged; the pending record is deleted only *after* successful delivery, so a crash inside delivery degrades to an `interrupted` ghost, never a lost app.
6. **Ghost rendering extends `AppTile` rather than a new component.** `AppTile` already renders monogram + `tileColor` (research.md §1); add a `ghost?: 'building' | 'failed' | 'interrupted'` prop: reduced opacity/desaturation, a small state caption, failed/interrupted get an alert accent. Tile color = deterministic hash of the launcher id onto the existing tile palette — same input the real tile will keep, so the transmute-on-success does not change hue. No X button on the tile face.
7. **Interactions.** Tap building ghost → `setScreen` back to the build screen (the stream still lives in the shell after `onLeaveRunning`, research.md §3 — reattach is a screen-state change, not stream plumbing). Tap failed/interrupted ghost → failure screen (existing `FailureScreen` variant) hydrated from the persisted failure payload, with Retry (new generation from stored prompt — new pending record, same id reused) and Dismiss (delete record). Long-press → the grid's existing tile action affordance, offering Cancel (building) / Dismiss (failed, interrupted). Cancel = existing `onCancelGeneration` abort + record deletion — spec-compliant "no app installed from a cancelled generation".

## Risks / Trade-offs

- [Ghost tap reattach assumes the stream-owning shell instance is still alive] → true within a process lifetime by construction (`ctl.detached`, research.md §3); across restart the record is already demoted to `interrupted`, so the tap route never dangles.
- [Two lists composing one grid can double-render an id during transmute] → delivery deletes the pending record and calls `refresh()` in the same synchronous sequence; grid composition dedupes by id defensively (pending entry wins) with a test.
- [Prompt text may be sensitive; it is now persisted] → same MMKV store that already persists app names/prompt history (#48 territory); no new exposure class, noted for the record.
- [`freshAppId()` is timestamp+random, non-collision-checked (research.md §6)] → unchanged semantics, just earlier; collision risk identical to today.

8. **Rebuild failure on an installed tile.** A pending record with `editingAppId` follows the same lifecycle as any other (failed/interrupted persists until dismissed), but renders differently: the installed tile stays fully launchable (the working version is intact — never greyed like a ghost) with a failure accent; tapping the accent (or long-press → details) opens the failure screen with Retry/Dismiss. Uniform record lifecycle, state-dependent rendering — no silent vanish for "Leave it running" rebuilds either.

## Open Questions

- None blocking. Copy/tone for the three ghost states ("building…", "didn't make it", "interrupted") to be settled at implementation with existing copy.ts conventions.
