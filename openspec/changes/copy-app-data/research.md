# Research digest: copy-app-data — one-time atomic copy of a mini-app's user data into a copy's own store
Paths are relative to the worktree `/Users/davrondjabborov/Work/other/Whim/.claude/worktrees/proposal-copydata/` (`W/`).
## Relevant files
- W/docs/capabilities.md (the map; I read linked-apps in full and grepped mini-app-storage, mini-app-forking, version-history) — W/openspec/specs/linked-apps/spec.md (governing spec) — W/openspec/changes/design-system-v1/tasks.md (RESOLVED note L4, 15.3 L126, 20.3 L167)
- W/src/host/storage-engine/index.ts (device entrypoints `createStorageEngine`, `deleteStorage({appId})`, `peekAppliedSchema`) — engine.ts (`Engine`, `_meta`/`kv`/collection tables, `readAppliedSchema`, `open`) — contract.ts, schema.ts (`AppliedSchema`, `burnedIdFloor`, `diffSchemas`)
- W/src/host/storage-engine/bindings/op-sqlite.ts (device `SqlExecutor`, `open({name:'<id>.db', location:'storage'})`) — node-sqlite.ts (Node `DatabaseSync(filename)`, file-backed in tests)
- W/src/host/launcher/store-access.ts (`install`, `fork` L336-369, `remove` L380-393, `engineAppId` L133) — app-index.ts (`InstalledApp` L28-59, `storageRefCount`/`refCount` L159-167, MMKV-backed)
- W/src/host/launcher/LauncherRoot.tsx (`new StoreAccess({..., deleteStorage})` L408, `onFork` L909-918, `onOpen` L895-899, `demoteBuildingToInterrupted()` L840) — HomeScreen.tsx (share-or-fresh sheet L229, L247-250) — HistoryScreen.tsx (`confirmCopy` L225-232)
- W/src/host/launcher/build-lifecycle.ts (`deliverResult` L220-269, rewind continuation) — pending-purge.ts (soft-delete marker with launch sweep) — generation-request.ts:50 (reads applied schema via `engineAppId`)
- W/src/host/launcher/test/shared-storage.suite.ts and native-storage.ts (file-backed Node-engine harness; op-sqlite fake)
## Current behavior
**1. Identity and lifecycle.**
- A store is keyed by one string, the appId: `storage/<appId>.db` on device (op-sqlite.ts:33; contract.ts:141). The engine never knows about groups.
- The group resolves host-side: `engineAppId(entry) = entry.storageGroupId ?? entry.id` (store-access.ts:133-135), passed as `record.appId` (useMiniAppHost.ts:239; bridge/launch.ts:55).
- One engine is one handle. Each construction calls `open()`, with no cache or pool. Only one realm is live at a time, and `bind()` closes the previous engine first.
- `deleteStorage` calls `db.delete()`. `peekAppliedSchema` opens, runs one SELECT and closes; on device it may create an empty file for an unknown appId (op-sqlite.ts:72-80).
- No PRAGMA is set except Node's `foreign_keys = OFF`, and op-sqlite's `src` has no `journal_mode`. I did not verify op-sqlite's native default journal mode, so I don't know whether `-wal`/`-shm` exist. File-copy safety is unestablished.
- Dependencies are `@op-engineering/op-sqlite ^16.2.0` and `react-native-mmkv ^4.3.1`. There is no react-native-fs or expo-file-system. I grepped only for those names.
- op-sqlite 16 `_InternalDB` exposes `attach({secondaryDbFileName, alias, location?})`, `detach`, `getDbPath`, `loadFile`, `delete`, `executeBatch`, `transaction` and `closeAsync`, plus `moveAssetsDatabase`. It has no backup or copy API. `VACUUM INTO` or `ATTACH` would go through raw `executeSync`. The repo never uses them; the only ATTACH mention is an injection-probe string at storage-engine/test/acceptance.ts:513.
- The engine's "only two DDL forms" rule is enforced by tests that capture the executed statement set (mini-app-storage spec L42).

**2. `_meta`.**
- `_meta(k,v)` holds one row, `applied_schema`, as JSON `{collections:[{id, active:[{id,type}], retired:[{id,type}]}]}` (engine.ts:43,81,232; schema.ts:34-49). It is the accumulated monotone union. There is no separate counter or version field.
- The burned-ID floor is derived as the max ordinal over active and retired columns (schema.ts:64).
- Nothing in the store embeds an appId or group id. `Engine` receives none, and `_meta`, `kv` and the collection tables carry none.

**3. kv vs table data.**
- `kv(k,v)` stores JSON text with a 32 KiB per-value cap (engine.ts:40,82,134). Each collection is a table named by burned ID (`c1`) with `id INTEGER PRIMARY KEY` and columns named by burned field ID (`f1`), typed TEXT/INTEGER/REAL.
- Row `id` is engine-assigned and handed to mini-apps as an opaque reference, so renumbering rowids in a copy could break in-data references. I did not confirm that apps store such ids.

**4. Current fork / "Make a copy" flow (#52).**
- The tile sheet's "Fork" (`COPY.actionFork`) opens a second sheet (HomeScreen.tsx:229, `setForkTarget`). `COPY.forkShareData` calls `onFork(a,{shareData:true})` and `COPY.forkStartFresh` calls `onFork(a,{shareData:false})` (L249-250). `LauncherRoot.onFork` forwards the options to `access.fork(app, undefined, opts)` (L909-912) under `runAppOp` busy-gating, with an Alert on failure.
- `StoreAccess.fork` runs in `serial(repo)`, the per-version-store-repo mutex. It forks in the version store, then builds the entry with id `` `${repo}__${lineageId}` `` (L355), `storeId`, `lineageId`, `forkedFrom`, `storageGroupId = shareData ? (entry.storageGroupId ?? entry.id) : undefined` (L362), and `copyTile`. Then `index.put`; a failed index write after the store fork is not compensated.
- Version-store engine.ts:468-474 mints lineage ids as the first free `fork-<n>` among existing branches. `StoreAccess.remove` never deletes a branch while the repo lives, so a fork id is not reused while its repo exists.
- Other `fork()` callers: HistoryScreen.tsx:228 `fork(app, row.id)` with no opts (fresh data), and the rewind continuation at build-lifecycle.ts:267 with `{shareData:true}`.
- design-system-v1: 15.3 (L126) removes the share-or-fresh sheet and its copy keys and adds "Make a copy" to the `ContextMenu`. 20.3 (L167) makes "Make a copy from here" immediate with fresh data ("Copy made · Open") and removes the confirm sheets. The L4 note says chains 15/20 render both options and wire "Copy the data" to its API behind a feature check, hidden if absent; that API is not defined anywhere I read.
- Tests referencing the sheet being removed: `fork-question-ui.spec.md`, `home-grid-ui.suite.tsx:140-168`, `fork-ui.suite.tsx`, `installed-apps.spec.md` §27-33.

**5. Storage groups.**
- `InstalledApp.storageGroupId?` is the founder's launcher id; absent means its own group. It is immutable after creation, with no join/leave/unlink in v1 (app-index.ts:45-50; linked-apps spec L11). An existing sharer has it set and no file of its own.
- Delete order: `index.remove`, then `deleteStorage(groupId)` only if `storageRefCount(groupId)===0`, then `store.remove(repo)` only if `refCount(repo)===0` (store-access.ts:383-390). The two refcounts are independent.
- No detach API exists; physically it would mean a new appId with its own file. I found no statement about migrating copies already shared under #52.

**6. Limits, atomicity, recovery.**
- The only limit is the 32 KiB kv cap (engine.ts:40). I found no quota on store size or record count. `PRAGMA page_count * page_size` appears only in device-acceptance.ts:122, for measurement.
- No rename or atomic file helper exists for stores; `deleteStorage` is the only file operation.
- Recovery patterns that exist: `demoteBuildingToInterrupted()` at launch (LauncherRoot.tsx:840), the pending-purge marker that completes at next launch and clears only after its last step (pending-purge.ts:5-12,121), and store-first/index-second ordering (store-access.ts:146; build-lifecycle.ts:271-277).
- `engine.open` wraps DDL plus `persistApplied` in one `sql.transaction` (engine.ts:95-102).

**7. Install and appId minting.**
- `StoreAccess.install(spec)` takes `spec.id`, minted upstream as the launcher id allocated at generation start (build-lifecycle.ts:211-213); `seed.ts:54` also calls it. I did not locate the id-generation function.
- A copy's id is minted inside `StoreAccess.fork` (L355) and is deterministic, not random. No `StoreAccess` method touches the storage engine except through the injected `deleteStorage`.
## Constraints and invariants
- #43b D8 gave a fork its own engine appId; #52 reversed that for shared forks. The 2026-10-09 resolution (decisions.md:1452) restores own-appId for every "Make a copy" and keeps groups only for rewind continuations (#53 D5, `shareData:true`, never asked).
- StoreAccess is the one sanctioned version-store path; delivery uses only `install`, `update`, or `fork` then `update`.
- No syscall may gain app- or store-addressing, and the bundle never sees group ids (linked-apps spec L11,21-23), so copying must be host-side only.
- Schema evolution (#38/#40): additive-only, burned IDs never reused, `_meta` stores the accumulated union. A copied store must carry the full union, including retired columns.
- A copy done through SQL outside the engine (ATTACH, VACUUM INTO, file copy) falls outside the captured-statement-set test. I did not read how strict that test is for non-engine paths.
- Node suites cannot import RN native modules, so host code must stay device-free through injection like `DeleteStorage`. Import schema and engine pieces from submodules, not the `storage-engine/index.ts` barrel.
- `serial()` locks per version-store repo, not per storage group, and the source store is keyed by `engineAppId(entry)`, which can differ from the repo.
- A copy's first launch opens through the same `engine.open` diff: an identical schema or older subset runs zero DDL.
- `storageRefCount` counts by `(storageGroupId ?? id)`, so a copy with its own file and no group is a group of one. A pending-purge soft delete keeps the index entry and refcounts until the purge completes (pending-purge.ts:12).
## Integration points
- `StoreAccess.fork` (store-access.ts:336) is where the copy id is minted and the entry is put; a data-copy step would sit between id minting and `index.put`, or after it, inside the `serial(repo)` section. This is a location only, not a recommendation.
- A new injected seam beside `DeleteStorage` in `StoreAccessOptions` (store-access.ts:35-42), wired at LauncherRoot.tsx:408 to `storage-engine/index.ts`.
- `bindings/op-sqlite.ts` and `node-sqlite.ts` for source and destination executors on the shared `SqlExecutor`; `readAppliedSchema(executor)` (engine.ts:58) is a ready-made passive `_meta` read.
- UI: HomeScreen.tsx:229,247-250 and `onFork` (LauncherRoot.tsx:909) are replaced by 15.3; HistoryScreen.tsx:228 is the 20.3 call site. Both go through `access.fork`.
- Recovery hooks: the launch block at LauncherRoot.tsx:837-840 and the pending-purge launch sweep (pending-purge.ts:121).
## Pattern census
Property: a "Make a copy" entry never resolves to the original's physical store. "Resolves" means `engineAppId`, which is `storageGroupId ?? id`.

| site | verdict | test applied |
|---|---|---|
| store-access.ts:362 `storageGroupId: opts?.shareData ? (entry.storageGroupId ?? entry.id) : undefined` | UNSAFE today | `shareData:true` makes the copy resolve to the founder's file. This is the mechanism to retire for copies. |
| store-access.ts:355 fork id `` `${repo}__${lineageId}` `` | SAFE while the repo lives | Version-store engine.ts:468-474 takes the first free `fork-<n>` and `remove` never deletes a branch while the repo lives. A crashed fork leaves an orphan branch, and the next fork takes n+1. |
| HomeScreen.tsx:249 / LauncherRoot.tsx:909-912 (Share row) | UNSAFE | The user-selectable `shareData:true` path for an explicit fork. |
| HomeScreen.tsx:250 / LauncherRoot.tsx:912 (Start fresh row) | SAFE | `shareData:false` gives `storageGroupId: undefined`, so the copy resolves to its own id. |
| HistoryScreen.tsx:228 `access.fork(app, row.id)` | SAFE | No opts, so `storageGroupId` is undefined and the copy has its own file. It does not inherit the group even if `app` is grouped. |
| build-lifecycle.ts:267 rewind continuation `{shareData:true}` | SAFE-by-design | Intended sharing (#53 D5). Out of scope. |
| store-access.ts:150-177 `install` (`id: spec.id`) | SAFE | No `storageGroupId` set, and the id is minted upstream. Not a copy. |
| seed.ts:54 `access.install` | SAFE | Same as install. |
| store-access.ts:192-217 `update` (rebuild) | SAFE | Spreads `...entry`, so `storageGroupId` and `id` carry over unchanged. |
| store-access.ts:279 `rollback` / restore | SAFE | Moves the active snapshot only. No new entry or identity. |
| store-access.ts:133 `engineAppId` | SAFE | The single resolver. Correct if copies never carry `storageGroupId`. |
| useMiniAppHost.ts:239 / bridge/launch.ts:55 | NOT-CHECKED beyond the cited lines | They consume `engineAppId` and don't derive identity. |
| generation-request.ts:50 | SAFE | Reads via `engineAppId`. |

I skipped test-only fixtures and dev-probe screens.
## Risks and unknowns
- I did not verify op-sqlite's journal mode on device, so I don't know whether a file copy needs `-wal`/`-shm` handling. It would need the source handle closed or checkpointed.
- I did not verify that op-sqlite's `attach` works across files under `location:'storage'` on iOS and Android, or that the bundled SQLite supports `VACUUM INTO`. Neither is used in the repo.
- The `native-storage.ts` fake maps each op-sqlite `name` to an in-memory `DatabaseSync`, with no files and no `attach`; `delete()` only drops the Map entry. A crash-mid-copy test there would need the fake extended. `shared-storage.suite.ts` uses real files via `createNodeSqlExecutor(path)`, so partial-file and rename scenarios can be reproduced.
- I did not read `sql-executor.ts`, the full mini-app-storage and storage-schema-evolution specs, or the bodies of decisions #38, #40 and #43b.
- I did not check whether copy can be triggered while the source app's realm is bound.
- I found no cap on store size, so copy cost is unbounded. I did not check free-space behavior.
- I did not find how already-shared #52 copies should be handled.
## Open questions for the planner
1. Is "Copy the data" in scope for the history-screen "Make a copy from here" (20.3, which says "fresh data")? That path copies a past version's code, while the data belongs to the current app.
2. Should the copy's first snapshot schema artifact be reconciled with the copied `_meta`, or is carrying `_meta` over verbatim enough?
3. What happens to copies already sharing a group from #52?
4. Is copying while the source is bound allowed, or must the host guarantee the source engine is closed?
