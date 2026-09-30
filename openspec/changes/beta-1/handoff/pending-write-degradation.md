# Pending-write degradation contract (D19)

Planned interface; implementer must reconcile final signatures here before handoff.
Baseline: reviewed R2 selective terminal fix already integrated into integration/beta-1.

```ts
type PendingBuildView = {
  record: PendingBuildRecord;
  durability: 'persisted' | 'volatile';
};
// Opaque to callers; one identity per activation, never timestamp-derived.
type PendingAttemptLease = { readonly id: string; readonly token: symbol };
// PendingBuildStore additions:
readCurrent(id: string): PendingBuildView | null;
listCurrent(): PendingBuildView[];
activateAttempt(id: string): PendingAttemptLease;
isCurrentAttempt(lease: PendingAttemptLease): boolean;
retainFailed(lease: PendingAttemptLease, failure: PendingBuildFailure): boolean;
releaseAttempt(lease: PendingAttemptLease): void;
forgetRetained(id: string): void;
```

- PendingBuildRecord JSON is unchanged. Existing get/list read persisted keys only.
- PendingBuildStore is the only lifecycle authority; current reads never write.
- Current list substitutes by ID, preserves order, includes retained entries after partial
  Discard, and never duplicates an ID. Edit attempts keep their existing no-ghost rule.
- Activate only after pending plus empty-journal setup is durably verified, before HTTP.
  Capture the started record in the store; new activation clears that ID's retained view.
- Failed setup keeps its old current view/lease, restores siblings independently, sends no HTTP.
- Guard terminal settlement/recovery writes with isCurrentAttempt before mutation.
  retainFailed independently rejects stale tokens, including reused IDs/equal timestamps.
- Direct completion evidence permits generic failed retention only after R2 durable recovery
  cannot verify a usable settlement. Absence of refs, clocks and journals cannot supply it.
- Release only the matching lease after settlement/recovery, delivery or cancellation finishes;
  release keeps retained failure. No successful attempt may leave an active lease behind.
- Home, ghost opening, failure actions and pending app links use current views.
  Recovery validation uses raw persisted reads. Home/link-routing need no source change.
- A volatile failure has pendingId for current-entry actions, no saved recordId, no journalId.
  Keep unverified journal/report association suppressed across Back/reopen, even when a
  generic pending fallback saved successfully. Report bookkeeping never supplies lifecycle.
- Retained Discard attempts pending and journal removal independently; verify pending key
  absent, order excludes ID, and journal absent before forgetRetained. No throw is insufficient.
  On failure, preserve the current entry and generic failure/Back. No memory tombstones.
- New Retry activation or verified Discard clears retained state; reads never auto-promote it.
- Cold launch demotes each raw building record to interrupted. On rejected demotion, retain
  volatile interrupted and continue before ready Home. Prior-process failure data is gone.
- No write-failure policy promises physical durability. Read corruption uses existing policy;
  process death during multi-key removal has no new atomicity guarantee.
- Existing generic copy; native errors only through the existing redacted logging boundary.
- No background flush, dependency, backend, or general cancel/delivery recovery change.

Test-only seam in native-storage.ts:
```ts
type RemovalFailure = (input: Readonly<{ id: string; key: string }>) =>
  'throw' | 'return-false' | undefined;
failNativeStorageRemovalsWhen(predicate: RemovalFailure): () => void;
```

Both fault outcomes retain the key. Undefined uses the original Map deletion. The cleanup
restores the prior removal predicate; resetNativeStorage clears both fault predicates.
failNativeStorageWritesWhen and its set-only meaning stay unchanged. Production MMKV remove
returns a boolean; KVBackend.delete is void, so test false-with-retained-key and throws.

Exact product/test allowlist:
- src/host/launcher/pending-builds.ts
- src/host/launcher/LauncherRoot.tsx
- src/host/launcher/test/pending-builds.suite.ts
- src/host/launcher/test/attempt-lifecycle-ui.suite.tsx
- src/host/launcher/test/native-storage.ts (test seam only)

Acceptance: rendered full terminal write failure → Back → reopen without a report; raw/current
state differs honestly; blocked Retry sends no HTTP, recovered Retry sends one; rejected and
partial Discard retains the ghost, verified Discard stays removed; links use current state;
another live ID stays live; stale same-ID leases cannot mutate; cold recovery is interrupted.
Keep R2 selective recovery green. No checks have been run by the planning author.
