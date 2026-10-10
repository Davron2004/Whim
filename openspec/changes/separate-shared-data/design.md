## Context

Issue #160 came out of copy-app-data's ruling 5. Before 2026-10-09 "Make a copy" could join the original's storage group (#52 D2), so the copy and the original read and wrote one store. The owner then ruled that copies never share data. copy-app-data left existing shared copies alone, and #160 asks for an explicit "Separate the data" action that snapshots the shared data into the copy's own appId and then takes it out of the group, with a journal and a verified commit point.

Terrain this design rests on, all from research.md:

- Group membership is one optional field, `storageGroupId`, on the entry's record. The store a realm opens is `storageGroupId ?? id` (§Current behavior "The field", "Persistence").
- The only code that still creates a group is the rewind continuation (`continueSharingData`, called from `deliverResult`). `fork` has no sharing option (§"Creating a group today", §"`fork` cannot share").
- A legacy shared copy and a continuation have the same record shape. The suite's "legacy shared copy" fixture is built with `continueSharingData` (§"Legacy copy versus continuation").
- `remove` deletes a group's file only when no index entry resolves to it, and an app in its Undo window still counts (§"Delete").
- `fork(entry, v, { data: 'copy' })` snapshots `engineAppId(entry)`, which for a group member is the group's store, into the copy's own file. The order is journal, stray-file delete, verified snapshot, index entry, journal clear, and the launch sweep settles whatever a dead process left (§"`fork`/`copyData` order", §"Journal", §"Sweep timing").
- A realm captures its engine appId when it launches and never resolves it again (§"Realm captures its appId at launch").
- `StoreAccess.update` writes `{ ...entry, record, tint, icon }` from the entry its caller holds, which can be minutes old (§Pattern census).

Measured for this design, beyond the digest:

- `git show a9b03c47:src/host/launcher/copy.ts` and `git show main:src/host/launcher/copy.ts` both contain `forkShareData: 'Use the same saved data'`, and `main`'s `fork` still takes `shareData`. On the staging branch `git grep shareData -- src` finds only the census test. So every build uploaded so far (tags `release/1.0.0+381237`, `+382511`, `+392403`, `+397438`) can create a shared copy, and the staging branch cannot.
- `gh issue view 152` is OPEN: beta-1 has not gone to testers.
- copy-app-data task 5.5 already plans the device check of a legacy shared copy: install an old build, make a shared copy, install the new build over it, confirm that "copying the shared copy with 'Copy the data' yields an independent app" and that deleting one keeps the other's data.
- `AppIndex.put` writes a new entry in two steps, the record and then the `order` list (`app-index.ts:121-129`). `list()` reads through `order`, `has()` reads the record.
- A tile with a copy or an open in flight "reads busy and opens no menu" (`HomeScreen.tsx:55-57,302`), and a tile whose change is building offers only details and stop (`tile-menus.ts`, `changing`).
- A copy keeps its source's name. `lineageEntry` sets `name: entry.name` and gives it another tint (`store-access.ts:377-391`); the "Copy of Tip Splitter" in `docs/design/system.md` §8 is not what the code writes.

An independent review of the first draft, run against the code, found the two defects D8 fixes and the dependency in D9.

## Goals / Non-Goals

**Goals:**
- Settle #160 from what the code and docs show, and say what the issue becomes.
- Keep the way out of a shared group free of any kill point or ordering that loses data, writes it into the wrong store, binds an entry to a partial or empty store, or deletes a store an entry still resolves to.
- Fix what the review of that route found in the code underneath it.

**Non-Goals:**
- An in-place "Separate the data" action. D11 designs it as the runner-up and says why it loses.
- Any automatic separation.
- Changing rewind continuations. They keep sharing by default (#53 D5, the owner's 2026-10-09 ruling).
- New UI, copy keys or glossary rows.
- Telling the person that two apps share data. That is a product question for the owner (Open Questions).

## Decisions

### D1 — Where a shared copy can exist

On the owner's and Jamila's phones for certain: they are the internal TestFlight group. Build 382511 is also behind the public TestFlight link and in Play closed testing, so a stranger could have installed it. `docs/beta-readiness-2026-09-24.md` records that nobody from the audience had, and the invite waits on #152, but that note is sixteen days old and says nothing about the two later uploads. I could not prove the count is two. The owner's standing rule is that installed pre-release builds are not a compatibility constraint, so the answer does not turn on it.

The more important finding is that the question was framed around the wrong population. Legacy shared copies are a handful of entries on a few pre-release phones. Rewind continuations have the same record, and the launcher makes a new one every time a person goes back to a version and then asks for a change. Whatever this change did to "a copy that shares its original's storage" it would do to every continuation, on every phone, from the first beta on.

### D2 — Alternatives, and the recommendation

| Option | What it takes | What goes wrong | Verdict |
|---|---|---|---|
| (a) Explicit "Separate the data" on the sharing app, in place | A new `StoreAccess` operation that rewrites `storageGroupId`, a changed sweep rule, a menu row, a sheet, new glossary words (D11) | Membership stops being immutable. Every holder of a stale entry object can act on the old group; a realm bound before the commit keeps writing to the group's store; neither the founder nor a last member can use it | Runner-up |
| (b) Automatic one-time separation in the launch sweep | A sweep step over every entry with a `storageGroupId` | It cannot tell a legacy copy from a continuation, so it unshares every continuation at the next launch, against "Rewind continuations share by default" and the owner's ruling. It also splits data without the person asking | Rejected |
| (c) Remove the shared-group path | Delete `storageGroupId` handling | Continuations need it. The part that concerned copies, `fork`'s `shareData`, is already gone on the staging branch | Not available; the removable part is done |
| (d) No new operation: a member is separated by copying it | Nothing new for the route. One requirement that names it, and the fixes in D8 | Two taps more than (a), and the result is a new tile | **Recommended** |

Option (d) gives #160 what it asks for with the mechanism it asks for. "Make a copy" with "Copy the data" from a sharing app snapshots the group's store into the copy's own appId behind copy-app-data's journal and verified commit point, and the copy belongs to no group. Deleting the sharing app is then the ordinary refcounted delete. `data-copy: a legacy shared copy keeps sharing, survives its founder, and copying it gives the group's data its own file` already runs this sequence, and copy-app-data 5.5 runs it on a device.

What (d) does not carry over, and (a) would: the old tile's id, so an app link to it stops working; its grid position (the copy is the newest tile); a "Customize tile" choice (the copy keeps the glyph and takes another tint); and its last-run report. The copy starts from the version the sharing app is on, so if that app was sitting on an older version the copy does not have the later ones. The copy has the same name as its source and both can show the "Copy" pill, so the person tells them apart by tint and position.

What (a) costs is the immutability of group membership, the property that keeps a sharer from waking up on an empty store. I would not trade that for a tile's identity when nobody outside the team is known to have such a copy.

The runner-up is (a), and only for continuations: if the owner decides a person should be able to stop a continuation from sharing while keeping its tile, D11 is the design.

**What #160 becomes.** Closed, with the route as the answer: long-press the app that shares, "Make a copy", "Copy the data", then delete the app you copied from. What is left of it is a product question, filed as #184: nothing in the launcher says that a continuation shares saved data with its original.

### D3 — The route, and what a kill leaves at each step

The route is two existing operations run by the person, each inside `serial(repo)`. Every member of a storage group has the same repo, because a group is only ever joined through a new lineage of the founder's repo, so the two steps and any delivery to a member cannot interleave.

1. `fork(sharer, undefined, { data: 'copy' })`: journal record, stray-file delete, snapshot of the group's store into `<copy>.db`, verification, the copy's index entry, journal clear.
2. Delete of the sharing app: the purge marker, the 10 s Undo window, then `remove` (index entry gone, group file deleted only if no entry resolves to it).

Step 2 cannot start while step 1 runs on the same app: a tile with a copy in flight opens no menu. So a copy that fails cannot be overtaken by its source's delete.

| Kill | On disk at relaunch | What the launch does | Requirement | Test |
|---|---|---|---|---|
| Before the snapshot | Group store whole; at most a journal record | Sweep clears the record | `app-data-copy` "A copy is all-or-nothing across crashes" | existing `data-copy crash: dying at "${point}" leaves no copy or a complete one, and a retry succeeds` |
| Mid-snapshot | A partial `<copy>.db`, its journal record, no entry | Sweep deletes the partial file, clears the record | same | same, and `data-copy crash: a real copy SIGKILLed mid-write is swept away at relaunch, and a retry succeeds` |
| Snapshot complete, copy's entry not written | A complete file nobody points at | Sweep deletes it. The sharing app still shares; the person makes the copy again | same | same crash matrix |
| Between the two writes of the copy's entry | Today: a record the grid never lists, and a store the sweep keeps because `has()` is true. A leak, not a loss. After D8: an id in `order` with no record, which reads as no entry | After D8 the sweep deletes the file and clears the record | `linked-apps` "A group member becomes independent by copying, never by leaving its group", scenario "Killed while the copy's entry is being written" | new `index: a kill between the two writes of a new entry leaves no entry, and the sweep takes the copy's store` |
| Copy's entry written, journal not cleared | The copy, committed | Sweep clears the record only | `app-data-copy`, as above | existing crash matrix |
| Between step 1 and step 2 ("after the snapshot, before leaving the group") | The sharing app, its group and the copy, all whole; nothing pending | Nothing | scenario "Killed between the copy and the delete" | new `group route: a kill between the copy and the delete leaves three whole apps, and a second launch changes nothing` |
| During step 2 | The purge marker; the sharing app's entry present or gone; the group file present | `completeInterruptedPurges` finishes the delete; the group file goes only if no entry resolves to it | "Storage deletion is refcount-gated", and the scenario "Killed while the sharing app is being deleted" | new `group route: a sharer's purge that died part-way keeps the group's store while a member remains, and drops it with the last one` |
| After step 2 | The copy with its data; the group's store with its remaining members, or gone with the last one | Nothing | "Storage deletion is refcount-gated" | existing `store-access §32` (three orders) and the legacy-shared-copy test |
| A build of the deleted app lands after step 2 | Today: `update` re-creates the entry from the caller's object, bound to a group file that may be gone. After D8: nothing | After D8 the delivery is refused before any write | "A launcher record is never written for an entry the index no longer holds" | new `index authority: a build that lands after its app was deleted writes nothing` |

With D8 in, no row leaves an entry pointing at a partial or missing store: the only new entry is written after verification, in one write, and no operation re-creates an entry that was deleted. No row deletes a file an entry resolves to, because both the sweep and `remove` ask the index first.

None of the existing purge tests uses a grouped app (research.md §"Delete, soft-delete and Undo"). `completePurge` falls back to the marker's stored copy of the entry when the index record is already gone, and the group to refcount comes from that copy. The second new `group route:` test covers that branch.

### D4 — What the original keeps

Everything. `copyStore` opens the group's store, sets two connection pragmas and reads; it never writes it (the `§H copy` tests check the source by hash, and the legacy-shared-copy test checks the group file's hash across the copy). The group's file stays under the founder's id until its last member's purge completes. The founder's record, the other members' records and their version history are not touched by either step. Rows a remaining member writes after the copy stay in the group's store and never reach the copy (`data-copy: writes after the copy stay on their own side`).

Requirement: "A group member becomes independent by copying, never by leaving its group", scenarios "A sharer is separated by copying" and "The founder is separated by copying". Test: new `group route: copying a sharer, then deleting it, leaves the founder's store byte-identical and the copy on its own file`, with a founder variant.

### D5 — Writes from a running realm

At this tip no realm is bound when either step runs: Home has none, and opening History unmounts the app and closes its engine (research.md §"History opened from inside a running app"). design-system-v1 chain-19 adds a path to History from the Whim sheet, and whether a realm stays bound there is not verified.

The route does not depend on the answer. The snapshot runs on its own connection as one read transaction, so it sees one committed state (`§H copy: a snapshot is one committed state while another connection is writing`). Stores are in rollback-journal mode, so a write that meets the snapshot's lock waits on the 5000 ms busy timeout that copy-app-data design D8 added to every connection (`§H copy: a live-engine write that meets the snapshot's lock waits for it and succeeds`). A write that commits after the snapshot lands in the group's store, which the sharing app still resolves to, so the person still sees it there. It is not in the copy, and that is what "a copy at copy time" means.

This is where (a) differs most. An in-place separation changes which store the entry resolves to while a realm bound earlier keeps its old engine, so its later writes go into the original's data.

Requirement: `app-data-copy` "Copied data is a faithful snapshot of the whole store", scenario "A consistent snapshot while the source is open". No new test.

### D6 — The launch sweep stays idempotent, and separates nothing

The journal has no states. A record is present or absent, and the sweep's decision is a function of the record and the index: delete the store when no entry is or resolves to the id, then clear. Running it twice, or after a launch that died inside it, gives the same result, and a delete that fails keeps its record for the next launch (`data-copy sweep: a delete that fails keeps its record for the next launch, and the others still settle`; `data-copy sweep: never deletes the store of an id an entry is or resolves to`).

This change adds no step to the sweep. The new requirement says the launch never changes a group, and the route tests relaunch twice (sweep, then `completeInterruptedPurges`, as `LauncherRoot` orders them) and compare every record and file hash.

### D7 — Storage-engine invariants

- A fork gets its own appId. The copy made in step 1 has no `storageGroupId` (`data-copy census: no fork option combination, from a grouped or ungrouped app, sets a storage group`).
- `_meta` stores the accumulated schema. The copy carries the group's whole union, including fields only another member declared and retired fields, and verification refuses a copy that lacks any (`§H copy: a copy whose _meta lost the retired fields is verify_failed and deleted`). The copy's next build allocates above that floor (`data-copy: A and its copy C each add a field above the copied floor, and neither sees the other's`).
- Evolution is additive only. Neither step runs DDL on the group's store. The copy opens with zero DDL under the code of the member it was copied from (`§H copy: a copy opened by older code runs no DDL and keeps every field of the union`).
- The group that remains keeps its own rules: generation reads the group's union and allocates above its floor (`linked-apps`, unchanged).

### D8 — The index is the authority for an existing entry

Three `StoreAccess` operations take an entry object from their caller and write a launcher record from it: `update`, `continueSharingData` and `fork`. None checks that the index still holds that entry. The caller's object can be old. A build's `editing` is read when the sheet opens and used when the build lands.

**The defect.** Take a sharer B with a copy C, so the repo outlives B. B is deleted and its purge completes; if B was the group's last member the group's file goes with it. A build for B that then lands calls `update(editing)`, which finds no index record, falls back to the caller's object and writes it. B is back on the grid, bound to a group file that no longer exists, and its next launch opens an empty store. Behind the tip the same build calls `continueSharingData(editing)` and makes a new entry in that group. A `fork` from a stale object would copy from a store nobody owns; on a device the opener creates a missing source, so the result is a committed empty copy.

I could not show this is reachable through today's menus. A tile whose change is building offers no Delete. But the entry object is taken when the making sheet opens, the sheet can be left with its draft kept, and I did not trace whether a kept draft outlives its app's delete. The data layer should not depend on the answer.

**Decision.** Inside its `serial` section, before any version-store or index write, each of the three operations re-reads the entry from the index. If the index has no record for the id, it rejects with a typed error (`AppGoneError`, exported from `store-access.ts`) and writes nothing. `update` builds the record it writes on the index's current one for `storageGroupId`, the way it already does for `tileOverride`; `fork` and `continueSharingData` resolve the source store and the group from it. A delivery that meets the error fails the way any failed delivery does today: the attempt's record stays and the person can discard it. `deliverResult` asks `isAtTip` before either call, and that read can switch the repo's active lineage in memory; it writes no version and the next operation selects its own lineage.

`remove` keeps taking the caller's entry. It has to work from a purge marker's stored copy after the index record is gone.

**The second defect.** `AppIndex.put` writes a new entry's record and then appends its id to `order`. A kill between the two leaves a record `has()` sees and `list()` does not: the app never appears, and for a copy the sweep keeps its store because `has()` is true. Nothing is lost, but the store and the record leak, and copy-app-data's "the index entry is the commit" is two writes. Decision: `put` appends the id to `order` first whenever `order` does not hold it, and then writes the record. An id in `order` with no record already reads as no entry (`list()` drops it, `has()` is false), so the record write becomes the one commit and the existing sweep cleans a copy that died before it.

**The census.** research.md marks two rows UNSAFE, `update` itself and its call with `editing`. Both are closed by the decision above. Every other writer either reads the index immediately before it writes or writes a new id.

**Why the group comes from the index too.** With membership immutable, the caller's group and the index's agree whenever the entry exists, so this alone fixes nothing today, and the review said as much. It costs one line once the record is re-read, it makes "what the index says" the single rule for these operations, and it is the first thing D11 would need. The tests that matter today are the regression guards: the research found none that reads a member's group, or its data, after a rebuild.

Alternative rejected: refuse in `AppIndex.put` when the incoming group differs from the stored one. `put` cannot tell a resurrection from an install, and failing a finished build over a stale field is worse than using the right value.

Requirements: "No operation on an existing entry changes its storage group" and "A launcher record is never written for an entry the index no longer holds". Tests: the `index authority:` and `index:` cases in tasks 1.3.

### D9 — The copy question must not be skipped for a sharer

copy-app-data task 3.0 (not merged) adds `hasSavedData(appId)` and skips the question, starting fresh, when it is false. A sharer has no file under its own id; its data is under the group's. If the launcher asks about `entry.id`, "Make a copy" on a sharer silently starts fresh, and a person who then deletes the last member has lost the group's data while following the route. The check has to be asked of `engineAppId(entry)`.

That code belongs to copy-app-data chain-3. This change states the rule as a scenario, runs after chain-3, and carries a test that fails if chain-3 got it wrong (task 1.5). copy-app-data's owner should also put the words "of `engineAppId(entry)`" into task 3.0 now; this change cannot edit that folder.

### D10 — No new UI

The route uses rows that exist: "Make a copy" in the tile menu, "Copy the data" in `CopyQuestionSheet`, and Delete with its 10 s Undo. `docs/design/system.md` §8 has no word for two apps using one set of saved data, and this change adds none. Nothing is placed, so §9 is untouched.

### D11 — The runner-up, designed: an in-place "Separate the data"

Recorded so that choosing it later is one proposal pass, not a new investigation.

**Operation.** `StoreAccess.separateData(entry)`, offered only for a sharer (`storageGroupId` set, so never the founder) whose group has at least two members. Inside `serial(repo)`:

1. Re-read the entry from the index. Refuse if it has no group, if the group has one member, or if any entry resolves to the entry's own id.
2. Journal `put({ copyAppId: entry.id, sourceAppId: group, startedAt })`.
3. `deleteStorage(entry.id)`, to clear a stray file.
4. `copyStorage({ from: group, to: entry.id })`, verified as in copy-app-data.
5. `index.put` of the re-read record without `storageGroupId`. The entry exists, so this is one MMKV write; it is the commit.
6. Journal `clear`.

**Deltas to copy-app-data's contracts.** `handoff/storage-copy.md` is reusable unchanged. `handoff/copy-api.md` is not: the sweep and `fork`'s guard treat "an entry exists for the id" as committed, and a sharer's own id always has one. The sweep's rule would become "an entry resolves to the id" (`storageRefCount(id) > 0`) with `index.has(id)` dropped. For a `fork` record the two rules agree once D8's write order is in; they differ for a record `has()` sees and `list()` does not, which today is the half-written new entry and an unreadable record, and there the new rule deletes a store the old one keeps. The guarantee sentence "the store of any appId that has (or resolves to) an entry is never deleted" would lose "has (or".

**Kill points.** Before step 2, nothing happened. Between 2 and 5 the record still names the group, the app's data is whole in the group's store, and the sweep deletes the own-id file whether partial or complete. After 5 the record resolves to a verified store and the sweep only clears the journal. The group's store is never written.

**What it needs that the route does not.**
- Every operation that reads a group from a caller's entry has to read it from the index, not only `update`: `fork`, `continueSharingData` and `remove` do it too. A build opened before the separation would otherwise put the app back in its group, send a continuation into the old group, or copy the old group's store. D8 covers the first three; `remove` working from a purge marker written before the separation stays open.
- No realm of the app may be bound from step 4 until the next launch, and after design-system-v1 chains 18 and 19 that has to be enforced, not assumed (D5).
- It serves neither the founder (its id is the group file's name) nor a last member (leaving would orphan the group file), so the route by copying stays anyway.

**UI.** A tile-menu row "Separate the data" (three words, §8 rule 9) in `ACTIONS_BY_STATE.ready`, shown only when the operation is offered, opening a `fit` sheet built like `CopyQuestionSheet` on `Sheet` and `GroupedRow`: title "Separate the data?", one line "Pour Timer gets its own copy of what's saved now. After that, changes stay in each app.", **Separate** (`ink`) and the close control. It cannot offer Undo at a fair price, which §10 asks for. It needs a glossary row for sharing, and the owner ruled the glossary on 2026-10-09.

**Chains if adopted.** A launcher chain (operation, sweep rule, a crash matrix and a SIGKILLed child as in `data-copy-crash.suite.ts`) after this change's chain-1; a UI chain after design-system-v1 chain-22 and copy-app-data chain-3; an attended device chain after that and after copy-app-data chain-5.

## Risks / Trade-offs

- [A person with a sharing app never finds the route] → True of (a) as well: the launcher does not say that two apps share data, so a row named "Separate the data" would be the first place the idea appears. Filed as a product question, #184.
- [The copy and its source have the same name] → The copy is the newest tile and has another tint. Deleting the wrong one loses nothing: the copy is the one that can be made again.
- [Disk use doubles until the sharing app is deleted] → Same as any "Copy the data". `no_space` fails cleanly and leaves the group as it was.
- [A build for an app deleted meanwhile now ends as a failed attempt] → Safe, and noisier than a silent discard. The shell line owns how an attempt's failure is shown; nothing here changes it.
- [`order` can hold an id that never got a record] → It reads as no entry everywhere, and `put` does not append an id twice. It costs a few bytes for good.
- [Node and the device disagree on a missing source store] → The Node opener rejects with `source_unreadable`; the device opener creates the file and copies an empty store. With D8 no entry resolves to a missing store unless the app never saved anything, where an empty copy is right. copy-app-data 5.3 to 5.5 are the device check.
- [MMKV's single-key write is assumed atomic under a kill] → Inherited from copy-app-data. copy-app-data 5.3 and 5.4 kill the app mid-copy on both platforms.
- [The launch order "sweep before the grid is ready" has no test at the `LauncherRoot` level] → The route relies on it as copy-app-data does. Filed as #183; not fixed here because the rendered-launcher suites belong to the design-system-v1 shell line until chain-22.

## Migration Plan

None. No stored data changes shape and no entry changes group. An `order` list written by an older build reads the same. Rollback is reverting the commit.

Legacy shared copies on a pre-release install keep sharing after the update, as copy-app-data already specifies. A person who wants them apart uses the route.

## Open Questions

1. **Does the owner want the same-tile action anyway?** This design says no. If yes, D11 becomes the change, and it should apply to any sharer, since the record cannot tell a legacy copy from a continuation.
2. **Should the launcher say that a continuation shares saved data with its original?** Today nothing does. The owner's own reason for ending shared copies ("sharing between two apps causes problems") applies to a continuation the person has come to treat as a second app. Out of scope here; filed as #184.
