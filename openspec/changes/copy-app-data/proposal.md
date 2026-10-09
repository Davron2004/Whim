## Why

The owner ruled on 2026-10-09 (decision #75, first reversal bullet; design-system-v1 `tasks.md` RESOLVED note) that "Make a copy" asks **"Copy the data, or start fresh?"**. Both answers give the copy its own storage-engine appId. Copies can no longer share data with their original, because two apps sharing one store causes problems. "Copy the data" has no implementation today. The only way to carry data into a copy is #52's shared storage group (research.md §4), which is exactly the sharing the owner ruled out for copies. design-system-v1 chains 15 and 20 are building the question and need an API to call, behind a feature check.

## What Changes

- **New: a one-time, all-or-nothing copy of an app's user data into a new copy's own store.** The copy is a byte-faithful SQLite snapshot of the source store: every collection including retired columns, kv, row ids, and the accumulated `_meta` schema. It is written under the copy's own appId at copy time. After that, the original and the copy share nothing.
- **New: crash safety.** A copy is committed only when its launcher entry is written, and that happens after the copied store has been verified. A persisted copy journal plus a launch sweep removes any half-written store. No launcher entry ever points at a partial copy.
- **New: `StoreAccess.fork(entry, versionId?, { data: 'fresh' | 'copy' })` and a `canCopyData` feature flag.** The launcher's question (tile menu "Make a copy" and History "Make a copy from here") calls it. "Copy the data" shows only when `canCopyData` is true.
- **BREAKING (internal API): `fork` loses `shareData`.** A copy can no longer join its original's storage group. Rewind continuations keep sharing (#53 D5) through a separate, explicitly named `StoreAccess.continueSharingData` seam, so no "Make a copy" caller can ask for sharing. This closes the two UNSAFE pattern-census rows (research.md §Pattern census: `store-access.ts:362` and the Home "Share" row).
- **Legacy shared copies keep working unchanged.** Copies that #52 placed into an original's storage group keep their group: no automatic detach, no data moved. Refcounted delete still protects them.
- **Honest failure.** If the copy fails (no space, source unreadable, verification fails), nothing is created. The person is told so and can start fresh instead.

## Capabilities

### New Capabilities
- `app-data-copy`: copying one app's user data into a new copy's own store at copy time. Covers the question, the snapshot granularity, the commit point and crash recovery, schema carry-over and independent evolution afterwards, kv and table coverage, size and time behaviour, and the API and feature check the launcher calls.

### Modified Capabilities
- `linked-apps`: storage groups are reserved for rewind continuations. "Make a copy" can never place a copy into its original's group. Groups that existing copies already belong to stay valid and immutable. The creation seam takes the sharing decision only on the continuation path.
- `mini-app-storage`: the isolation requirement's sharing scenario now says only a rewind continuation can join another app's group. A copy made with "Copy the data" gets its own database file.

## Impact

- **Code:**
  - `src/host/storage-engine/`: a new `copy.ts` snapshot routine, with device (op-sqlite) and Node (node:sqlite) openers.
  - `src/host/launcher/store-access.ts`: `fork` options, `continueSharingData`, `canCopyData`.
  - A new `src/host/launcher/data-copy-journal.ts`, plus the launch sweep wiring in `LauncherRoot.tsx`.
  - `build-lifecycle.ts` moves to `continueSharingData`.
  - The question sheet and History rows built by design-system-v1 chains 15 and 20.
  - `copy.ts` strings.
- **Tests:**
  - New Node suites: snapshot fidelity, crash mid-copy (including a SIGKILLed child process), recovery sweep, schema evolution after copy, legacy shared copy survival, and a census regression guard.
  - Flag-gated on-device probes on Android and iOS.
- **Dependencies:** none. It uses the op-sqlite-bundled SQLite 3.51.3 `VACUUM INTO` (verified to preserve row ids and refuse an existing target under Node's SQLite 3.51.3) and the existing MMKV.
- **Coordination:** design-system-v1's deltas for `app-launcher` ("Forking creates an independent launcher entry": "created at once with no question") and `version-history` ("Any version can become its own app at once": "starts with empty data") predate the owner's resolution and contradict it. They need amending before design-system-v1 archives (design.md Open Questions).
- **Docs:** a new decision entry in `docs/decisions.md`, and the `capabilities.md` line for `app-data-copy` and the amended `linked-apps` line.

## Product-owner rulings (2026-10-09)

1. design-system-v1's spec deltas are amended by the orchestrator to the owner's ruling ("Make a copy" asks "Copy the data, or start fresh?"; the copy always gets its own appId).
2. History's "Make a copy from here" asks the same question.
3. When the original has never saved any user data, the question is skipped and the copy starts fresh silently (nothing to copy).
4. The speed bar "50 MB in 5 s on emulator/simulator" is accepted.
5. A "Separate the data" action for legacy shared copies is out of scope — tracked as a backlog GitHub issue.
6. Devices: chain-4 and chain-5 run on emulators/simulators (≤ 2 concurrent virtual devices, deleted after); the owner's real phone is used only in the final attended device session.
