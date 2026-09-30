# Queue snapshots and construction-boundary review

Independent read-only review: **CLEAN** for 5c01cf6e8d666e0e99565df40dcdb21cbd549e88 against pinned BASE b6b8c58fd1ea3c541fc3ea274b9bcba1c38999d5.

The two changed files exactly match the allowlist. No harness, configuration, check, test, or public-contract changes; the diff has no whitespace errors.

notifyMoves retains snapshot iteration while making both the line and each listener collection named snapshots. A listener can still mutate live queue/listener state without altering the active listener iteration. All pre-existing position, handoff, microtask-delivery, drain, and idempotent-leave code is unchanged.

LineWakes is synchronous. The real ticket owner attaches its outcome observer before any await or yield in waitInLine; a pre-settled outcome therefore still wakes the wait. The existing arbitration stays intact: abort is first, ticket outcome second, timeout third, followed by the zero-position microtask fallback. Registration/cleanup of move, abort, tick, and timeout handlers is unchanged.

S29 is correctly source-free: LineTicket.outcome is documented never-rejecting and is constructed with a resolve-only Promise in joinLine; its observer only assigns a LineOutcome and calls a Promise resolver. No empty catch, void, synthetic failure path, or rejection swallowing was added.

This cohort is structural. The existing admission and route acceptance cases cover listener movement, cancellation, draining, timeout, and handoff. No suites or gates were run by this reviewer; worker/root receipts and a later full gate remain the validation authority.
