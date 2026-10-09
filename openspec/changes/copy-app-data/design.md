## Context

The owner ruled on 2026-10-09 (#75's first reversal bullet). "Make a copy" asks "Copy the data, or start fresh?". Both answers give the copy its own storage-engine appId (#43b), and copies never share data again.

Today the only way a copy keeps its original's data is #52's storage group. `StoreAccess.fork(..., { shareData: true })` sets `storageGroupId` to the founder's id (research.md §4, `store-access.ts:362`), so the copy resolves to the founder's file through `engineAppId = storageGroupId ?? id` (§1). Rewind continuations use the same option on purpose (#53 D5, `build-lifecycle.ts:267`).

design-system-v1 chains 15 and 20 are rebuilding the tile menu and History. Its RESOLVED note says they render both answers and wire "Copy the data" to an API that is "hidden if absent". This change defines that API and implements it.

Terrain facts this design rests on (research.md):
- A store is one SQLite file, `storage/<appId>.db`, opened through op-sqlite with no pool. `_meta` holds the accumulated union as one JSON row. Nothing in a store embeds its appId (§1, §2), so a byte copy is valid under a new name with no rewrite.
- kv is a `kv(k,v)` table. Collections are `c<n>` tables with `id INTEGER PRIMARY KEY` and `f<n>` columns. Retired columns stay physically present (§3).
- There is no filesystem library in the dependencies (no rename, no copy, no free-space query). op-sqlite exposes raw SQL (`executeSync` and async `execute`), `attach` and `getDbPath` (§1).
- The fork id is `${repo}__fork-<n>`, where `n` is the first free branch index. Branches are never deleted while the repo lives, so the id is not reused while the repo exists (§4, census row 2).
- Recovery patterns already in use: a persisted marker plus a launch sweep (`pending-purge.ts`), and the launch-time demotion block (`LauncherRoot.tsx:837-840`) (§6).

Measured for this design, beyond the digest:
- op-sqlite 16.2.0 embeds SQLite 3.51.3 (`cpp/sqlite3.h`), and the root `package.json` has no op-sqlite config that would swap in the system SQLite.
- Under Node 22's `node:sqlite` (also 3.51.3), `VACUUM INTO '<abs path>'` copied a table with its row ids intact, and `PRAGMA quick_check` on the result returned `ok`.
- A second `VACUUM INTO` to the same path failed with "output file already exists".

## Goals / Non-Goals

**Goals:**
- One host-side operation that gives a new copy a complete, independent snapshot of its source's user data under its own appId.
- All-or-nothing across process death: no launcher entry ever points at a partial store.
- The copied `_meta` keeps the accumulated union, so the copy's later builds allocate above every pre-copy identity.
- An API with a runtime feature flag that design-system-v1's UI calls.
- Structurally retire "a copy joins its original's group". Fix both UNSAFE census rows.
- Legacy shared copies keep working, untouched.

**Non-Goals:**
- Rewind continuations (#53 D5): unchanged apart from moving to their own named entry point.
- Detaching existing shared copies, or any join/leave/unlink operation.
- Ongoing sync, merge, or "copy data again later". The copy is one-time, at copy time.
- Copying version history. The version store fork is unchanged, and `StoreAccess` stays the only path to it.
- Building the question's visual design. That belongs to design-system-v1 chains 15 and 20. This change supplies the behaviour and wires the choice.

## Decisions

### D1 — Granularity: a SQLite `VACUUM INTO` snapshot of the whole store

The copy runs `VACUUM INTO '<storage dir>/<copyAppId>.db'` on a connection opened to the source's store. The storage directory comes from op-sqlite's `getDbPath()` on that connection.

Why: one statement produces a transaction-consistent snapshot of every page that matters:
- every `c<n>` table including retired columns;
- `kv`;
- `_meta` byte-for-byte;
- row ids, which are `INTEGER PRIMARY KEY` and therefore preserved.

It runs as a read transaction on the source, so a concurrently open source connection is safe: it sees one committed state. It refuses a target that already exists, which gives a free guard against clobbering. On device it runs through op-sqlite's async `execute`, off the JS thread.

Alternatives rejected:
- **Row-by-row through the engine's verbs.** The verb surface cannot see retired columns or orphaned identities (#40), so the copy would silently drop data the union still declares. It would also need a write path that re-assigns ids, risking breakage of the opaque `id` references apps hold (§3). It is O(rows) JS-thread work.
- **Raw file copy.** There is no filesystem library to do it. A file copy also needs the source closed or checkpointed, and handling for `-wal`/`-shm` sidecars whose presence is unverified (§Risks). It is not consistent against a live writer.
- **`ATTACH` plus `INSERT … SELECT` in one transaction.** It is atomic in the destination file, but it has to re-create each table's DDL from `sqlite_master` (a third DDL path next to the engine's two forms) and enumerate tables. `VACUUM INTO` gets the same fidelity in one statement.

The engine's "two DDL forms" rule governs what the Engine emits against a live store. `VACUUM INTO` writes a new file and runs no DDL on the source. It lives in a separate module, `src/host/storage-engine/copy.ts`, outside `Engine`, so the engine's captured-statement test is unchanged. A static check in `checks/` limits the token `VACUUM` to that one module.

### D2 — Atomicity: the launcher entry is the commit point, guarded by a copy journal

There is no rename primitive, so the commit point cannot be a file rename. It is the launcher index entry, which is the only thing that makes an appId launchable. Inside `StoreAccess.fork`'s existing `serial(repo)` section, `{ data: 'copy' }` runs in this order:
1. Version-store fork, then compute `copyAppId = ${repo}__${lineageId}` (unchanged).
2. Journal `put({ copyAppId, sourceAppId: engineAppId(entry), startedAt })`. It is a persisted MMKV list in a new `data-copy-journal.ts` and is written before any file byte.
3. If any index entry resolves to `copyAppId`, abort: that is an invariant violation and must never be overwritten. Otherwise call `deleteStorage(copyAppId)` to clear any stray file (§4 says it cannot exist while the repo lives, but a deleted-then-recreated repo id or a past crash makes this cheap insurance).
4. `copyStorage({ from: sourceAppId, to: copyAppId })` performs the snapshot and verifies it: open the new file, `PRAGMA quick_check` must return `ok`, and `readAppliedSchema(new)` must be a superset of the source union that `copyStorage` reads from the source connection just before the snapshot. Unions only grow, so the copy must contain it. Then close it.
5. `index.put(forkEntry)`. **This is the commit.**
6. `journal.clear(copyAppId)`.

On failure in steps 3–5, call `deleteStorage(copyAppId)`, clear the journal entry, and rethrow a structured error. The orphan version-store branch is left behind, exactly as a failed fork does today (§4); it is invisible and never reused.

On launch, `sweepDataCopies()` runs in the startup block before any realm can bind, next to `demoteBuildingToInterrupted`. For each journal entry: if the index has `copyAppId`, clear the entry. Otherwise `deleteStorage(copyAppId)` and then clear it. Crashes therefore converge to "no copy" or "complete copy".

The order "index entry, then clear journal" also makes a crash between steps 5 and 6 harmless.

Why not put the entry first with a "copying" flag on the record? `StoreAccess.update` rebuilds the record wholesale from the wire and drops host-only fields unless they are passed back. Every launch path would also have to learn a new non-launchable state. A separate journal keeps `InstalledApp` unchanged.

**Durability.** The verify step proves the bytes are readable before the commit. Power loss after the commit is covered by running the snapshot connection with `PRAGMA synchronous=FULL` before `VACUUM INTO`. The on-device probe (tasks 1.5, 5.1–5.2) confirms the output survives a kill right after the statement returns. If it is not, the fallback is to open the new file and run one `BEGIN IMMEDIATE; COMMIT` under `synchronous=FULL` before the commit.

### D3 — API and feature flag

- `StoreAccess.fork(entry, versionId?, opts?: { data?: 'fresh' | 'copy' })`. The default is `'fresh'`. There is no sharing parameter.
- `StoreAccess.continueSharingData(entry): Promise<InstalledApp>` is the continuation-only seam that sets `storageGroupId = entry.storageGroupId ?? entry.id`. `build-lifecycle.ts:267` moves to it.
- `StoreAccessOptions.copyStorage?: CopyStorage`, injected beside `deleteStorage`. The device implementation lives in `storage-engine/copy-device.ts`, wired at `LauncherRoot.tsx:408`. Node suites inject the `node:sqlite` implementation.
- `readonly canCopyData: boolean` is `copyStorage !== undefined`. This is the feature check that design-system-v1 15.3 and 20.3 read. If those chains land first, they gate on whatever placeholder they define, and chain-3 of this change replaces it with `canCopyData`.
- Errors are `DataCopyError` with kind `no_space` (SQLITE_FULL), `source_unreadable` (open or read failure), `verify_failed`, or `io`. The kind comes from SQLite's result code where the binding exposes it, otherwise `io`; tests drive each kind.

The flag is a runtime property of the constructed instance, not a build constant, so tests can exercise both shapes. A build without the seam is coherent.

### D4 — Schema: carried verbatim, no reconciliation

The copied `_meta` is the source's union, unchanged. The copy's first snapshot artifact is either the current version's schema (a subset of the union) or an older version's (an older subset, from History). Both open with zero DDL through the existing `engine.open` diff (research.md §Constraints). Fields the older code does not know stay hidden and are not lost, exactly like rollback, and History's existing hidden-data line applies.

Generation for the copy already reads `readApplied(engineAppId(copy))` (`generation-request.ts:50`), which is now the copy's own union. New fields therefore land above the pre-copy floor.

After the copy, both sides allocate independently, and numerically equal post-copy ordinals in the two stores are fine because stores never merge (mini-app-forking: "never require merging"). A copy of a copy carries one union again. No cross-store allocation registry is introduced.

### D5 — The #52 code path and legacy shared copies

- The Home share-or-fresh sheet's "Share" row (census UNSAFE) is removed. design-system-v1 15.3 already deletes the whole sheet. If 15.3 has not merged when this change's UI chain runs, chain-3 removes the row.
- `fork`'s `shareData` (census UNSAFE) is deleted. It is not deprecated. A test drives every `fork` option combination and asserts `storageGroupId` is undefined.
- Existing shared copies are left as they are. `storageGroupId` is immutable by spec, refcounted delete already protects both members, and any auto-detach would either duplicate data the person expects to see in both apps or split it unexpectedly. A bug there would lose user data. Copying such a copy snapshots the group's store (D1 reads `engineAppId(entry)`), so a person can still get an independent copy. No migration step runs. Whim is pre-release, so the population is at most the owner's and testers' devices.

### D6 — kv and table data

Both live in the one file, and `VACUUM INTO` takes both. Nothing distinguishes them in the copy path. The 32 KiB kv cap is a per-value write-time cap, already satisfied by the source.

### D7 — Size and time

There is no size cap: a cap would refuse to copy data the person already holds. The real limit is free space, which surfaces as SQLITE_FULL and then `no_space`, with cleanup per D2.

`VACUUM INTO` runs through op-sqlite's async `execute` on its worker thread, so the shell stays responsive. The control shows busy and is re-trigger-guarded by the existing `runAppOp` gate.

The budget is 50 MB in at most 5 s on the reference emulator and simulator, measured by the probe (tasks 5.1–5.2). Real stores are expected to be far smaller (kv values capped, records typed). There is no cancel in v1. A pre-flight size estimate (`page_count * page_size`) is logged to the `storage` channel for diagnostics only.

### D8 — Where the source connection comes from

The snapshot opens its own connection to the source by name. SQLite allows several connections to one file, and `VACUUM INTO` on a reader is consistent against another connection's writes. The probe (tasks 1.5, 5.1) confirms op-sqlite opens a second native connection for the same name (§Risks says this is unverified).

If op-sqlite refuses or shares the handle, the fallback is that the launcher unbinds the source realm before calling `fork({ data: 'copy' })`. Home and History are already outside a bound realm, so only a copy started from inside a running app would need that step.

## Risks / Trade-offs

- [op-sqlite may not allow a second connection to an open store, or `getDbPath` may differ between platforms] → The on-device probe (tasks 1.5, 5.1–5.2) checks this on Android and iOS before the end-to-end checks. D8's fallback (unbind first) is fully specified.
- [`VACUUM INTO` output may not be fsynced on return] → `synchronous=FULL` on the snapshot connection, confirmed by the probe, with D2's explicit commit-transaction fallback. Verification before the commit catches anything unreadable.
- [The sweep deletes a file it should not] → It deletes only appIds that appear in the journal, which this code wrote moments before minting the id. It never deletes based on directory listing or refcount. A test asserts the sweep cannot touch an id that has an index entry.
- [design-system-v1 deltas contradict the owner ruling] ("created at once with no question", "starts with empty data") → They are flagged in Open Questions. If they are archived unamended, `app-launcher` and `app-data-copy` disagree, and that must be fixed before design-system-v1 archives.
- [Crash between version fork and index write leaves an orphan branch] → This is pre-existing behaviour (§4). The branch is invisible and never reused, so it is not addressed here.
- [A copy of a large store doubles disk use] → This is inherent to independent copies. `no_space` is honest and the original is unaffected.
- [A `VACUUM` outside the engine is a new SQL path] → It is confined to one module by a static check. Its target path is a bound parameter (`VACUUM INTO ?`, verified under node:sqlite 3.51.3) built only from host-minted ids, never a bundle value.

## Migration Plan

There is no data migration. Legacy shared copies keep their group (D5).

Deploy follows the normal ordering: the engine and launcher chains land first and are safe with no UI because `canCopyData` gates the option, then the UI wiring, then the on-device verification.

Rollback means not injecting `copyStorage`. `canCopyData` becomes false and the question collapses to "Start fresh". Copies already made are ordinary single-member stores and need nothing.

## Open Questions

1. **design-system-v1 deltas.** Its `specs/app-launcher` "Forking creates an independent launcher entry" (scenario "No share question is asked") and `specs/version-history` "Any version can become its own app at once" ("starts with empty data") predate the RESOLVED note. Should design-system-v1's owner amend them to "asks Copy the data or start fresh (see `app-data-copy`)" before it archives? Recommended: yes. This change does not edit another change's folder.
2. **History copy from an old version.** This design asks the same question there, and the data is the app's current data under the old code, with the hidden-data line. Confirm this is wanted rather than History copies always starting fresh.
3. **No data, no question?** When the source has never stored anything, should the question be skipped? This design always asks, following the owner's words.
4. **Budget.** Is 50 MB in 5 s on the emulator and simulator the right bar, or should the probe target a physical mid-range Android device?
5. **Legacy shared copies.** Should a later change offer a person-initiated "Separate the data" action? It is out of scope here, and nothing changes for them now.
