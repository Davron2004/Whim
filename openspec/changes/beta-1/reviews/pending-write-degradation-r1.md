VERDICT: report-mismatch

REPORT HONESTY: discrepancies: the handoff's exact allowlist and D19 task 11.3 require `src/host/launcher/test/native-storage.ts` to add `failNativeStorageRemovalsWhen`, preserving the existing write-fault predicate and reset behavior. The composed range does not touch that file, exports no removal-fault seam, and adds no test for either a thrown or `return-false` removal. Its claimed removal coverage is therefore unfinished. The four task-result counts and green Node run do not establish completion of this requirement.

FINDINGS:

- `src/host/launcher/pending-builds.ts:259` — high — `delete()` unconditionally removes the ID from `pending:order` and clears `current` after calling the void `KVBackend.delete`. If native removal returns `false` and leaves `pending:<id>` behind, `delete()` still drops both representations that `listCurrent()` needs.
- `src/host/launcher/LauncherRoot.tsx:2304` — high — retained Discard is not retained after a non-throwing failed sibling removal. Trigger: have the native pending or journal removal return `false`; `onDismissPending` tries both siblings and its readback makes `removed` false, but `PendingBuildStore.delete()` has already cleared the current view and order entry. Back then refreshes Home without the ghost even though the raw pending key or journal remains. The contract requires the entry to remain exactly once and be available for a later Discard.
- `src/host/launcher/test/native-storage.ts:5` — high — the required `failNativeStorageRemovalsWhen` seam is absent; the test adapter only injects thrown `set` failures and always runs `Map.delete`. The regression above cannot be tested, and the mandated throw, false-return, and partial-sibling Discard scenarios are missing.
- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx:434` — med — the only added-or-existing Discard assertion covers successful deletion. It does not assert retained Home/Back behavior after a failed removal, a later recovered Discard, or either removal-fault mode. It also adds no fully-unwritable Back/reopen or failed-setup-to-cold-interrupted coverage requested by task 11.4.

SPEC CONFORMANCE: gaps: D19's retained-Discard requirement is not met for a non-throwing deletion failure, and the required native removal-fault seam and acceptance tests are absent. The range does implement meaningful pieces of the rest of the correction: raw vs current views, opaque leases, guarded retry setup, durable `journalUnavailable`, fresh-launcher report suppression, and verified old-pair restoration. The new terminal-write tests have real behavioral assertions, including the fresh `LauncherRoot` over the same MMKV; they do not cover the missing removal contract.

CHECK-WEAKENING SCAN: clean. The range changes no Class-1 configuration, dependencies, gate scripts, generated output, or invariant suite. I found no checker relaxation, debug residue, or newly uncalled production path.

Validation: read-only review of `874be3307cabf29906be17137401723237a8ee3a..d8292d97d3c3cd63132890cc037f68a74b1fad1e`; `git diff --check` was clean. I did not run tests, builds, servers, native jobs, Git mutations, or product edits.
