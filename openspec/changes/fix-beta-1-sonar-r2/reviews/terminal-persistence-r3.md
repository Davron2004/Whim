Review range: `f80392a9099a5b5229ef9be24d0e2d4e2a144755..645e7fc6d452b879f0c3e991e6141e7691003084`

VERDICT: findings

REPORT HONESTY: matches diff. The revision touches only the two allowlisted launcher files, preserves the restored journal bytes in the covered partial-recovery case, and the added tests assert the intended same-session Back and reopen behavior.

FINDINGS:

- `src/host/launcher/LauncherRoot.tsx:794` — high — journal unavailability exists only in `unavailableJournalRef`. In the recoverable partial path, the code persists a generic failed pending record while retaining the old journal, then uses that ref to suppress the old report. A fresh `LauncherShell` has an empty ref: `failureFromRecord` at line 2200 again assigns `journalId`, and `failureJournal` at line 2319 reads the old report into the generic failure screen. This is an unverified report after a normal process restart, despite all relevant MMKV writes for the generic pending record having succeeded. It is separate from the fully unwritable-store boundary. Park it explicitly in the store-owned current-view work, with a durable or derivable journal-identity rule; the current ref cannot survive the state it protects.
- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx:249` — medium — the reopened-ghost assertion reuses the same mounted launcher, so it preserves `unavailableJournalRef` and cannot catch the fresh-instance path above. A remount using the same MMKV state must verify that the generic failed ghost still withholds the restored old report.

SPEC CONFORMANCE: gaps: the revision conforms for the rendered Retry -> consent -> Agree fault path while the current launcher instance remains alive: it keeps one request, generic content, no unhandled rejection, a verified generic failed pending record, raw old-journal preservation, and no report on Back/reopen. After restart, it can present the prior attempt's journal as the generic retry's report. The pending-build and generation-run-journal contracts require the persisted record and journal to describe the same failure; the in-memory marker does not establish that relationship durably. The fully unwritable case remains the separately planned beta-chain10 scope and is not this finding.

CHECK-WEAKENING SCAN: clean. The diff changes no Class-1 configuration, dependency, gate, generated output, or invariant suite. It adds no checker relaxation, transitional flag, debug residue, or uncalled production path. The rendered Node acceptance assertions are substantive and do not use Jest or tautologies.

Validation considered: root-selected RED session 37939 exited 0 and failed after the product reverted to BASE, reaching the original terminal-write producer through `settleServerEnding`, `runAttempt`, and `onRetryPending`. The worker's r3 RED reportedly caught the prior journal-clobber and same-session reopen defects; its fast gate and green acceptance passed. I did not run tests, builds, servers, native jobs, Git mutations, or product edits.
