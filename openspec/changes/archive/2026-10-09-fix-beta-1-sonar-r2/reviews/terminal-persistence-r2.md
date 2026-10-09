Review range: `f80392a9099a5b5229ef9be24d0e2d4e2a144755..9712c08a455e9e92bfa560ea9ac0e8586b4fc025`

VERDICT: report-mismatch

REPORT HONESTY: discrepancies: `done.md` requires sibling-independent recovery. In the partial-rollback path, the revision can restore the old journal successfully, fail to restore the old pending record, then erase that successfully restored journal before it persists the generic pending failure. The two touched files match the allowlist exactly.

FINDINGS:

- `src/host/launcher/LauncherRoot.tsx:1843` — high — `recoverRetryAfterTerminalPersistenceFailure` calls `restoreAttemptSnapshots` first. When `restored.journal` is true and `restored.pending` is false, it enters `persistGenericTerminalFailure`, whose unconditional `journal.create(id)` replaces the verified old journal with `[]`. If the following generic terminal append fails, the code hides the empty report through `unavailableJournalRef`, but the old journal has already been lost. This is a recoverable partial-write case, not the separately planned fully unwritable boundary. Keep the successful journal snapshot and withhold its identity from the UI; only the pending sibling needs the generic failed-state fallback.
- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx:219` — medium — the new "old pending record cannot be restored" test drives the source sequence above: it rejects the generic terminal journal write and the old pending restore, while allowing the old journal restore. It asserts the generic failed record and a hidden timeline but never checks `journal:failed` remains byte-for-byte equal to the old journal. The test therefore permits the journal wipe at line 1843. An exact raw-journal assertion is a distinct sibling-recovery check, not a duplicate of the pending-state assertion.

SPEC CONFORMANCE: gaps: the generic pending fallback, verified record identity, update snapshot propagation, and refusal snapshot propagation meet the recoverable lifecycle goal. The remaining gap is preservation of a sibling journal that was successfully restored. It conflicts with DONE requirement 2 and the generation-run-journal rule that failure history remains alongside the ghost. The fully unwritable case remains outside this revision: it needs the planned beta-chain10 store-owned current-view work because the present persisted model cannot guarantee a durable non-building state when every relevant MMKV write fails.

CHECK-WEAKENING SCAN: clean. The diff changes no Class-1 configuration, dependencies, gate, generated output, or invariant suite. The tests are rendered Node acceptance tests with observable assertions, not Jest or tautologies. No transitional flag, debug residue, or uncalled production path appeared in the diff.

Validation considered: root-selected RED session 34088 exited 0 and failed after reverting the product to BASE, proving the original native terminal-write rejection through `runAttempt` and `onRetryPending`. Worker-reported fast gate and green acceptance succeeded; I did not run tests, builds, servers, native jobs, Git mutations, or product edits.
