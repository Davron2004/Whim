## 1. Storage-engine snapshot

- [ ] 1.1 Create `src/host/storage-engine/copy-contract.ts`. It must have no op-sqlite import and must be importable by the Node suites. It holds:
  - the `CopyStorage` type: `(args: { from: string; to: string }) => Promise<CopyReport>`;
  - `CopyReport`, as `{ bytes: number; ms: number }`;
  - `DataCopyError`, with `kind: 'no_space' | 'source_unreadable' | 'verify_failed' | 'io'`;
  - the `isSupersetSchema(copy, source)` helper, built on `schema.ts` types.
- [ ] 1.2 Create `src/host/storage-engine/copy.ts`: `copyStore(opener, { from, to })`, pure over an injected opener (open by appId, delete by appId, resolve the storage directory). Steps:
  1. Open the source and read its applied schema with `readAppliedSchema`.
  2. Set `PRAGMA synchronous=FULL`.
  3. Run `VACUUM INTO ?` with the destination's absolute path as a bound parameter.
  4. Open the destination. `PRAGMA quick_check` must return `ok`, and `isSupersetSchema` must hold. Close both connections.
  5. Classify any failure into a `DataCopyError` kind (SQLITE_FULL becomes `no_space`) and delete the destination before rethrowing.

  This is the only file in `src/` allowed to contain the token `VACUUM` (design D1).
- [ ] 1.3 Add two openers for `copyStore`:
  - `copy-node.ts`, over `node:sqlite` files, for tests.
  - `copy-device.ts`, over op-sqlite. It uses async `execute` for the snapshot (off the JS thread) and `getDbPath()` for the directory, and is exported beside `deleteStorage`. Node suites import submodules, never the `storage-engine/index.ts` barrel.
- [ ] 1.4 Add copy tests to the storage suite (`src/host/storage-engine/test/`, registered from `acceptance.ts`). All run against real files:
  - Fidelity: record ids 3, 7 and 12, kv values, a retired column with data, and `_meta` deep-equal to the source.
  - Consistent snapshot while a second connection writes.
  - A destination that already exists is refused and left untouched.
  - `verify_failed` through an injected corrupting opener.
  - `no_space` through an injected SQLITE_FULL.
  - `source_unreadable`.
  - Every failure leaves no destination file and the source byte-identical.
  - A source scan proving `VACUUM` occurs only in `copy.ts`.
- [ ] 1.5 Add `src/host/storage-engine/copy-device-acceptance.ts` and a `RUN_DATA_COPY_PROBE = false` flag plus a probe screen in `App.tsx`, following the `RUN_STORAGE_PROBE` pattern. The probe:
  - opens a second connection to a store that is already open, and snapshots it while the first one writes;
  - reports `getDbPath()`;
  - runs `VACUUM INTO` under `location:'storage'`;
  - runs a 50 MB store copy with timing and a `quick_check`;
  - reads back the copy after an immediate process kill, which checks the output is durable once the statement returns.

  It renders the full JSON on screen, because logcat truncates.

## 2. Launcher copy API and crash safety

- [ ] 2.1 Create `src/host/launcher/data-copy-journal.ts`: a persisted list of `{ copyAppId, sourceAppId, startedAt }` with `put`, `clear` and `list`. It is MMKV-backed on device and uses the existing injected-KV pattern in Node. Add `sweepDataCopies({ journal, index, deleteStorage })`, which clears entries whose `copyAppId` is in the index and otherwise deletes the store and then clears the entry. It must never delete an id that has an index entry.
- [ ] 2.2 Change `StoreAccess` (`store-access.ts`):
  - `fork(entry, versionId?, { data?: 'fresh' | 'copy' })`, with `shareData` deleted;
  - a new `continueSharingData(entry)` that sets `storageGroupId = entry.storageGroupId ?? entry.id`;
  - an optional `copyStorage` in `StoreAccessOptions`;
  - `readonly canCopyData`.

  For `'copy'`, follow design D2's sequence inside `serial(repo)`: version fork, then journal put, then the stray-file guard (abort if any index entry resolves to the id, else `deleteStorage`), then `copyStorage({ from: engineAppId(entry), to: copyAppId })`, then `index.put` (the commit), then journal clear. On failure, delete the store, clear the journal and rethrow. A `'copy'` request without the seam rejects before any write.
- [ ] 2.3 Wire it in:
  - `build-lifecycle.ts:267` calls `continueSharingData`.
  - `LauncherRoot.tsx` injects the device `copyStorage` at the `new StoreAccess(...)` site.
  - `LauncherRoot.tsx` runs `sweepDataCopies` in the launch block before any realm can bind, next to `demoteBuildingToInterrupted`.
  - Every remaining `fork(..., { shareData })` caller is updated. Expect the Home share sheet, if design-system-v1 15.3 has not already removed it.
- [ ] 2.4 Add a crash-mid-copy suite in `src/host/launcher/test/`, using the real file-backed Node engine and the node opener:
  - Inject a fault after each step of D2: journal written, stray guard done, snapshot partially written, snapshot done, entry written. For each, run `sweepDataCopies` and assert either no entry, no file and an empty journal, or the entry, the complete data and an empty journal. The original's file stays byte-identical throughout.
  - A child-process test SIGKILLs a real `VACUUM INTO` of a large store mid-write. The parent then runs the sweep with the journal entry the flow would have written, and asserts the partial file is gone and a retry succeeds.
  - A stray file under the copy id is never served to a "Start fresh" copy.
  - The sweep leaves an indexed id alone.
- [ ] 2.5 Add a schema-evolution and independence suite. Make A's union reach ordinal 7 with one retired field, then copy A to C with `'copy'`. Then:
  - Both A and C add a field to the same collection through real `engine.open`. Assert both new ordinals are greater than 7, neither store has the other's new column, and both read their pre-copy records.
  - A copy from an older version opens with zero DDL, its union keeps every field, and the floor for its next generation (as read through `readApplied(engineAppId(copy))`) is A's floor at copy time.
  - Writes after the copy stay on their own side.
  - Deleting A, with its purge complete, keeps C's data.
  - A legacy shared copy (a record carrying `storageGroupId`) still shares, survives either member's deletion, and when copied with `'copy'` yields its own file holding the group's data.
  - Census guard: every `fork` option combination yields `storageGroupId === undefined`. `canCopyData` is false without the seam.

## 3. Launcher question UI

- [ ] 3.1 Precondition: design-system-v1 chains 15 and 20 have merged onto the staging branch. Check this first, and stop with a report if not. Then, in the tile menu's "Make a copy" flow:
  - When `access.canCopyData` is true, show the "Copy the data, or start fresh?" sheet, with the rows "Copy the data" and "Start fresh". Their copy keys go in `copy.ts`.
  - Dismissing the sheet or going back creates nothing.
  - When `canCopyData` is false, keep design-system-v1's immediate fresh copy.
  - Replace any placeholder feature check those chains left with `canCopyData`.
- [ ] 3.2 In History, "Make a copy from here" asks the same question through the same component. When the version is older than the current one and "Copy the data" is chosen, show the existing hidden-data line.
- [ ] 3.3 Busy state and failure:
  - The triggering control shows busy under `runAppOp` and cannot be re-triggered for that app while the copy runs.
  - Each `DataCopyError` kind maps to plain copy ("There wasn't room to copy the data." and the like), offering "Start fresh".
  - No silent fallback to an empty copy.
  - Delete any leftover share-question keys and tests (`fork-question-ui.spec.md`, `fork-ui.suite.tsx`, and the `home-grid-ui.suite.tsx` share-row cases) if design-system-v1 left them.
- [ ] 3.4 UI suites covering:
  - question shown and hidden by `canCopyData`;
  - dismiss creates nothing;
  - each answer calls `fork` with the right `data` value;
  - the History path and its hidden-data line;
  - busy and re-trigger refusal;
  - each failure kind's copy and its "Start fresh" offer;
  - the copy lint passes on the new keys.

## 4. Docs

- [ ] 4.1 Append the next free decision number to `docs/decisions.md` (read the file's tail; do not assume a number). Record:
  - `copy-app-data`, built: `VACUUM INTO` snapshot, index-entry commit with a journal sweep, `fork({data})` plus `continueSharingData`, `canCopyData`;
  - legacy shared copies untouched;
  - that it realizes #75's resolved copy bullet and narrows #52 to continuations.
- [ ] 4.2 Update `docs/capabilities.md`: add the `app-data-copy` line and amend the `linked-apps` line to say "rewind continuations only; legacy shared copies keep their group".

## 5. On-device verification (attended)

- [ ] 5.1 Android (headless emulator on a non-5554 port; `adb -s` every time). Build an offline release with `RUN_DATA_COPY_PROBE = true` and record the probe JSON:
  - second-connection behaviour;
  - `getDbPath`;
  - snapshot while writing;
  - 50 MB time (at most 5 s), with `quick_check` returning `ok`;
  - read-back after a kill.

  Record the results in the decision entry. If the second connection is refused, implement design D8's fallback before continuing. Turn the flag back off.
- [ ] 5.2 iOS simulator: the same probe and the same record.
- [ ] 5.3 Android end to end with the product build:
  - make an app and save records and kv values;
  - "Make a copy" with "Copy the data" shows the data in the copy; add data on each side and confirm independence; delete the original and confirm the copy keeps its data;
  - "Start fresh" is empty;
  - "Make a copy from here" on an older version with "Copy the data" works and shows the hidden-data line;
  - force-stop during the copy of a large store (`adb shell am force-stop`), relaunch, and see either no copy or a complete one, never a broken tile;
  - check the question sheet, busy state and failure copy pixel by pixel against `docs/design/system.md`.
- [ ] 5.4 iOS simulator end to end: the same flow, using `xcrun simctl terminate` mid-copy.
- [ ] 5.5 Legacy shared copy on device:
  - install a build from before this change and make a shared copy (#52 "use the same saved data");
  - install this change's build over it;
  - both apps still share, deleting one keeps the other's data, and copying the shared copy with "Copy the data" yields an independent app.
