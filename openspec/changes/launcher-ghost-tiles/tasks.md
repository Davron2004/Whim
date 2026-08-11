# Tasks — launcher-ghost-tiles

## 1. Pending-build store and pure helpers

- [ ] 1.1 Create `src/host/launcher/pending-builds.ts`: `PendingBuildStore` on the shared `KVBackend` (keys `pending:<id>`, `pending:order`), record shape per design.md decision 2 (`id, prompt, workingTitle, state, createdAt, updatedAt, failure?, editingAppId?`), API: `create`, `get`, `list` (newest first), `setFailed`, `delete`, `demoteBuildingToInterrupted`. Corrupt-record tolerance mirroring `AppIndex.get`'s try/catch.
- [ ] 1.2 Add pure helpers to `prompt-flow.ts`: `workingTitleFromPrompt(text)` (~28 chars, word-boundary truncation) and `ghostTileColorFor(id)` (deterministic hash of launcher id onto the existing tile palette).
- [ ] 1.3 Launch-time demotion: `demoteBuildingToInterrupted()` runs before first grid render (per pending-builds spec — a `building` record can never be truthful across a cold start).
- [ ] 1.4 Node suite coverage in the launcher tests: record lifecycle round-trips, list ordering, demotion, corrupt-record tolerance, working-title truncation, hash-color determinism (same id → same color).

## 2. Generation flow wiring (LauncherRoot)

- [ ] 2.1 Allocate the launcher id in `onBuildIt` for new installs, write the `building` pending record (prompt, working title, `editingAppId` for rebuilds) before the generation request is sent.
- [ ] 2.2 Thread the up-front id into `deliverResult`; delete the pending record only *after* successful delivery (store-first ordering untouched; crash inside delivery leaves an `interrupted` ghost, never a lost app).
- [ ] 2.3 Terminal failure and stream-error paths call `setFailed` with the persisted failure payload; explicit cancel (`onCancelGeneration`) deletes the record.
- [ ] 2.4 Ghost handlers on the shell: tap building ghost → `setScreen` back to the build screen (reattach); tap failed/interrupted ghost → failure screen hydrated from the persisted payload with Retry (new generation, same id reused) and Dismiss (delete record); long-press quick actions Cancel/Dismiss.
- [ ] 2.5 Node suite coverage: id threading (delivered app keeps the ghost's id), failure persistence, cancel deletion, retry reuses id, delivery-ordering test (pending deleted only post-install).

## 3. Grid and tile rendering

- [ ] 3.1 `HomeScreen` composes `pending.list()` + `apps` into one grid — ghosts newest-first before installed apps, defensive dedupe by id with the pending entry winning.
- [ ] 3.2 `AppTile` ghost state: `ghost?: 'building' | 'failed' | 'interrupted'` prop — greyed/desaturated, non-launchable, working-title display, state caption, alert accent for failed/interrupted, hash-derived color stable across transmute, no cancel affordance on the tile face.
- [ ] 3.3 Rebuild rendering: an installed tile with a `building` pending record (matching `editingAppId`) shows the building state; a failed/interrupted rebuild shows a failure accent while the tile stays launchable (design.md decision 8).
- [ ] 3.4 Ghost state copy in `copy.ts` following existing tone conventions.
- [ ] 3.5 Node suite coverage for grid composition (dedupe, ordering, rebuild flagging) via the pure composition logic; keep RN component imports out of the Node suite (pure logic in non-RN siblings).
