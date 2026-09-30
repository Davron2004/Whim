VERDICT: report-mismatch

REPORT HONESTY: discrepancies: the R4 receipt correctly demonstrates that a stale same-ID completion no longer borrows Retry or Discard after the newer attempt has already retained its volatile failure. Its `coverage complete` verdict does not cover the required case where that newer attempt is still active. In that order, the stale completion mutates the newer attempt's live state before its lease is checked.

FINDINGS:

- `src/host/launcher/LauncherRoot.tsx:1482` — high — `settleFailed()` calls `releaseLiveRef(id)` before it checks `isCurrentAttempt(lease)` at line 1483. `releaseLiveRef` identifies a live run only by ID (lines 1454–1455), although a newer retry can have the same ID and a different lease. Trigger: leave active attempt A running; open its same-ID failed ghost and start retry B; while B is still streaming, deliver A's delayed iterator error. A is stale and its storage settlement correctly returns `unresolved`, but it clears B's `liveRef`. B's remaining `building` ghost can no longer reattach (`onOpenPending` takes the no-live-run path); its Cancel path can delete the record and journal without aborting B. This violates the D19 requirement to guard terminal mutations with the current opaque lease. `handleGenerateRefusal()` has the same pre-lease ID-only release at line 1629.

- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx:686` — med — the new stale-ID test deliberately makes B fail and retain before it throws A (lines 710–716). It verifies action identity and retained-record preservation, but cannot observe the stale release of an active B. A meaningful negative case must throw A while B is still active, then prove B can reattach and its Cancel aborts B rather than deleting its state beneath a live stream.

SPEC CONFORMANCE: gaps: the R4 `retained` settlement is an improvement. It grants `pendingId` only after `retainFailed()` accepted the active lease, so direct volatile iterator failures have actions and stale completions no longer borrow them. The pre-guard live-reference mutation remains unfenced for the same-ID active overlap. The earlier recovery work remains present: raw/current separation, journal marker provenance, readback-gated Discard, removal-fault seam, setup/retry recovery, cold demotion, and retained current app-link handling.

CHECK-WEAKENING SCAN: clean. The exact range changes no Class-1 configuration, dependencies, gates, generated output, or invariant suite. I found no checker relaxation, debug residue, or uncalled production path.

Validation: read-only review of `874be3307cabf29906be17137401723237a8ee3a..7cc3dbfa9ee0b843978feb34443dc0e7db1c8ce6`; `git diff --check` was clean. The cited R4 RED, GREEN, fast-gate, and Knip receipts are present and agree with the matrix. I did not run tests, builds, servers, native jobs, Git mutations, or product edits.
