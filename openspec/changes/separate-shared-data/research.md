# Research digest: can a legacy shared-group copy be turned into an independent app (#160), and what must a "leave the group" write respect?
`W/` below means `/Users/davrondjabborov/Work/other/Whim/.claude/worktrees/separate-shared-data`. Your `git` check puts the tip at `6c9b56b6`, so I take that over my earlier `f72bebce`. I had no Bash, so nothing here comes from git history.
## Relevant files
- W/src/host/launcher/app-index.ts: `InstalledApp.storageGroupId?: string` (L50); `put` (L121-129); `storageRefCount` (L165-167); `AppIndex` is constructed once, at LauncherRoot.tsx:514.
- W/src/host/launcher/store-access.ts: `engineAppId` (L167), `install` (L184), `update` (L226), `fork`/`copyData` (L412-470), `continueSharingData` (L491), `sweepDataCopies` (L506), `remove` (L525).
- W/src/host/launcher/data-copy-journal.ts: `DataCopyJournal` and `sweepDataCopies`.
- W/src/host/storage-engine/{copy.ts,copy-contract.ts,copy-device.ts,copy-node.ts,busy-timeout.ts,index.ts}: `copyStore`, `deleteStorage`.
- W/src/host/launcher/build-lifecycle.ts:220-269 (`deliverResult`), LauncherRoot.tsx (sweep L1006-1044; `openCompose` L1507-1513), pending-purge.ts, soft-delete.ts.
- UI: tile-menus.ts:56-57, HomeScreen.tsx:208-258,366-372, CopyQuestionSheet.tsx (props: `visible, appName, onCopyData, onStartFresh, onClose`; built on `Sheet`, `GroupedSection`/`GroupedRow`), HistoryScreen.tsx:225-232.
- Governing docs: docs/decisions.md:637-653 (#52), :667 (#53 D5), :1452 (#75 owner ruling); openspec/specs/linked-apps/spec.md:11; openspec/changes/copy-app-data/{proposal.md:45,design.md,tasks.md:65-87,chains.md:61-75}.

## Current behavior
- **The field.** Group membership is the `storageGroupId` field on the app record. It holds the founder's launcher id; absent means the app has its own store. The engine appId is `entry.storageGroupId ?? entry.id` (store-access.ts:167-169).
- **Persistence.** The record is one JSON blob under MMKV key `app:<id>` in instance `whim.launcher`, plus an `order` key. Writing an existing record is one `kv.set` and no order write (app-index.ts:61-63,121-129; LauncherRoot.tsx:512-514).
- **Creating a group today.** The only code that writes `storageGroupId` is `lineageEntry` (store-access.ts:377-391). Its only grouped caller is `continueSharingData` (L491-499), which passes `this.engineAppId(entry)`, so the group id is always the original founder. The only production caller is `deliverResult` (build-lifecycle.ts:264-268). That path runs when the person rewound to an older version and then prompted a change. It is silent and never asked.
- **`fork` cannot share.** `ForkOptions` is `{ data?: 'fresh' | 'copy' }` (store-access.ts:61-63), and `fork` writes an ungrouped entry (L427). Non-test `.fork(` callers are LauncherRoot.tsx:1098 and HistoryScreen.tsx:228 (fresh, no options). No UI at this tip can create a shared copy. The share row is gone from COPY (task 15.3, design-system-v1/tasks.md:126).
- **Legacy copy versus continuation.** Both have the same record shape (`storageGroupId`, `forkedFrom`, `storeId`, `lineageId`). The test fixture for "legacy shared copy" is literally `continueSharingData(a)` (data-copy.suite.ts:207-208).
- **Builds that could create a shared copy.** You report that `forkShareData: 'Use the same saved data'` is present at `a9b03c47` and still on `main`, so every uploaded build could create one (planner-verified). Uploads: TestFlight 381237 and 382511 (`a9b03c47`, 2026-09-23) in internal group `Team` (Davron, Jamila), and 382511 in external group `Public beta` with a public link, Beta-App-Review approved. Play closed testing (`alpha`) has 382511 (docs/beta-readiness-2026-09-24.md:18-22). The same file says "Nobody from the audience has installed the app yet: they're on the waitlist" (L16-17). #152 is still step 5 of the handoff (docs/handoff-2026-10-09.md:110).
- **Owner ruling (docs/decisions.md:1452, inside #75, also design-system-v1/tasks.md:4).** Quote: "RESOLVED by the owner 2026-10-09 ... both give the copy its own storage-engine appId (never shared — sharing between two apps causes problems); "Copy the data" is a one-time copy into the new appId (change `copy-app-data`). Storage groups stay only for rewind continuations." copy-app-data/proposal.md:45 ruling 5: a "Separate the data" action is "out of scope — tracked as a backlog GitHub issue". handoff:115 lists #160 as an owner decision pending. I found no written ruling on whether or how to separate.
- **Delete.** `remove` (store-access.ts:525-538), inside `serial(repo)`: `groupId = engineAppId(entry)`; `index.remove(entry.id)`; `deleteStorage(groupId)` only if `index.storageRefCount(groupId) === 0`; then the repo is dropped if `refCount(repo) === 0`.
  - `storageRefCount` is derived on read from the index (app-index.ts:165-167). It counts `(a.storageGroupId ?? a.id) === groupId`.
  - A soft-deleted app stays in the index until its purge completes (pending-purge.ts:13), so it still counts.
  - Deleting the founder keeps the file `A.db`, named after the founder, for the survivors.
- **Schema in a shared store.** `engine.open` diffs each launch's artifact against the one `_meta` union (engine.ts:88-106). The column set only grows. Active versus retired is last-writer-wins: a tombstone retires a column, and a later same-typed reappearance reactivates it (schema.ts:270-276,313-318). A conflicting artifact aborts the launch (linked-apps spec L43-52). Generation reads the union via `readApplied(access.engineAppId(editing))` (generation-request.ts:50).
- **`fork`/`copyData` order** (store-access.ts:412-470), inside `serial(repo)`:
  1. Version fork.
  2. Refuse if `index.has(copyAppId) || storageRefCount(copyAppId) > 0` (L421).
  3. Journal `put`.
  4. `deleteStorage(copyAppId)`.
  5. `copyStorage({from: engineAppId(entry), to})`.
  6. `index.put(forkEntry)`. This is the commit.
  7. Journal `clear`.
  - A failure before the commit goes through `discardCopy` (L474-482): `index.remove`, `deleteStorage`, then journal `clear`.
- **Journal** (data-copy-journal.ts:21-75). One MMKV key per copy, `datacopy:<copyAppId>`. Record shape: `{ copyAppId, sourceAppId, startedAt }`. There is no state field; presence is the only state. The sweep (L97-110) skips in-flight copies. For each record it deletes the store only if `!(index.has(id) || storageRefCount(id) > 0)` (`hasEntry`, L87-89), then clears the record.
- **Sweep timing.** In the mount effect, `demoteBuildingToInterrupted`, then `access.sweepDataCopies()`, then `completeInterruptedPurges`, `seedFirstRun`, `refresh()`, `setReady(true)` (LauncherRoot.tsx:1006-1044). The grid is gated on `ready`. I found no test of that ordering at the LauncherRoot level.
- **`copyStore` steps** (copy.ts:132-187):
  1. Refuse bad ids and `from === to`.
  2. Open the source and read its `_meta`.
  3. `PRAGMA synchronous = FULL` and `busy_timeout = 5000` on the source.
  4. One `VACUUM INTO ?` to `${source.dir}/${to}.db` (L165). It is one read transaction and keeps row ids, retired columns, kv and `_meta`.
  5. Open the copy and check `quick_check = ok` and `isSupersetSchema`.
  - A non-empty existing target is refused as `io` and left untouched (L167-170); a zero-byte target is overwritten. Any other failure after writing deletes the target.
- **Busy timeout and journal mode.** `BUSY_TIMEOUT_MS = 5000` (busy-timeout.ts:12), set on every connection (bindings/op-sqlite.ts:56). Stores run in rollback-journal mode, not WAL, so a snapshot's read lock made live-engine writes throw until the timeout was added (copy-app-data/progress.md:19-47).
- **Realm captures its appId at launch.**
  - `onOpen` stores `engineAppId: access.engineAppId(app)` in screen state (LauncherRoot.tsx:1081).
  - `MiniAppView` → `deliverBySource` → `bind` → `launchApp({...record, appId: engineAppId}, createStorageEngine)` (useMiniAppHost.ts:238-248; bridge/launch.ts:55-77).
  - Storage syscalls read `realm.engine` per call (bridge/rows.ts:74-82). The appId is never re-resolved.
  - One realm is live at a time; `bind` closes the previous engine.
- **History opened from inside a running app (answer to 2a).**
  - The realm is **not** bound while History shows. `onHistory` replaces `screen` with `history` (LauncherRoot.tsx:1105-1107; `stackFor` L296 returns `[home, history]`). `MiniAppView` unmounts and its cleanup calls `tearDownLiveRealm`, which closes the engine (useMiniAppHost.ts:385-388; teardown.ts:40-51).
  - HistoryScreen.tsx:6-8 says the same.
  - The Whim-sheet path (design-system-v1 chain-19) is not merged. I did not verify whether History from that sheet keeps a realm bound.
- **Delete, soft-delete and Undo (answer to 2b).**
  - `onDelete` → `purgeWindows.armApp(entry)` (LauncherRoot.tsx:1120) → `purges.armApp` writes `purge:app:<id>` holding a JSON copy of the entry (pending-purge.ts:48-50).
  - Undo only deletes the marker (soft-delete.ts:54-62) and does not re-put the entry.
  - When the 10 s toast ends, `finish` → `completePurge` → `access.remove` (pending-purge.ts:109-119). `completePurge` takes `index.get(id) ?? marker.entry`.
  - After process death, `completeInterruptedPurges` (pending-purge.ts:123-135, called at LauncherRoot.tsx:1023) finishes it. A purge that fails keeps its marker.
  - Tests (store-access.suite.ts): `purge: a delete armed when Whim closed completes at the next launch, leaving nothing` (L676); `purge: Undo clears the marker, so the next launch leaves the app whole` (L693); `purge: a purge that died part-way is finished from its marker at the next launch` (L705). Also `undo windows: Undo cancels the purge; the window's end runs it once; ...` (app-busy.suite.ts:207), `delete: the tile leaves at once; Undo restores it whole and it still opens; nothing is removed during the window` (launcher-interactions.suite.tsx:202), and `data-copy: deleting the original, its purge complete, keeps the copy's data and lets it launch` (data-copy.suite.ts:184). None of these involves a grouped app.

## Constraints and invariants
- linked-apps spec L11: membership is "immutable thereafter (no join/leave/unlink in v1)". copy-app-data's delta adds that nothing "SHALL detach them or move their data automatically" (copy-app-data/specs/linked-apps/spec.md:4). Rewind continuations "share by default" (live spec L25-30; #53 D5, decisions.md:667).
- The live linked-apps and app-launcher specs (app-launcher spec.md:72-104) still describe join-at-fork until copy-app-data and design-system-v1 archive.
- Group id equals the founder's launcher id, which is also the group file name (`A.db`), and it persists after the founder is deleted (#52 D3, decisions.md:643).
- `StoreAccess` is the only path to the version store. Operations on one repo run in `serial(repo)`. Node suites must import storage-engine submodules, never the barrel. The token `VACUUM` may appear only in copy.ts (copy.suite.ts:495).
- The commit point of the existing copy flow is one `kv.set` on `app:<id>`. MMKV's crash-consistency for that write is UNVERIFIED.

## Integration points
- A leave-group write is one `index.put` of the member record without `storageGroupId`.
- Reusable as-is: `copyStorage({from: groupId, to: memberId})` and `deleteStorage` (a copy.ts:92-96 id check applies).
- `copyData`'s guard (L421), the stray-file `deleteStorage(copyAppId)` (L454) and the sweep's `hasEntry` rule do not fit a member whose own id already has an entry:
  - the guard would refuse;
  - the sweep would clear the journal record and leave a half-written `<memberId>.db`;
  - `deleteStorage(memberId)` opens and deletes the member's own file, which is not its store while grouped.
- Orphaned group file: after the last member leaves, `storageRefCount(founderId)` is 0, and only `remove` (L530-531) deletes the group file.
- The founder cannot leave by snapshotting into its own id, because its id is the group name.
- Menu rows: `ACTIONS_BY_STATE.ready` in tile-menus.ts:56-57, handlers in HomeScreen.tsx:236-258. History actions: HistoryScreen.tsx:480-486 (old screen; chain-20 rewrites it).
- system.md §8 glossary (L690-704) has no row for data, separate or share. Its §9 History row (L767) says "a copy starts with its own fresh data" and is stale, and handoff:79-80 says chain-20 must update it. §8 Rules (L706-713) include "Say what happened in the person's terms, never internals" and "buttons ≤ 3 words". §10 L788: "Offer Undo". No tile or History affordance shows that two apps share data (grep of `src/host`).
- Tests nearest a shared pair:
  - data-copy.suite.ts: `data-copy: a legacy shared copy keeps sharing, survives its founder, and copying it gives the group's data its own file` (L202); `data-copy: deleting a sharer keeps its founder's data (a legacy group, either order)` (L230); `data-copy census: no fork option combination, from a grouped or ungrouped app, sets a storage group` (L243).
  - store-access.suite.ts: `§27 engineAppId resolves storageGroupId ?? id` (L349), `§29 a fork gets no storageGroupId` (L358), `§30 a continuation of a continuation resolves to the ORIGINAL founder` (L368), three `§32` delete-order tests (L379,388,397).
  - data-copy-crash.suite.ts: the sweep tests (L143,160,183), `data-copy crash: dying at "${point}" leaves no copy or a complete one, and a retry succeeds` (L213), `data-copy crash: a real copy SIGKILLed mid-write is swept away at relaunch, and a retry succeeds` (L317), `data-copy: a stray file under the copy's id never reaches a "${data}" copy` (L383). Also shared-storage.suite.ts §1-§4, app-index.suite.ts L83-92, and the generation-request.suite.ts continuation cases.
  - Helpers are in test/data-copy-rig.ts; suites are registered at test/acceptance.ts:111-112.
- Sequencing:
  - Merged: design-system-v1 chains 1-16 and 23. The handoff lists fix chains 16c-16i; the worktree's progress.md ends at 16h.
  - Chains 17-22 form a strict line and share `LauncherRoot.tsx` and `copy.ts` (design-system-v1/chains.md:14-16,172-224). 17 making-progress: pages, prompt-flow. 18 opening: MiniAppView, useMiniAppHost, boot-state, deliver, webview-pool. 19 running-app: Orb, WhimSheet, MiniAppView. 20 history: HistoryScreen, history-logic, ConfirmSheet; rewrites History. 21 copy-and-cleanup: copy.ts and every screen's strings. 22 shell-motion: HomeScreen, HistoryScreen, MakingSheet, Orb. 24 is attended verification.
  - copy-app-data chain-3 (tasks 3.0-3.4, 4.1-4.2) is **not merged**. It touches HomeScreen, HistoryScreen, LauncherRoot, copy.ts, CopyQuestionSheet, the UI suites, and the storage-engine module for `hasSavedData`. It is `after` chain-20, so it is blocked. Chain-5 follows it.

## Pattern census
Property: a write of an existing launcher entry can change which store it resolves to (change, drop or re-add `storageGroupId`). Sink: `AppIndex.put` (app-index.ts:123), the single `app:` writer, which has no check against the current group. The only `AppIndex` is built at LauncherRoot.tsx:514; all other `whim.launcher` keys use other prefixes. App.tsx has no `AppIndex`, `StoreAccess` or `app:` use (grep).

| file:line | verdict | test applied (where the written object's group comes from) |
|---|---|---|
| store-access.ts:249 `update` | UNSAFE | `{ ...entry, record, tint, icon }` spreads the caller's `entry` (L246); only `tileOverride` is re-read from the index (L244-249). The group is whatever the caller held. |
| build-lifecycle.ts:265 `update(editing)` | UNSAFE | `editing` is the index snapshot taken at `openCompose` (LauncherRoot.tsx:1512), kept as `opening.editing` (L2309) through clarify, plan and the stream, and passed to delivery at L2440-2443. Stale by minutes. |
| build-lifecycle.ts:268 `update(continuation)` | SAFE | The object just returned by `continueSharingData` (L495-496), a new id; the group equals the index value. |
| store-access.ts:211 `install` | SAFE | No group on the object; overwrites an existing id without a check. Callers: seed.ts:54 (guarded by `index.has`, L47) and build-lifecycle.ts:246 (attempt id allocated before the request). Id-format collision with a fork id NOT-CHECKED. |
| store-access.ts:428 `fork` commit | SAFE | New id; L421 refuses an existing one; never sets a group. |
| store-access.ts:496 `continueSharingData` | SAFE | New id from a new lineage, group from `engineAppId(entry)`. No `index.has` guard like L421, so safety rests on fork-N uniqueness. |
| app-index.ts:143 `setTileOverride` and :153 `clearTileOverride` | SAFE | `{...app}` where `app = this.get(id)` is read from the index immediately before the `put`, with no await between. Callers LauncherRoot.tsx:1136,1140 pass only an id. |
| pending-purge.ts:49 `armApp` | SAFE | Writes `purge:app:<id>`, not `app:`; stores a snapshot copy of the entry. The copy is used at pending-purge.ts:111 only when the index has none. Undo never re-puts it. |
| store-access.ts:476 `discardCopy` `index.remove` | SAFE | Removal only, of the entry the failed copy just wrote (the id passed the L421 guard). |
| rollback (store-access.ts:313), tile pickers, app-links, seeding | SAFE | Version store only, id-only, or routed through `install`. No rename or import path exists (no other `.put(` in `src/host` non-test). |

Callers of `update` in `src/`: only build-lifecycle.ts:265 and :268 (grep of `access.update(`). Both are reached from `deliverResult`, called by `deliverAndSettleIfOwned` at LauncherRoot.tsx:2440. Retry paths at L2555 and L2646 re-read `index.get(current.editingAppId)` when the retry starts.

Tests asserting that a member's `storageGroupId` survives `update`, `rollback`, a tile change or soft-delete plus Undo: **none found**. In `src/host/launcher/test`, `storageGroupId` appears only in the creation, immutability and delete-order assertions above, data-copy.suite.ts, and fixtures (app-index.suite.ts:85, data-copy-crash.suite.ts:167). build-lifecycle.suite.ts only stubs `continueSharingData`. store-access.suite.ts:407 (`§34 update ...`) and the purge tests use ungrouped apps.

## Risks and unknowns
- Stale-entry rewrite: a group change made in the index between `openCompose` and delivery would be overwritten by `update` with the old group. This is harmless today only because membership is never changed after creation.
- A continuation and a legacy copy cannot be told apart from the record. I looked for no other discriminator, such as a name pattern or timestamps.
- UNVERIFIED: MMKV single-key atomicity under a kill; `deleteStorage` repeat-safety on device (documented only, index.ts:43-47); whether the Whim-sheet History path keeps a realm bound after chain-19; whether a stray `<memberId>.db` can exist for a grouped member.
- I did not check how a separation should treat a member whose purge is armed. The marker's stored entry copy carries the old group (pending-purge.ts:49), and `completePurge` prefers the index record.
- Unmeasured: store sizes for shared groups versus the 5 s budget (the probe measured 70 MB in 175-595 ms).

## Open questions for the planner
1. Is separation in scope for rewind-continuation members, or only members the person considers legacy copies? The record cannot say which is which.
2. Which write is the commit point, given the sweep and guard treat "an entry exists for the id" as committed and a member's own id always has one?
3. Who owns the group file when the last remaining member leaves after the founder was deleted?
4. Can a founder ever separate, or only sharers?
5. How should `update` and soft-delete treat a record whose group changed after the caller read it?
