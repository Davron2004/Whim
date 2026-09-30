# Pending-write recovery contract (D19)

`PendingBuildStore` owns lifecycle current views and process-only attempt leases. Persisted
reads remain raw and report association is decided by the record's durable marker.

```ts
// The ONLY persisted-schema addition to PendingBuildRecord:
journalUnavailable?: true;
// true blocks record-driven journal/report association; absence retains legacy eligibility.
type PendingJournalAvailability = 'verified' | 'unavailable';
type PendingBuildView = {
  record: PendingBuildRecord;
  durability: 'persisted' | 'volatile';
};
type PendingAttemptLease = { readonly id: string; readonly token: symbol };
// PendingBuildStore additions/extensions:
readCurrent(id: string): PendingBuildView | null;
listCurrent(): PendingBuildView[];
isOrderExcluded(id: string): boolean;
activateAttempt(id: string): PendingAttemptLease;
isCurrentAttempt(lease: PendingAttemptLease): boolean;
retainFailed(lease: PendingAttemptLease, failure: PendingBuildFailure): boolean;
retainDiscardFailure(record: PendingBuildRecord, failure: PendingBuildFailure): void;
releaseAttempt(lease: PendingAttemptLease): void;
forgetRetained(id: string): void;
setJournalAvailability(id: string, availability: PendingJournalAvailability): void;
setFailed(id: string, failure: PendingBuildFailure,
  journalAvailability?: PendingJournalAvailability): void;
```

- get/list remain persisted reads. Current reads never write or promote durability.
- The only lifecycle authority is PendingBuildStore; the flag never determines lifecycle.
- setFailed writes failure and availability in ONE KV set. Omitted availability preserves
  the existing flag; unavailable writes true; verified omits the field (never serializes false).
- setJournalAvailability changes only that metadata; callers verify readback. A missing
  record/no-op is not success. Verified is a caller assertion of proven current provenance.
- Every create writes building+true before touching/replacing the journal, including fresh
  starts and reused IDs. Verify new empty journal, clear flag, verify pending again, THEN
  activate/HTTP. A failure at any step keeps the previous current view and sends no request.
- Guard every stream frame before it changes journal, signal, live reference or UI, and guard
  terminal/recovery mutations by the current lease; a stale stream no-ops. The store independently
  rejects stale retention. Capture the started record at activation; IDs/timestamps are not leases.
- Live references carry that lease and release only when it matches. A stale terminal, refusal,
  delivery completion or keepalive cannot clear, replace or update a newer same-ID attempt.
- Each live attempt retains its own screen, signals and controller by ID. Independent attempts
  keep their own journal and completion path, while only the selected attempt may update shared
  screen/signals. Reattach and Cancel resolve that ID's live attempt.
- Delivery rechecks the captured lease immediately after its awaited producer boundary and before
  deleting pending state. A stale same-ID delivery cannot delete or promote a newer attempt;
  an independent delivery still releases and promotes its own report without taking over the UI.
- Before recovery replaces/resets the current journal (including generic fallback), persist
  and read back true on the current record, or verify the target journal already equals the saved bytes/absence.
  If the guard cannot persist, do not introduce the old journal; still attempt safe pending
  recovery and generic fallback. Sibling independence does not waive this prerequisite.
- Restore an old pending snapshot with its original marker only after exact old-journal
  verification; otherwise restore its data with true. Original true remains true. An exact
  verified old pair retains its original bytes/semantics. No timestamp matching or run IDs.
- Generic fallback without a verified current terminal journal writes failed+true atomically.
  Readback verifies payload AND marker. This can guard a later generic journal reset; if
  the guard fails, no such reset. Never write an unflagged generic intermediate record.
- Clear only after verified new-empty setup, a matching verified current terminal settlement,
  or exact old-pair restore whose original marker was absent. Presence of any journal,
  successful pending write, ref reset, Retry click or cold launch cannot clear it.
- If durable recovery fails, retain generic failed+true from direct completion evidence.
  No clocks, absent refs or journal data may manufacture completion.
- Current list substitutes by ID, preserves order, retains partially deleted entries and
  never duplicates. Edit attempts keep no separate ghost. Home/actions/app links use it.
- Release matching leases after completion/cancellation/delivery; keep retained failures.
  Successful runs do not accumulate leases. New verified activation replaces retention.
- Record-driven report attachment rechecks current record durability and flag. true suppresses
  journalId/report after Back, launcher remount and cold restart even when raw old bytes exist.
  A stale screen ID/ref cannot bypass it. Volatile views have pendingId for actions, no saved
  recordId or journalId. Replace unavailableJournalRef with these record/current checks;
  do not maintain a second availability Set.
- Discard attempts pending/journal removal independently; verify pending key absent, order
  excludes ID, journal absent before forgetRetained. Otherwise retain generic failure/Back.
  No memory tombstones. Successful deletion removes metadata with its record.
- Cold launch demotes raw building to interrupted while preserving true; failed demotion
  retains volatile interrupted and continues before ready Home. Lost volatile failure is gone.
- Actual legacy get is JSON.parse(raw) as PendingBuildRecord, no exact-key rejection. Legacy
  setFailed/demotion spread records; create reconstructs and needs its explicit new true field.
  Old readers parse but do not enforce the new flag. Unflagged historical data is not guessed.
- Physical durability under rejected writes, corruption, process death during multi-key
  removal, and general cancel/delivery I/O fault recovery get no new guarantee. Preserve
  successful paths/ownership. No new backend, journal schema, dependency or flush loop.

Test-only native-storage.ts seam (existing set-only fault behavior unchanged):
```ts
type RemovalFailure = (input: Readonly<{ id: string; key: string }>) =>
  'throw' | 'return-false' | undefined;
failNativeStorageRemovalsWhen(predicate: RemovalFailure): () => void;
```
Both failures retain the key; undefined uses original Map deletion. Cleanup restores prior
predicate; resetNativeStorage clears both independent predicates. MMKV remove returns bool;
KVBackend.delete exposes void, so deletion success requires readback.

Exact product/test allowlist:
- src/host/launcher/pending-builds.ts
- src/host/launcher/LauncherRoot.tsx
- src/host/launcher/test/pending-builds.suite.ts
- src/host/launcher/test/attempt-lifecycle-ui.suite.tsx
- src/host/launcher/test/native-storage.ts (test seam only)
- src/host/launcher/test/observability-ui.suite.ts (verified fixture setup only)
- src/host/launcher/build-lifecycle.ts (captured-lease delivery deletion guard only)

Node-first acceptance: reproduce parked r3 with new LauncherShell over SAME MMKV, not a
same-mounted reopen; preserve old journal raw bytes while saved generic failed+true withholds
it after remount/native-restart simulation. Fault setup/rollback before marker clearance:
zero HTTP, cold building→interrupted preserves true/no old report. Prove recovered setup and
verified current terminal pairs can show their own report, and exact old-pair restore stays
intact. Keep fully unwritable Back/reopen, raw/current separation, Retry, both removal failure
modes/partial Discard, links, independent IDs and stale leases. Native restart smoke follows
Node checks on the rebuilt candidate.
