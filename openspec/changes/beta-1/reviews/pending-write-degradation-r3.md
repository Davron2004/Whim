VERDICT: report-mismatch

REPORT HONESTY: discrepancies: the coverage receipt says coverage is complete, but its fully-unwritable case only ends the SSE stream without a terminal event. It does not cover a thrown stream/transport error, which takes a separate live-failure path and still violates the volatile-failure action contract below.

FINDINGS:

- `src/host/launcher/LauncherRoot.tsx:1771` — high — a thrown stream error under fully unwritable storage retains a volatile failed current view, then opens a failure screen with neither `pendingId` nor `recordId`. `settleFailed()` falls through to `retainFailed()` when the terminal journal and generic pending write both fail, but `settleUnexpectedAttemptFailure()` passes the `unresolved` result through `genericAttemptFailure()` at line 1792. `failureActions()` then finds no current attempt ID and omits Retry and Discard. Trigger: activate an attempt, make the stream iterator throw, and reject terminal pending/journal writes. The generic failed ghost appears only after Back, even though the live failure must expose Retry, Back, and Discard for its retained volatile current record. This is the stream-error counterpart of the r2 live-failure bug, which the new `showStreamFailure()` logic fixes only for an iterator that ends normally without a terminal event.

- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx:601` — med — the new fully-unwritable test proves the normal no-terminal-event path (`streams[0].end()`), not the thrown-error path above. The sole new `throw` server fixture at line 478 runs during failed Retry setup and never reaches an active stream. The acceptance test therefore cannot fail when `settleUnexpectedAttemptFailure()` drops the volatile action identity.

SPEC CONFORMANCE: gaps: the r2 findings are fixed. `isOrderExcluded()` at `pending-builds.ts:166` performs the raw order readback, and the rendered pending-order test proves recovery. `showStreamFailure()` now supplies `pendingId` for a retained volatile no-terminal settlement, and the rendered test proves live Discard plus Back/reopen. The native removal seam, current-view app-link routing, cold demotion, retry recovery, durable journal guard, lease fencing, and report suppression tests are substantive. A thrown stream error still bypasses the same volatile action handling, so terminal/stream-error conformance is incomplete.

CHECK-WEAKENING SCAN: clean. The full range changes no Class-1 configuration, dependency, gate, generated output, or invariant suite. I found no checker relaxation, debug residue, or uncalled production path.

Validation: read-only review of `874be3307cabf29906be17137401723237a8ee3a..7f3b28eb749a17eb933b371056b6bf3a7ec0a64c`; `git diff --check` was clean. I did not run tests, builds, servers, native jobs, Git mutations, or product edits.
