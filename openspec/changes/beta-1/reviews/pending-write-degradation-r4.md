VERDICT: report-mismatch

REPORT HONESTY: discrepancies: the active iterator-error test is real and fixes the r3 failure, but the coverage receipt calls the matrix complete without a stale same-ID authorization case. The new `pendingId` predicate still authorizes actions for an unresolved stale lease when a different, newer attempt has left a volatile view under that ID.

FINDINGS:

- `src/host/launcher/LauncherRoot.tsx:1784` — high — `retainedPendingId` is derived from `settlement === 'unresolved'` plus the current view's volatility, without proving that this invocation retained that view. A stale lease returns `unresolved` at line 1483 before any mutation. Trigger: attempt A activates ID `x`; a newer activation for `x` supersedes it and later retains its own volatile failure; then A's delayed stream error reaches `settleUnexpectedAttemptFailure`. The code assigns A's failure screen `pendingId: x`, so Retry or Discard acts on B while rendering A's prompt/edit context. The opaque lease must fence this action identity as well as writes; only the owning completion that actually retained the current view may receive `pendingId`.

- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx:638` — med — the new test credibly drives an active `ReadableStream` error after HTTP begins and asserts Retry, Discard, Back/reopen, and no report. It has no stale same-ID lease case. The existing store test at `pending-builds.suite.ts:126` proves stale `retainFailed()` rejects mutation, but it cannot detect the screen-level authorization above.

SPEC CONFORMANCE: gaps: the r1 and r2 fixes remain correct: native removal faults retain entries, raw order readback gates successful Discard, and no-terminal-event volatile failures expose actions. The new active-stream producer is substantive, not EOF, and its assertions cover the intended direct path. Durable journal guarding, raw/current separation, retry setup/recovery, cold demotion, app-link current views, report suppression, and the allowed observability fixture are otherwise implemented within scope. Stale-lease action authorization remains a contract gap.

CHECK-WEAKENING SCAN: clean. The exact range changes no Class-1 configuration, dependency, gate, generated output, or invariant suite. I found no checker relaxation, debug residue, or uncalled production path.

Validation: read-only review of `874be3307cabf29906be17137401723237a8ee3a..9182237be1e7121582d6189aaf674b1b31646bfd`; `git diff --check` was clean. I did not run tests, builds, servers, native jobs, Git mutations, or product edits.
