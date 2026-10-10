## Why

Issue #160 asks for an explicit "Separate the data" action that turns a copy still sharing its original's storage into an independent app: snapshot the shared data into the copy's own appId, leave the group, and do it with copy-app-data's crash safety. Before sizing that, this change had to settle whether such a copy exists anywhere that matters and what the smallest correct answer is. The answer is that the result #160 wants is already reachable with the machinery copy-app-data merged, and that the action as written would give up the immutability of group membership to keep the same tile.

What the research found (research.md, design.md D1):

- Storage groups are not a leftover. A rewind continuation joins its original's group on purpose, silently, every time a person goes back to an older version and then asks for a change (`build-lifecycle.ts`, `continueSharingData`). The owner's ruling keeps that: "Storage groups stay only for rewind continuations."
- A legacy shared copy and a rewind continuation have the same record. Nothing on the entry says how it joined its group, and the tests build the "legacy" case with `continueSharingData`. No code can separate one kind and spare the other.
- "Make a copy" cannot create a shared copy on the staging branch any more (`fork` has no sharing option; the census test drives every option). `main` and every uploaded build (381237, 382511, 392403, 397438) still can. Those builds are on the owner's and Jamila's phones. Build 382511 is also behind the public TestFlight link and in Play closed testing; the 2026-09-24 readiness note says nobody from the audience had installed it, and #152 (sending beta-1 to testers) is still open.
- A person who wants an independent app from a sharing one already has a route: "Make a copy", "Copy the data", then delete the app they copied from. The copy reads the group's store, lands in its own file behind the journal and the verified commit point, and never joins a group. `data-copy.suite.ts` runs that whole sequence today, and copy-app-data task 5.5 runs it on a device.

So an automatic separation would unshare every continuation, removing the shared-group code is impossible, and the in-place action buys only the tile's identity.

Attacking that route against the code then turned up two defects under it and one dependency, and those are what this change builds.

## What Changes

- **No "Separate the data" action, and no automatic separation.** A storage-group member becomes independent by copying it. Its group stays what it was when the entry was created. This is the recommendation of design.md D2; the in-place action is the runner-up, and D11 designs it far enough to implement if the owner wants it anyway.
- **The supported route becomes a requirement** in `linked-apps`, with a scenario for each case a person can be in: a sharer beside its founder, the last member of a group, and the founder itself (which an in-place action could never serve, because the group's file carries the founder's id).
- **Fix: a build can no longer re-create a deleted app.** `StoreAccess.update`, `continueSharingData` and `fork` write a launcher record from the entry object their caller holds and never check that the index still has it. When another entry keeps the version history alive, a build that lands after its app was deleted puts the app back on the grid, bound to a group file that may be gone, and its next launch opens an empty store. The three operations now re-read the entry inside their serialized section, refuse with a typed error when it is gone, and take the storage group from the index's record.
- **Fix: a new entry is committed by one write.** `AppIndex.put` writes a new entry's record and then its place in the order list. A kill between the two leaves a record the grid never shows, and for a copy a database file the sweep keeps for good. The order is written first, so the record is the commit and the existing sweep cleans up.
- **Guard: the copy question is not skipped for a sharer.** copy-app-data's unmerged task 3.0 skips "Copy the data, or start fresh?" when the app has no saved data. A sharer's data is under its group's id, so the check has to ask about the store the entry resolves to. If it asked about the entry's own id, a sharer's copy would silently start fresh, and deleting the last member would then lose the group's data. A scenario and a test pin it; the fix, if needed, is one argument.
- **Tests that did not exist.** Nothing today reads a group member's group or data after a rebuild, a rollback, a tile change or delete plus Undo, and none of the purge tests uses a grouped app.
- **#160 is closed** with the route as its answer. The question it leaves open is a product one and has its own issue, #184: nothing in the launcher tells a person that a continuation shares saved data with its original.

No UI, copy key, syscall, storage-engine or version-store change. No data migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `linked-apps`: three added requirements. A group member is made independent by copying it and never by leaving its group, at a person's request or automatically. No operation on an existing entry changes its storage group, and the group is read from the index. No launcher record is written for an entry the index no longer holds, and a new entry becomes visible through one write.

## Impact

- **Code:** `src/host/launcher/store-access.ts` (`update`, `fork`, `continueSharingData`, a new `AppGoneError`); `src/host/launcher/app-index.ts` (`put`'s write order for a new id).
- **Tests:** a new `shared-group.suite.ts` in the launcher Node suite, on the file-backed rig in `data-copy-rig.ts`. Existing fixtures that call `update`, `fork` or `continueSharingData` on an entry they never indexed need the entry put first.
- **Behaviour a person can see:** a change that finishes for an app deleted meanwhile now ends as a failed attempt. Before, it could bring the app back. Whether today's menus let a person get there is not established (design.md D8).
- **Docs:** one entry in `docs/decisions.md`; the `linked-apps` line in `docs/capabilities.md`.
- **GitHub:** #160 closed with the route at closure. Filed with this proposal: #184 for the product question, #183 for the missing launch-order test noted in design.md Risks.
- **Coordination:** the one chain runs after copy-app-data chain-3 and design-system-v1 chain-22. copy-app-data's task 3.0 should name `engineAppId(entry)` as the id the saved-data check asks about.
- **Dependencies:** none.
